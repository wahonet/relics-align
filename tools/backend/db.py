"""极简 SQLite DAO（不用 ORM，保持依赖干净）。

表结构：
  relics(id, title, kind, period, location, description, original_file,
         long_edge, jpeg_quality, created_at)
  products(id, relic_id, kind, label, description, color_mode, src,
           width, height, size_bytes)
  annotations(id, relic_id, product_key, bbox_x, bbox_y, bbox_w, bbox_h,
              label, glyph, note, author, created_at)

bbox 用 **0~1 的归一化坐标**（相对 product 的宽高），前后端都更省心。
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Iterator

from . import config


_lock = threading.Lock()


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """跨线程安全的连接 context。

    FastAPI 默认是异步事件循环 + 线程池，这里直接每次现开连接，简单稳。
    """

    config.ensure_dirs()
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS relics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'pictorial_stone',
    period TEXT,
    location TEXT,
    description TEXT,
    original_file TEXT NOT NULL,
    long_edge INTEGER NOT NULL DEFAULT 4096,
    jpeg_quality INTEGER NOT NULL DEFAULT 92,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relic_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    color_mode TEXT NOT NULL,
    src TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    UNIQUE(relic_id, kind),
    FOREIGN KEY (relic_id) REFERENCES relics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relic_id TEXT NOT NULL,
    product_key TEXT NOT NULL DEFAULT 'original',
    bbox_x REAL NOT NULL,
    bbox_y REAL NOT NULL,
    bbox_w REAL NOT NULL,
    bbox_h REAL NOT NULL,
    label TEXT,
    glyph TEXT,
    note TEXT,
    author TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (relic_id) REFERENCES relics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_relic ON products(relic_id);
CREATE INDEX IF NOT EXISTS idx_annotations_relic ON annotations(relic_id);
"""


def init_schema() -> None:
    with _lock, get_conn() as conn:
        conn.executescript(SCHEMA_SQL)


# ---------------------------------------------------------------------------
# Relics
# ---------------------------------------------------------------------------

def insert_relic(
    relic_id: str,
    title: str,
    kind: str,
    period: str | None,
    location: str | None,
    description: str | None,
    original_file: str,
    long_edge: int,
    jpeg_quality: int,
) -> dict[str, Any]:
    with _lock, get_conn() as conn:
        conn.execute(
            """
            INSERT INTO relics(id, title, kind, period, location, description,
                               original_file, long_edge, jpeg_quality)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                relic_id,
                title,
                kind,
                period,
                location,
                description,
                original_file,
                long_edge,
                jpeg_quality,
            ),
        )
    return get_relic(relic_id) or {}


def upsert_relic(**kwargs: Any) -> dict[str, Any]:
    existing = get_relic(kwargs["relic_id"]) if "relic_id" in kwargs else None
    if existing is None:
        return insert_relic(**kwargs)

    fields = [
        ("title", kwargs.get("title", existing["title"])),
        ("kind", kwargs.get("kind", existing["kind"])),
        ("period", kwargs.get("period", existing["period"])),
        ("location", kwargs.get("location", existing["location"])),
        ("description", kwargs.get("description", existing["description"])),
        ("original_file", kwargs.get("original_file", existing["original_file"])),
        ("long_edge", kwargs.get("long_edge", existing["long_edge"])),
        ("jpeg_quality", kwargs.get("jpeg_quality", existing["jpeg_quality"])),
    ]
    assignments = ", ".join(f"{name} = ?" for name, _ in fields)
    values: list[Any] = [value for _, value in fields]
    values.append(kwargs["relic_id"])

    with _lock, get_conn() as conn:
        conn.execute(f"UPDATE relics SET {assignments} WHERE id = ?", values)

    return get_relic(kwargs["relic_id"]) or {}


def list_relics() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM relics ORDER BY datetime(created_at) DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def get_relic(relic_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM relics WHERE id = ?", (relic_id,)
        ).fetchone()
    return _row_to_dict(row)


def delete_relic(relic_id: str) -> bool:
    with _lock, get_conn() as conn:
        cursor = conn.execute("DELETE FROM relics WHERE id = ?", (relic_id,))
    return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

def upsert_product(
    relic_id: str,
    kind: str,
    label: str,
    description: str,
    color_mode: str,
    src: str,
    width: int,
    height: int,
    size_bytes: int,
) -> None:
    with _lock, get_conn() as conn:
        conn.execute(
            """
            INSERT INTO products(relic_id, kind, label, description, color_mode,
                                 src, width, height, size_bytes)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(relic_id, kind) DO UPDATE SET
                label=excluded.label,
                description=excluded.description,
                color_mode=excluded.color_mode,
                src=excluded.src,
                width=excluded.width,
                height=excluded.height,
                size_bytes=excluded.size_bytes
            """,
            (
                relic_id,
                kind,
                label,
                description,
                color_mode,
                src,
                width,
                height,
                size_bytes,
            ),
        )


def list_products(relic_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM products WHERE relic_id = ? ORDER BY id",
            (relic_id,),
        ).fetchall()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------

def insert_annotation(
    relic_id: str,
    product_key: str,
    bbox_x: float,
    bbox_y: float,
    bbox_w: float,
    bbox_h: float,
    label: str | None,
    glyph: str | None,
    note: str | None,
    author: str | None,
) -> dict[str, Any]:
    with _lock, get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO annotations(
                relic_id, product_key, bbox_x, bbox_y, bbox_w, bbox_h,
                label, glyph, note, author
            )
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (
                relic_id,
                product_key,
                bbox_x,
                bbox_y,
                bbox_w,
                bbox_h,
                label,
                glyph,
                note,
                author,
            ),
        )
        rowid = cursor.lastrowid
        row = conn.execute(
            "SELECT * FROM annotations WHERE id = ?", (rowid,)
        ).fetchone()
    return _row_to_dict(row) or {}


def list_annotations(relic_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM annotations WHERE relic_id = ? ORDER BY id",
            (relic_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def update_annotation(annotation_id: int, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_annotation(annotation_id)

    allowed = {"label", "glyph", "note", "author", "bbox_x", "bbox_y", "bbox_w", "bbox_h"}
    payload = {k: v for k, v in fields.items() if k in allowed}
    if not payload:
        return get_annotation(annotation_id)

    assignments = ", ".join(f"{key} = ?" for key in payload)
    values = list(payload.values()) + [annotation_id]

    with _lock, get_conn() as conn:
        conn.execute(f"UPDATE annotations SET {assignments} WHERE id = ?", values)

    return get_annotation(annotation_id)


def get_annotation(annotation_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM annotations WHERE id = ?", (annotation_id,)
        ).fetchone()
    return _row_to_dict(row)


def delete_annotation(annotation_id: int) -> bool:
    with _lock, get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM annotations WHERE id = ?", (annotation_id,)
        )
    return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Bootstrap helpers
# ---------------------------------------------------------------------------

def is_empty() -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) AS count FROM relics").fetchone()
    return (row["count"] if row else 0) == 0


def dump_all_to_dict() -> dict[str, Any]:
    """给 /api/health 和调试用的整体快照。"""

    with get_conn() as conn:
        relics = [dict(r) for r in conn.execute("SELECT * FROM relics")]
        products = [dict(r) for r in conn.execute("SELECT * FROM products")]
        annotations = [dict(r) for r in conn.execute("SELECT * FROM annotations")]
    return {"relics": relics, "products": products, "annotations": annotations}


def seed_from_demo_metadata(metadata_path: Path) -> str | None:
    """首次启动时，把 public/demo/processed/metadata.json 作为第一条 relic 导入。"""

    if not metadata_path.exists():
        return None

    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    relic_id = str(data.get("id") or "demo")
    title = str(data.get("title") or relic_id)
    original_file = str(data.get("originalFile") or "demo.jpg")
    long_edge = int(data.get("pipelineLongEdge") or config.DEFAULT_LONG_EDGE)
    jpeg_quality = int(data.get("jpegQuality") or config.DEFAULT_JPEG_QUALITY)

    upsert_relic(
        relic_id=relic_id,
        title=title,
        kind="pictorial_stone",
        period=None,
        location=None,
        description=str(data.get("subtitle") or ""),
        original_file=original_file,
        long_edge=long_edge,
        jpeg_quality=jpeg_quality,
    )

    for product in data.get("products", []):
        upsert_product(
            relic_id=relic_id,
            kind=str(product.get("key")),
            label=str(product.get("label")),
            description=str(product.get("description") or ""),
            color_mode=str(product.get("colorMode") or "color"),
            src=str(product.get("src")),
            width=int(product.get("width") or 0),
            height=int(product.get("height") or 0),
            size_bytes=int(product.get("sizeBytes") or 0),
        )

    return relic_id


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


__all__ = [name for name in list(globals()) if not name.startswith("_")]
