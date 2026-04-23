# GlyphLens Backend (FastAPI + SQLite)

## 启动

```bash
cd tools/backend
pip install -r requirements.txt
uvicorn tools.backend.main:app --reload --port 8787
```

或者双击仓库根目录 `start_backend.bat`。

启动后：
- `http://localhost:8787/api/health` 确认服务正常
- `http://localhost:8787/docs` 查看所有 API（FastAPI 自动生成）

## 数据存放位置

- 数据库：`glyphlens-web/public/storage/glyphlens.sqlite3`
- 每条文物的产物：`glyphlens-web/public/storage/relics/{relic_id}/*.jpg`
- 上传的原图：`glyphlens-web/public/storage/relics/{relic_id}/uploads/`

之所以放在 `public/storage/` 下，是为了让 Vite dev server 能直接通过 `/storage/...`
路径把这些文件作为静态资源返回给前端，**无需依赖后端**的静态路由。后端自己也挂了
`/storage` 路径，前端可以 100% 走后端、或 100% 走 Vite，都能拿到产物文件。

## API 速览

| Method | Path | 说明 |
| --- | --- | --- |
| GET | /api/health | 服务与数据库状态 |
| GET | /api/relics | 所有文物概览列表 |
| POST | /api/relics | 上传 TIFF/JPG 新文物并自动跑产物管线 |
| GET | /api/relics/{id} | 文物详情（含 products 数组） |
| DELETE | /api/relics/{id} | 删除文物（含所有产物与标注） |
| POST | /api/relics/{id}/regenerate | 用上传的原图重跑产物 |
| POST | /api/line | 实时线图渲染，返回 `image/png` |
| GET | /api/relics/{id}/annotations | 该文物的所有字迹标注 |
| POST | /api/relics/{id}/annotations | 新建标注 |
| PATCH | /api/annotations/{id} | 编辑标注 |
| DELETE | /api/annotations/{id} | 删除标注 |

首次启动时，如果 `glyphlens-web/public/demo/processed/metadata.json` 存在，会把它
当作种子文物导入，`relic_id = _08A9952`，前端进入"数据管理"能直接看到一条记录。
