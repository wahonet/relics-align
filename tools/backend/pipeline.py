"""图像处理管线 · 后端版本。

把 ``tools/image_processing/operators.py`` + ``process.py`` 的能力拆成两类函数：

1. :func:`generate_products`  一次性生成某个文物的 5 张默认产物 JPG，写数据库
2. :func:`render_line_png`    根据任意 LineParams 渲染线图并返回 PNG bytes
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from . import config, db


# 让 "operators" 作为顶层模块可被导入（它就是 tools/image_processing/operators.py）
IMAGE_PROC_DIR = config.REPO_ROOT / "tools" / "image_processing"
if str(IMAGE_PROC_DIR) not in sys.path:
    sys.path.insert(0, str(IMAGE_PROC_DIR))

import operators as op  # noqa: E402


def read_image(path: Path) -> np.ndarray:
    if not path.exists():
        raise FileNotFoundError(f"原图不存在：{path}")

    suffix = path.suffix.lower()

    if suffix in {".tif", ".tiff"}:
        import tifffile

        array = tifffile.imread(str(path))
        if array.ndim == 2:
            return array
        if array.shape[2] == 3:
            return cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
        if array.shape[2] == 4:
            return cv2.cvtColor(array, cv2.COLOR_RGBA2BGRA)
        return array

    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"无法解码图像：{path}")
    return image


def fit_long_edge(image: np.ndarray, target: int) -> np.ndarray:
    height, width = image.shape[:2]
    long_edge = max(height, width)
    if long_edge <= target:
        return image
    scale = target / long_edge
    return cv2.resize(
        image,
        (int(round(width * scale)), int(round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def _preview(image: np.ndarray, color_mode: str) -> np.ndarray:
    if color_mode == "color":
        if image.ndim == 2:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        if image.shape[2] == 4:
            return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
        return image
    if image.ndim == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image


def _encode_jpg(image: np.ndarray, quality: int) -> bytes:
    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("cv2.imencode JPG 失败")
    return buffer.tobytes()


def _encode_png(image: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".png", image, [int(cv2.IMWRITE_PNG_COMPRESSION), 3])
    if not ok:
        raise RuntimeError("cv2.imencode PNG 失败")
    return buffer.tobytes()


def _relic_storage_dir(relic_id: str) -> Path:
    target = config.RELICS_DIR / relic_id
    target.mkdir(parents=True, exist_ok=True)
    return target


def generate_products(
    relic_id: str,
    original_file: Path,
    long_edge: int,
    jpeg_quality: int,
) -> list[dict[str, Any]]:
    """读取一张原图，生成 6 个产物（original + 5 算子）并写入数据库与磁盘。

    返回值：与数据库记录对齐的 product dict 列表（dict 结构与 SQLite 行一致）。
    """

    original = read_image(original_file)
    downsized = fit_long_edge(original, long_edge)
    base_bgr = op.prepare_base(downsized)

    storage_dir = _relic_storage_dir(relic_id)
    generated: list[dict[str, Any]] = []

    def _register(
        kind: str,
        label: str,
        description: str,
        color_mode: str,
        image: np.ndarray,
    ) -> None:
        filename = f"{kind}.jpg"
        jpg = _encode_jpg(_preview(image, color_mode), jpeg_quality)
        (storage_dir / filename).write_bytes(jpg)

        height, width = image.shape[:2]
        public_src = f"/storage/relics/{relic_id}/{filename}"

        db.upsert_product(
            relic_id=relic_id,
            kind=kind,
            label=label,
            description=description,
            color_mode=color_mode,
            src=public_src,
            width=int(width),
            height=int(height),
            size_bytes=int(len(jpg)),
        )
        generated.append(
            {
                "kind": kind,
                "label": label,
                "description": description,
                "colorMode": color_mode,
                "src": public_src,
                "width": int(width),
                "height": int(height),
                "sizeBytes": int(len(jpg)),
            }
        )

    # 1. 原始（统一颜色空间）
    _register(
        kind="original",
        label="原始高清",
        description=f"原始 TIFF 抽样到长边 {long_edge}px 的 web 预览，作为其他处理的参照。",
        color_mode="color",
        image=base_bgr,
    )

    # 2~6. 跑 5 个算子
    for operator in op.OPERATORS:
        result = operator(downsized)
        _register(
            kind=result.key,
            label=result.label,
            description=result.description,
            color_mode=result.color_mode,
            image=result.image,
        )

    return generated


def render_line_png(
    relic_id: str,
    params: op.LineParams,
    preview_long_edge: int | None,
) -> tuple[bytes, int, int]:
    """根据 LineParams 实时渲染一张线图，返回 (png bytes, width, height)。"""

    products = db.list_products(relic_id)
    original = next((p for p in products if p["kind"] == "original"), None)
    if original is None:
        raise ValueError(f"文物 {relic_id} 尚未生成 original 产物，无法渲染线图。")

    relative = original["src"].lstrip("/")
    original_path = config.PUBLIC_DIR / relative
    if not original_path.exists():
        raise FileNotFoundError(f"原图文件缺失：{original_path}")

    image = cv2.imdecode(
        np.fromfile(str(original_path), dtype=np.uint8), cv2.IMREAD_COLOR
    )
    if image is None:
        raise ValueError(f"读取 original 失败：{original_path}")

    if preview_long_edge is not None and preview_long_edge > 0:
        image = fit_long_edge(image, preview_long_edge)

    line_image = op.line_with_params(image, params)
    png = _encode_png(line_image)
    height, width = line_image.shape[:2]
    return png, int(width), int(height)


def save_uploaded_original(
    relic_id: str, filename: str, content: bytes
) -> Path:
    """把上传的原图保存到 storage/relics/{id}/uploads/<filename>，返回磁盘路径。"""

    uploads_dir = _relic_storage_dir(relic_id) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    # 防止路径穿越
    safe_name = Path(filename).name
    if not safe_name:
        safe_name = "uploaded.bin"

    target = uploads_dir / safe_name
    target.write_bytes(content)
    return target
