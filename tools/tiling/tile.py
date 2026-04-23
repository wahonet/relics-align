from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(help="Convert high-resolution JPG/TIFF files into Deep Zoom Image tiles.")
console = Console()


def load_pyvips():
    try:
        import pyvips  # type: ignore
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise typer.BadParameter(
            "pyvips is not installed. Run `pip install -r requirements.txt` and make sure libvips is on PATH."
        ) from exc

    return pyvips


@app.command()
def main(
    input: Path = typer.Option(..., "--input", exists=True, file_okay=True, dir_okay=False),
    out: Path = typer.Option(..., "--out", help="Output prefix without extension, e.g. ./photo_raw"),
    tile_size: int = typer.Option(256, "--tile-size", min=64, max=2048),
    overlap: int = typer.Option(1, "--overlap", min=0, max=32),
    suffix: str = typer.Option(".jpg[Q=85]", "--suffix"),
    layout: str = typer.Option("dz", "--layout", help="DeepZoom layout, usually `dz`."),
    skip_existing: bool = typer.Option(False, "--skip-existing"),
) -> None:
    """Generate .dzi + *_files tiles with libvips dzsave."""

    pyvips = load_pyvips()

    input_path = input.resolve()
    out_prefix = out.resolve()
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    dzi_path = out_prefix.with_suffix(".dzi")

    if skip_existing and dzi_path.exists():
        console.print(f"[yellow]Skip existing[/yellow] {dzi_path}")
        raise typer.Exit()

    console.print(f"[cyan]Reading[/cyan] {input_path}")
    image = pyvips.Image.new_from_file(str(input_path), access="sequential")

    console.print(
        "[cyan]Tiling[/cyan] "
        f"tile_size={tile_size} overlap={overlap} layout={layout} suffix={suffix}"
    )
    image.dzsave(
        str(out_prefix),
        layout=layout,
        tile_size=tile_size,
        overlap=overlap,
        suffix=suffix,
    )

    console.print(f"[green]Done[/green] {dzi_path}")


if __name__ == "__main__":
    app()
