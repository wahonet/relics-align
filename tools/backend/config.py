"""后端运行时的路径 / 常量集中管理。

所有路径都相对 **仓库根目录**（也就是 ``tools/backend`` 的上两级）。所以无论
用户从哪个目录启动 uvicorn，产物都会落到 ``glyphlens-web/public/storage/``，
前端 dev server 和后端共享同一批静态资源。
"""

from __future__ import annotations

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent.parent
FRONTEND_DIR = REPO_ROOT / "glyphlens-web"
PUBLIC_DIR = FRONTEND_DIR / "public"

# 所有动态生成的数据放到 public/storage/ 下，前端可直接通过 /storage/... 访问
STORAGE_DIR = PUBLIC_DIR / "storage"
RELICS_DIR = STORAGE_DIR / "relics"  # 每个文物一个子目录：{relic_id}/original.jpg, microtrace.jpg, ...
DB_PATH = STORAGE_DIR / "glyphlens.sqlite3"

# 离线已经存在的 demo 产物；如果数据库为空，首次启动会把它作为 _08A9952 自动 import 一次
DEMO_METADATA_JSON = PUBLIC_DIR / "demo" / "processed" / "metadata.json"

# 图像处理长边、JPEG 质量
DEFAULT_LONG_EDGE = 4096
DEFAULT_JPEG_QUALITY = 92

# 产物固定键名（和前端 PRODUCT_ORDER 对齐）
PRODUCT_KEYS = ["original", "microtrace", "sharpen", "grayscale", "line", "rubbing"]


def ensure_dirs() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    RELICS_DIR.mkdir(parents=True, exist_ok=True)
