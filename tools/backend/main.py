"""GlyphLens FastAPI 后端入口。

启动：
  uvicorn tools.backend.main:app --reload --port 8787

路由概览：
  GET    /api/health
  GET    /api/relics
  POST   /api/relics            multipart: file + metadata JSON
  GET    /api/relics/{id}
  DELETE /api/relics/{id}
  POST   /api/relics/{id}/regenerate
  POST   /api/line              入参 LineRenderIn → PNG
  GET    /api/relics/{id}/annotations
  POST   /api/relics/{id}/annotations
  PATCH  /api/annotations/{id}
  DELETE /api/annotations/{id}
"""

from __future__ import annotations

import json
import shutil
import sys
import traceback
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

# ``python tools\backend\main.py`` 这种方式启动时，需要把仓库根目录加入 sys.path
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from tools.backend import config, db, pipeline, schemas  # noqa: E402
from tools.image_processing import operators as op  # noqa: E402


VERSION = "0.1.0"

app = FastAPI(title="GlyphLens Backend", version=VERSION)

# 前端 dev server 默认在 5173 端口，放开 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Line-Width", "X-Line-Height", "X-Product-Width", "X-Product-Height"],
)


@app.on_event("startup")
def _startup() -> None:
    config.ensure_dirs()
    db.init_schema()
    # 首次启动：把已有 demo/processed 的内容当作一条 relic 种子数据，
    # 这样哪怕用户还没上传过，"数据管理"界面也能直接看到一条示例。
    if db.is_empty():
        db.seed_from_demo_metadata(config.DEMO_METADATA_JSON)


# ---------------------------------------------------------------------------
# 静态文件：把 public/storage 也直接挂给后端，方便纯后端场景访问
# ---------------------------------------------------------------------------

if config.STORAGE_DIR.exists():
    app.mount(
        "/storage",
        StaticFiles(directory=str(config.STORAGE_DIR)),
        name="storage",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_relic_out(relic: dict[str, Any]) -> schemas.RelicOut:
    products = db.list_products(relic["id"])
    product_models = [
        schemas.ProductOut(
            key=p["kind"],
            label=p["label"],
            description=p["description"] or "",
            colorMode=p["color_mode"],
            src=p["src"],
            sizeBytes=int(p["size_bytes"]),
            width=int(p["width"]),
            height=int(p["height"]),
        )
        for p in products
    ]
    original = next((p for p in products if p["kind"] == "original"), None)
    source = original["src"] if original else ""

    return schemas.RelicOut(
        id=relic["id"],
        title=relic["title"],
        kind=relic["kind"],
        period=relic["period"],
        location=relic["location"],
        description=relic["description"],
        originalFile=relic["original_file"],
        pipelineLongEdge=int(relic["long_edge"]),
        jpegQuality=int(relic["jpeg_quality"]),
        generatedAt=relic["created_at"],
        source=source,
        products=product_models,
    )


def _require_relic(relic_id: str) -> dict[str, Any]:
    relic = db.get_relic(relic_id)
    if relic is None:
        raise HTTPException(status_code=404, detail=f"relic not found: {relic_id}")
    return relic


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health", response_model=schemas.Health)
def health() -> schemas.Health:
    with db.get_conn() as conn:
        relic_count = conn.execute("SELECT COUNT(*) c FROM relics").fetchone()["c"]
        ann_count = conn.execute("SELECT COUNT(*) c FROM annotations").fetchone()["c"]
    return schemas.Health(
        version=VERSION, relicCount=int(relic_count), annotationCount=int(ann_count)
    )


# ---------------------------------------------------------------------------
# Relics CRUD
# ---------------------------------------------------------------------------

@app.get("/api/relics", response_model=list[schemas.RelicSummary])
def list_relics() -> list[schemas.RelicSummary]:
    relics = db.list_relics()
    summaries: list[schemas.RelicSummary] = []
    with db.get_conn() as conn:
        for relic in relics:
            counts = conn.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM products a WHERE a.relic_id = ?) AS product_count,
                  (SELECT COUNT(*) FROM annotations b WHERE b.relic_id = ?) AS annotation_count
                """,
                (relic["id"], relic["id"]),
            ).fetchone()
            summaries.append(
                schemas.RelicSummary(
                    id=relic["id"],
                    title=relic["title"],
                    kind=relic["kind"],
                    period=relic["period"],
                    location=relic["location"],
                    description=relic["description"],
                    createdAt=relic["created_at"],
                    productCount=int(counts["product_count"]),
                    annotationCount=int(counts["annotation_count"]),
                )
            )
    return summaries


@app.get("/api/relics/{relic_id}", response_model=schemas.RelicOut)
def get_relic(relic_id: str) -> schemas.RelicOut:
    relic = _require_relic(relic_id)
    return _build_relic_out(relic)


@app.post("/api/relics", response_model=schemas.RelicOut, status_code=201)
async def create_relic(
    file: UploadFile = File(..., description="原图（支持 tif / tiff / jpg / png）"),
    metadata: str = Form(..., description="JSON，对应 RelicIn"),
    longEdge: int = Form(config.DEFAULT_LONG_EDGE, ge=1024, le=8192),
    jpegQuality: int = Form(config.DEFAULT_JPEG_QUALITY, ge=60, le=99),
) -> schemas.RelicOut:
    try:
        payload = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"metadata 不是合法 JSON：{exc}") from exc

    try:
        relic_in = schemas.RelicIn(**payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"metadata 校验失败：{exc}") from exc

    if db.get_relic(relic_in.id) is not None:
        raise HTTPException(
            status_code=409, detail=f"relic id 已存在：{relic_in.id}"
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    try:
        saved_path = pipeline.save_uploaded_original(
            relic_in.id, file.filename or "upload.bin", content
        )

        db.upsert_relic(
            relic_id=relic_in.id,
            title=relic_in.title,
            kind=relic_in.kind,
            period=relic_in.period,
            location=relic_in.location,
            description=relic_in.description,
            original_file=file.filename or saved_path.name,
            long_edge=int(longEdge),
            jpeg_quality=int(jpegQuality),
        )

        pipeline.generate_products(
            relic_in.id,
            original_file=saved_path,
            long_edge=int(longEdge),
            jpeg_quality=int(jpegQuality),
        )
    except Exception as exc:
        # 回滚：删除数据库条目 + 磁盘目录
        db.delete_relic(relic_in.id)
        storage_dir = config.RELICS_DIR / relic_in.id
        if storage_dir.exists():
            shutil.rmtree(storage_dir, ignore_errors=True)
        tb = traceback.format_exc()
        raise HTTPException(
            status_code=500,
            detail=f"处理原图失败：{exc}\n\n{tb}",
        ) from exc

    relic = _require_relic(relic_in.id)
    return _build_relic_out(relic)


@app.post("/api/relics/{relic_id}/regenerate", response_model=schemas.RelicOut)
def regenerate_relic(relic_id: str) -> schemas.RelicOut:
    relic = _require_relic(relic_id)

    # 取 uploads 下最新上传的原图；若没有，就尝试用 demo/_08A9952.tif（兜底）
    uploads = config.RELICS_DIR / relic_id / "uploads"
    candidates = sorted(uploads.glob("*")) if uploads.exists() else []
    if candidates:
        original_path = candidates[-1]
    else:
        fallback = config.REPO_ROOT / "demo" / relic["original_file"]
        if not fallback.exists():
            raise HTTPException(
                status_code=400,
                detail=f"未找到 uploads 原图，也没有 demo/{relic['original_file']}",
            )
        original_path = fallback

    pipeline.generate_products(
        relic_id,
        original_file=original_path,
        long_edge=int(relic["long_edge"]),
        jpeg_quality=int(relic["jpeg_quality"]),
    )
    return _build_relic_out(_require_relic(relic_id))


@app.delete("/api/relics/{relic_id}", status_code=204)
def delete_relic(relic_id: str) -> Response:
    _require_relic(relic_id)
    db.delete_relic(relic_id)
    storage_dir = config.RELICS_DIR / relic_id
    if storage_dir.exists():
        shutil.rmtree(storage_dir, ignore_errors=True)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Product rendering（微痕/锐化/灰度/拓片 通用 level 调节）
# ---------------------------------------------------------------------------

@app.post("/api/render-product")
async def render_product(request: Request) -> Response:
    """通用产物渲染：key ∈ {microtrace, sharpen, grayscale, rubbing}，params 为各产物专属参数。"""
    body = await request.json()
    relic_id: str = body.get("relicId", "")
    key: str = body.get("key", "")
    params_dict: dict = body.get("params", {})

    _require_relic(relic_id)

    entry = op.PRODUCT_PARAMS.get(key)
    if entry is None:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的 key={key}，可选：{', '.join(op.PRODUCT_PARAMS)}",
        )

    params_cls, renderer = entry
    # 用 dataclass 默认值填充缺失字段
    try:
        params = params_cls(**{k: v for k, v in params_dict.items() if k in params_cls.__dataclass_fields__})
    except TypeError as exc:
        raise HTTPException(status_code=400, detail=f"参数错误：{exc}") from exc

    products = db.list_products(relic_id)
    original = next((p for p in products if p["kind"] == "original"), None)
    if original is None:
        raise HTTPException(status_code=404, detail="original 产物缺失")

    rel = original["src"].lstrip("/")
    img_path = config.PUBLIC_DIR / rel
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"原图文件缺失：{img_path}")

    image = cv2.imdecode(np.fromfile(str(img_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="读取原图失败")

    result_img = renderer(image, params)

    ok, buf = cv2.imencode(".jpg", result_img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise HTTPException(status_code=500, detail="JPG 编码失败")

    h, w = result_img.shape[:2]
    return Response(
        content=buf.tobytes(),
        media_type="image/jpeg",
        headers={
            "X-Product-Width": str(w),
            "X-Product-Height": str(h),
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------------------
# Line rendering
# ---------------------------------------------------------------------------

@app.post("/api/line")
def render_line(payload: schemas.LineRenderIn) -> Response:
    _require_relic(payload.relicId)

    params = op.LineParams(
        gaussian_sigma=float(payload.gaussianSigma),
        canny_low=int(payload.cannyLow),
        canny_high=int(payload.cannyHigh),
        use_adaptive=bool(payload.useAdaptive),
        adaptive_block_size=int(payload.adaptiveBlockSize),
        adaptive_c=int(payload.adaptiveC),
        close_kernel=int(payload.closeKernel),
        min_area_ratio=float(payload.minAreaRatio),
        keep_largest_n=int(payload.keepLargestN),
        dilate_iters=int(payload.dilateIters),
        invert=bool(payload.invert),
    )

    try:
        png, width, height = pipeline.render_line_png(
            relic_id=payload.relicId,
            params=params,
            preview_long_edge=payload.previewLongEdge,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return Response(
        content=png,
        media_type="image/png",
        headers={
            "X-Line-Width": str(width),
            "X-Line-Height": str(height),
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/thin-line")
async def thin_line(
    image: UploadFile = File(...),
    lineWidth: float = Form(2.0),
) -> Response:
    """接收一张已渲染的线图 PNG，提取轮廓后用指定线宽矢量重画，返回新 PNG。"""
    content = await image.read()
    arr = np.frombuffer(content, dtype=np.uint8)
    src = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if src is None:
        raise HTTPException(status_code=400, detail="无法解码上传的图像")

    _, binary = cv2.threshold(src, 128, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

    h, w = src.shape[:2]
    canvas = np.full((h, w), 255, dtype=np.uint8)
    thickness = max(1, int(round(lineWidth)))
    cv2.drawContours(canvas, contours, -1, 0, thickness, lineType=cv2.LINE_AA)

    ok, buf = cv2.imencode(".png", canvas, [int(cv2.IMWRITE_PNG_COMPRESSION), 3])
    if not ok:
        raise HTTPException(status_code=500, detail="PNG 编码失败")

    return Response(
        content=buf.tobytes(),
        media_type="image/png",
        headers={
            "X-Line-Width": str(w),
            "X-Line-Height": str(h),
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------------------
# OCR（按选定产物 + 归一化 bbox 裁切后识别）
# ---------------------------------------------------------------------------

_ocr_instance: Any = None


def _get_ocr() -> Any:
    """延迟加载 rapidocr（PP-OCRv4 ONNX，首次调用会自动下载模型）。"""
    global _ocr_instance
    if _ocr_instance is not None:
        return _ocr_instance
    try:
        from rapidocr import RapidOCR
    except ImportError as exc:
        raise HTTPException(
            status_code=501,
            detail="OCR 依赖未安装，请执行 `pip install rapidocr onnxruntime`。",
        ) from exc
    try:
        _ocr_instance = RapidOCR()
    except Exception as exc:  # 模型下载 / 初始化失败
        raise HTTPException(
            status_code=500,
            detail=f"OCR 初始化失败：{exc}",
        ) from exc
    return _ocr_instance


@app.post("/api/ocr")
async def ocr_region(request: Request) -> dict[str, Any]:
    """裁切指定产物的归一化 bbox 区域并返回 OCR 结果。"""
    body = await request.json()
    relic_id: str = body.get("relicId", "")
    product_key: str = body.get("productKey", "original") or "original"
    bbox_x = float(body.get("bboxX", 0))
    bbox_y = float(body.get("bboxY", 0))
    bbox_w = float(body.get("bboxW", 0))
    bbox_h = float(body.get("bboxH", 0))

    _require_relic(relic_id)

    if bbox_w <= 0 or bbox_h <= 0:
        raise HTTPException(status_code=400, detail="bbox 尺寸无效")

    product = next(
        (p for p in db.list_products(relic_id) if p["kind"] == product_key),
        None,
    )
    if product is None:
        raise HTTPException(status_code=404, detail=f"产物不存在：{product_key}")

    rel = product["src"].lstrip("/")
    img_path = config.PUBLIC_DIR / rel
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"产物文件缺失：{img_path}")

    image = cv2.imdecode(
        np.fromfile(str(img_path), dtype=np.uint8), cv2.IMREAD_COLOR
    )
    if image is None:
        raise HTTPException(status_code=400, detail="读取产物图像失败")

    h, w = image.shape[:2]
    x0 = max(0, min(w, int(round(bbox_x * w))))
    y0 = max(0, min(h, int(round(bbox_y * h))))
    x1 = max(0, min(w, int(round((bbox_x + bbox_w) * w))))
    y1 = max(0, min(h, int(round((bbox_y + bbox_h) * h))))
    if x1 - x0 < 4 or y1 - y0 < 4:
        raise HTTPException(status_code=400, detail="选区过小，无法识别")

    crop = image[y0:y1, x0:x1]

    ocr = _get_ocr()
    try:
        result = ocr(crop)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OCR 推理失败：{exc}") from exc

    # rapidocr 返回 RapidOCROutput，含 txts / scores / boxes；未识别到时为空
    txts = tuple(getattr(result, "txts", ()) or ())
    scores = tuple(getattr(result, "scores", ()) or ())

    items: list[dict[str, Any]] = []
    texts: list[str] = []
    for idx, text_val in enumerate(txts):
        text = str(text_val).strip()
        if not text:
            continue
        score = float(scores[idx]) if idx < len(scores) else 0.0
        texts.append(text)
        items.append({"text": text, "score": score})

    return {"text": "\n".join(texts), "items": items}


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------

@app.get(
    "/api/relics/{relic_id}/annotations",
    response_model=list[schemas.AnnotationOut],
)
def list_annotations(relic_id: str) -> list[schemas.AnnotationOut]:
    _require_relic(relic_id)
    return [schemas.annotation_to_out(r) for r in db.list_annotations(relic_id)]


@app.post(
    "/api/relics/{relic_id}/annotations",
    response_model=schemas.AnnotationOut,
    status_code=201,
)
def create_annotation(relic_id: str, payload: schemas.AnnotationIn) -> schemas.AnnotationOut:
    _require_relic(relic_id)
    record = db.insert_annotation(
        relic_id=relic_id,
        product_key=payload.productKey,
        bbox_x=float(payload.bboxX),
        bbox_y=float(payload.bboxY),
        bbox_w=float(payload.bboxW),
        bbox_h=float(payload.bboxH),
        label=payload.label,
        glyph=payload.glyph,
        note=payload.note,
        author=payload.author,
    )
    return schemas.annotation_to_out(record)


@app.patch("/api/annotations/{annotation_id}", response_model=schemas.AnnotationOut)
def update_annotation(
    annotation_id: int, payload: schemas.AnnotationPatch
) -> schemas.AnnotationOut:
    existing = db.get_annotation(annotation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"annotation not found: {annotation_id}")

    updates: dict[str, Any] = {}
    field_map = {
        "label": payload.label,
        "glyph": payload.glyph,
        "note": payload.note,
        "author": payload.author,
        "bbox_x": payload.bboxX,
        "bbox_y": payload.bboxY,
        "bbox_w": payload.bboxW,
        "bbox_h": payload.bboxH,
    }
    for key, value in field_map.items():
        if value is not None:
            updates[key] = value

    updated = db.update_annotation(annotation_id, **updates)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"annotation not found: {annotation_id}")
    return schemas.annotation_to_out(updated)


@app.delete("/api/annotations/{annotation_id}", status_code=204)
def delete_annotation(annotation_id: int) -> Response:
    if not db.delete_annotation(annotation_id):
        raise HTTPException(status_code=404, detail=f"annotation not found: {annotation_id}")
    return Response(status_code=204)
