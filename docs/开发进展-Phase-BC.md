# GlyphLens 开发进展说明（Phase B & C 落地）

> 本文档为 **状态快照**（约 2026-04-23 前后），供复盘与继续开发时对照。按用户要求，**此处不继续改代码**。

---

## 1. 总体目标与完成情况

| 目标 | 状态 | 说明 |
| --- | --- | --- |
| **Phase C：后端** | 已落地 | FastAPI + SQLite，REST API，文物/产物/标注，上传原图后跑 `tools/image_processing` 同套算子；实时数字线图经 `POST /api/line` 返回 PNG |
| **Phase B：多文物 + 多模块产品化** | 已落地 | 全站共享 `currentRelicStore`、图像处理/多图层/数据管理/字迹标注 四侧栏均可用；多图层可注入当前文物的处理产物为额外叠加层 |
| **绕过浏览器端 OpenCV 卡死** | 已绕开主路径 | 图像处理「数字线图」默认走 **后端渲染**；浏览器端 `opencv.js` 保留为「实验性」开关 |

---

## 2. 后端（`tools/backend/`）

### 2.1 技术栈

- **FastAPI** + **uvicorn**
- **SQLite** 单文件库：`glyphlens-web/public/storage/glyphlens.sqlite3`
- 数据与 `public` 同目录，便于 Vite 静态直出；后端也挂载了 `/storage` 便于纯后端场景

### 2.2 主要文件

| 文件 | 职责 |
| --- | --- |
| `config.py` | 路径常量（`REPO_ROOT`、`PUBLIC_DIR`、`STORAGE_DIR`、`DB_PATH` 等） |
| `db.py` | 建表、`relics` / `products` / `annotations` CRUD、首次空库时从 `public/demo/processed/metadata.json` **种子导入**一条文物 |
| `schemas.py` | Pydantic 入出参（camelCase 与前端一致） |
| `pipeline.py` | 调 `tools/image_processing/operators` 生成 6 张产物、按 `LineParams` 调 `line_with_params` 出 PNG 字节流 |
| `main.py` | 路由、CORS、静态 `storage`、上传 multipart |
| `requirements.txt` | 依赖锁版本区间 |

### 2.3 API 一览（与实现约一致）

- `GET /api/health`：版本、relic/annotation 数量
- `GET /api/relics`：文物列表摘要
- `GET /api/relics/{id}`：文物详情 + `products` 数组（与旧 `metadata.json` 结构兼容）
- `POST /api/relics`：multipart 上传 + 一次跑全管线
- `DELETE /api/relics/{id}`：删库 + 删 `storage/relics/{id}/`
- `POST /api/relics/{id}/regenerate`：用 uploads 中最新原图或 `demo/{originalFile}` 重跑
- `POST /api/line`： body 为线图参数 + `relicId`，返回 `image/png`（`X-Line-Width/Height` 头）
- `GET/POST /api/relics/{id}/annotations`、`PATCH/DELETE /api/annotations/{id}`

### 2.4 Python 侧线图参数

- 在 `tools/image_processing/operators.py` 增加 **`LineParams` + `line_with_params()`**，与前端 `LineParameterPanel` 参数对齐，供后端与 CLI 复用

### 2.5 启动方式

- 仓库根目录 **`start_backend.bat`**：`pip install -r tools/backend/requirements.txt` 后 `uvicorn tools.backend.main:app --port 8787 --reload`
- 更细说明见 `tools/backend/README.md`

### 2.6 环境注意

- 若本机 **8787 已被占用**（`WinError 10048`），需结束占用进程或改端口/配置

---

## 3. 前端（`glyphlens-web/`）

### 3.1 新增/重点文件

| 路径 | 说明 |
| --- | --- |
| `src/lib/api.ts` | 后端 `API_BASE`（默认 `http://127.0.0.1:8787`）、文物/线图/标注等 fetch 封装；可通过 `VITE_GLYPHLENS_API_BASE` 覆盖 |
| `src/stores/currentRelicStore.ts` | 全站当前文物、后端在线探测、`ensureDetail`、列表刷新 |
| `src/components/BackendStatusBanner.tsx` | 顶部小条：在线/离线/探测中 |
| `src/components/RelicPicker.tsx` | 文物切换下拉（多件时） |
| `src/modules/DatasetModule.tsx` | 数据管理：列表、上传、删、重跑管线 |
| `src/modules/AnnotationModule.tsx` | 字迹标注：OSD 底图、画框、列表、表单、调标注 API（后端离线时仅提示，无法落库） |
| `App.tsx` | `bootstrap` 调 `currentRelicStore`；四模块挂载 |
| `src/stores/appStore.ts` | 字迹标注、数据管理 **available: true** |
| `src/modules/ImageProcessingModule.tsx` | 从 store 取详情；数字线图 **默认后端** + **浏览器端实验** 切换；共享 RelicPicker + Backend 条 |
| `src/modules/MultiLayerModule.tsx` | 仍读 `public/manifests/`，但 **把当前文物 `products` 中的线图/微痕/拓片等** 注入为额外图层名（如 `proc_line`）供叠加 |

### 3.2 构建与质量

- 曾跑通 **`npm run lint`**、**`npm run build`**（主 JS chunk 约 670KB 级别，有 chunk 体积提示属正常）
- 类型：`ImageProcessing` 的 `RelicDetail` 等在 `api.ts` 与 `currentRelicStore` 中扩展了 `kind/period/location/description`

### 3.3 与 `vite.config` / 环境变量

- 未强制改 `vite` 代理；开发时前后端分端口，靠 CORS + 绝对 `API_BASE` 调后端

---

## 4. 与「原 bug」的关系

- **浏览器端** `opencv.js` 在大图/部分算子下仍可能 **长时间阻塞主线程**；现 **默认不依赖** 其完成主流程，数字线图以 **FastAPI + OpenCV 原生** 为主路径。
- 多图层、标注、数据管理均 **以后端与 SQLite 为真源**；仅在后端完全不可达时，图像处理可退回到只读 `metadata.json` 的旧体验（以 store 与实现为准）。

---

## 5. 尚未在本文档展开的细节（可后续补）

- 生产部署（Nginx 反代、HTTPS、分环境 `VITE_GLYPHLENS_API_BASE`）
- 标注模块与 CompareViewer 的 **完全统一**（当前为独立 OSD 视图）
- OpenSeadragon 5 部分断言（`drawer` 等）若仍出现，需集中修一次
- 数据库迁移脚本（现为零脚本、直接 `init_schema`）

---

## 6. 建议的本地验证顺序

1. 放 `demo/_08A9952.tif`（若做离线 `process.py`）
2. `start_backend.bat` → 确认 `http://127.0.0.1:8787/api/health`
3. 根目录 `start.bat` 或 `glyphlens-web` 下 `npm run dev`
4. 侧栏依次点：**数据管理** → **图像处理（数字线图选后端）** → **多图层** → **字迹标注**

---

---

## 7. Phase A 收尾：浏览器端 opencv 卡死温和修复

> 背景：浏览器端 `lineProcessor.renderLine` 的 OpenCV 调用与连通域像素扫描**全部同步在主线程**，大图上会形成数百毫秒的 Long Task，表现为"页面卡死"。主路径已默认走后端，这里做保守兜底，保证实验性浏览器端也能稳定跑完。

修改文件：`glyphlens-web/src/lib/lineProcessor.ts`

- **下采样上限下调**：`MAX_LONG_EDGE` 由 3072 → **2048**（与后端 `previewLongEdge` 对齐，像素量砍到 ~44%）。
- **算子间插入 `yieldFrame()`**：在 `GaussianBlur` / `Canny` / `bitwise_or` / `morph-close` / `dilate` 等重步骤后让一次帧，给浏览器重绘与响应切换模块的机会。
- **连通域大循环分批 yield**：`labels` 像素级扫描（>4M 像素）改为每 1M 像素让一次帧，彻底消除 200~400ms 的单个 Long Task。

> 未做：Web Worker 化；这是彻底方案但工作量大、且后端已是主路径，暂不引入以避免复杂度。

验证：`npm run lint` + `npm run build` 均通过；后端 `python -m py_compile` 全部 OK；`/api/health` 正常回包。

---

*文档结束。后续若有新需求，建议在本文件同目录追加 `开发进展-YYYYMMDD.md` 或在此文件用二级标题分章节追加修订记录。*
