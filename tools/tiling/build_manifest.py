from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(help="Build GlyphLens item manifests from a tiles directory.")
console = Console()

ITEM_KIND_LABELS = {
    "stele": "碑刻示例",
    "pictorial_stone": "画像石示例",
}

LAYER_LABELS = {
    "photo_raw": "原始照片",
    "rubbing_paper": "传统拓片",
    "rubbing_digital": "数字拓印",
    "enhanced_clahe": "CLAHE 增强",
    "grayscale": "灰度图",
    "line_drawing": "墨线图",
    "3d_render": "3D 截图",
    "photo_raking_light_n": "北向掠射光",
    "photo_raking_light_e": "东向掠射光",
    "photo_raking_light_s": "南向掠射光",
    "photo_raking_light_w": "西向掠射光",
}

VISIBLE_BY_DEFAULT = {
    "photo_raw",
    "rubbing_digital",
    "photo_raking_light_n",
}


def infer_title(item_kind: str, item_id: str) -> str:
    base = item_id.replace("_", " ").strip()
    return f"{ITEM_KIND_LABELS.get(item_kind, '文物图像')} · {base}"


def infer_layer_kind(layer_id: str) -> str:
    return layer_id if layer_id in LAYER_LABELS else "custom"


def infer_label(layer_id: str) -> str:
    return LAYER_LABELS.get(layer_id, layer_id.replace("_", " "))


def default_opacity(layer_id: str) -> float:
    if layer_id == "photo_raw":
        return 1.0

    if layer_id.startswith("photo_raking_light_"):
        return 0.75

    return 0.6


@app.command()
def main(
    tiles_root: Path = typer.Option(
        Path("../../glyphlens-web/public/tiles"),
        "--tiles-root",
        help="Root directory containing /tiles/<kind>/<item>/*.dzi",
    ),
    manifests_root: Path = typer.Option(
        Path("../../glyphlens-web/public/manifests"),
        "--manifests-root",
        help="Output directory for manifest JSON files.",
    ),
) -> None:
    """Scan DZI files and emit one manifest per item."""

    tiles_path = tiles_root.resolve()
    manifests_path = manifests_root.resolve()

    if not tiles_path.exists():
        raise typer.BadParameter(f"Tiles root does not exist: {tiles_path}")

    manifests_path.mkdir(parents=True, exist_ok=True)

    generated = []

    for kind_dir in sorted(path for path in tiles_path.iterdir() if path.is_dir()):
        for item_dir in sorted(path for path in kind_dir.iterdir() if path.is_dir()):
            dzi_files = sorted(item_dir.glob("*.dzi"))

            if not dzi_files:
                continue

            item_kind = kind_dir.name
            item_id = item_dir.name
            layers = []

            for dzi_file in dzi_files:
                layer_id = dzi_file.stem
                layers.append(
                    {
                        "id": layer_id,
                        "kind": infer_layer_kind(layer_id),
                        "label": infer_label(layer_id),
                        "tileSource": f"/tiles/{item_kind}/{item_id}/{dzi_file.name}",
                        "defaultOpacity": default_opacity(layer_id),
                        "defaultVisible": layer_id in VISIBLE_BY_DEFAULT,
                    }
                )

            manifest = {
                "id": item_id,
                "title": infer_title(item_kind, item_id),
                "kind": item_kind,
                "layers": layers,
                "regions": [],
            }

            manifest_path = manifests_path / f"{item_id}.json"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            generated.append(manifest_path)
            console.print(f"[green]Wrote[/green] {manifest_path}")

    if not generated:
        console.print("[yellow]No DZI files found.[/yellow]")
        raise typer.Exit()

    index_path = manifests_path / "index.json"
    index_payload = {"items": [f"/manifests/{path.name}" for path in generated]}
    index_path.write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    console.print(f"[green]Updated[/green] {index_path}")


if __name__ == "__main__":
    app()
