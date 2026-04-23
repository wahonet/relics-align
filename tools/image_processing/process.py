"""GlyphLens 图像处理 CLI。

把一张高清碑刻或画像石照片（JPG / PNG / TIFF）转换为 5 种工作产品：
  - 原图 web 预览
  - 微痕增强
  - 锐化增强
  - 灰度图
  - 数字线图
  - 数字拓片

默认输出到 `glyphlens-web/public/demo/processed/`，同时写一份 metadata.json，
前端的“图像处理”模块会直接读取它。
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import typer
from rich.console import Console
from rich.table import Table

import operators as op


console = Console()
app = typer.Typer(help="GlyphLens image processing pipeline")


DEFAULT_INPUT = Path(__file__).resolve().parents[2] / "demo" / "_08A9952.tif"
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[2]
    / "glyphlens-web"
    / "public"
    / "demo"
    / "processed"
)


def read_image(path: Path) -> np.ndarray:
    if not path.exists():
        raise typer.BadParameter(f"input does not exist: {path}")

    suffix = path.suffix.lower()

    if suffix in {".tif", ".tiff"}:
        try:
            import tifffile
        except ImportError as exc:
            raise typer.BadParameter("tifffile 未安装，请先 pip install tifffile") from exc

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
        raise typer.BadParameter(f"cannot decode image: {path}")

    return image


def fit_long_edge(image: np.ndarray, target: int) -> np.ndarray:
    height, width = image.shape[:2]
    long_edge = max(height, width)

    if long_edge <= target:
        return image

    scale = target / long_edge
    new_size = (int(round(width * scale)), int(round(height * scale)))
    return cv2.resize(image, new_size, interpolation=cv2.INTER_AREA)


def save_image(path: Path, image: np.ndarray, quality: int = 92) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower()

    if suffix in {".jpg", ".jpeg"}:
        params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    elif suffix == ".webp":
        params = [int(cv2.IMWRITE_WEBP_QUALITY), quality]
    elif suffix == ".png":
        params = [int(cv2.IMWRITE_PNG_COMPRESSION), 6]
    else:
        params = []

    ok, buffer = cv2.imencode(suffix, image, params)

    if not ok:
        raise RuntimeError(f"failed to encode {path}")

    buffer.tofile(str(path))
    return path.stat().st_size


def array_preview(image: np.ndarray, mode: Literal["color", "gray", "binary"]) -> np.ndarray:
    if mode == "color":
        if image.ndim == 2:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        if image.shape[2] == 4:
            return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
        return image

    if image.ndim == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    return image


def build_product_entry(
    key: str,
    label: str,
    description: str,
    color_mode: Literal["color", "gray", "binary"],
    relative_path: str,
    size_bytes: int,
    width: int,
    height: int,
) -> dict:
    return {
        "key": key,
        "label": label,
        "description": description,
        "colorMode": color_mode,
        "src": relative_path,
        "sizeBytes": size_bytes,
        "width": width,
        "height": height,
    }


@app.command()
def main(
    input_path: Path = typer.Option(DEFAULT_INPUT, "--input", help="原始图像路径"),
    output_dir: Path = typer.Option(DEFAULT_OUTPUT, "--out", help="输出目录"),
    long_edge: int = typer.Option(4096, "--long-edge", min=1024, max=8192),
    jpeg_quality: int = typer.Option(92, "--quality", min=60, max=99),
) -> None:
    """运行 GlyphLens 图像处理管线。"""

    input_path = input_path.resolve()
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    console.rule(f"[bold]GlyphLens Image Processing · {input_path.name}")

    original = read_image(input_path)
    console.print(
        f"[cyan]Loaded[/cyan] shape={original.shape} dtype={original.dtype}"
    )

    downsized = fit_long_edge(original, long_edge)
    original_preview = op.prepare_base(downsized)
    console.print(
        f"[cyan]Resampled[/cyan] long_edge={long_edge} -> {original_preview.shape[1]}x{original_preview.shape[0]}"
    )

    products: list[dict] = []
    overview = Table(title="Products", show_lines=True)
    overview.add_column("key")
    overview.add_column("label")
    overview.add_column("size (KB)", justify="right")
    overview.add_column("mode")

    def register_product(
        result_key: str,
        label: str,
        description: str,
        color_mode: Literal["color", "gray", "binary"],
        image: np.ndarray,
    ) -> None:
        save_path = output_dir / f"{result_key}.jpg"
        preview = array_preview(image, color_mode)
        size_bytes = save_image(save_path, preview, quality=jpeg_quality)
        height, width = preview.shape[:2]

        products.append(
            build_product_entry(
                key=result_key,
                label=label,
                description=description,
                color_mode=color_mode,
                relative_path=f"/demo/processed/{save_path.name}",
                size_bytes=size_bytes,
                width=width,
                height=height,
            )
        )
        overview.add_row(result_key, label, f"{size_bytes / 1024:,.1f}", color_mode)

    register_product(
        result_key="original",
        label="原始高清",
        description="原始 TIFF 抽样到长边 {edge}px 的 web 预览，作为其他处理的参照。".format(edge=long_edge),
        color_mode="color",
        image=original_preview,
    )

    # 其余功能只生成默认档（level=0.5）；线图仍然保留一张作为首次加载的占位，
    # 真正的实时调参会由前端 opencv.js 完成。
    for operator in op.OPERATORS:
        result = operator(downsized)
        register_product(
            result_key=result.key,
            label=result.label,
            description=result.description,
            color_mode=result.color_mode,
            image=result.image,
        )

    metadata = {
        "id": input_path.stem,
        "title": "汉画像石示例",
        "subtitle": "来自 demo 目录的示例图像",
        "source": f"/demo/processed/original.jpg",
        "originalFile": input_path.name,
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "pipelineLongEdge": long_edge,
        "jpegQuality": jpeg_quality,
        "products": products,
    }

    metadata_path = output_dir / "metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    console.print(f"[green]Wrote metadata[/green] {metadata_path}")
    console.print(overview)


if __name__ == "__main__":
    app()
