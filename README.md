# GlyphLens

面向**碑刻文字**与**汉画像石**的数字文物微痕展示与分析系统。前端 Vite + React + TS + Tailwind v4；后端 FastAPI + SQLite + OpenCV；数字线图后端渲染为主、浏览器 `opencv.js` 为实验选项；字迹标注支持区域 OCR（`rapidocr` · PP-OCRv4 ONNX）。

截图见 `docs/`（暂未收录，后续补）。

---

## 当前状态速览（2026-04-24）

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 图像处理 · 后端产物 | ✅ 稳定 | `tools/image_processing/process.py` 生成 5 张默认 JPG：原始高清 / 微痕增强 / 锐化增强 / 灰度图 / 数字拓片 |
| 图像处理 · 前端 UI | ✅ 稳定 | 画卷米黄主题、窄侧栏图标导航、左栏产物切换、对比滑块；产物参数化实时重渲染 |
| 数字线图 · 实时参数化 | ✅ 后端主路径 | 后端 `POST /api/line` + OpenCV 原生；浏览器 `opencv.js` 保留为实验选项（默认关闭） |
| 细线描边 | ✅ | 后端 `/api/thin-line`（`cv2.findContours + drawContours`） |
| 字迹标注 | ✅ 已集成 | 画框 / 平移 / 缩放 / 归一化 bbox；底图可切到任意产物；**已并入图像处理模块**（互斥开关），独立入口暂保留 |
| **区域 OCR** | ✅ | `POST /api/ocr`：裁切选区 → `rapidocr` 识别 → 回填释读/标签；首次调用自动下载 ~15 MB ONNX 模型 |
| 数据管理 | ✅ 可用 | 上传原图 → 一次跑全管线 → SQLite 入库；删 / 重跑管线 |
| 后端 API | ✅ | FastAPI + SQLite；相关 Schemas 与前端 camelCase 对齐 |

---

## 目录结构

```text
.
├─ demo/                              原始照片（.tif 不入库，自行放置）
├─ docs/                              开发进展 / 设计笔记
├─ glyphlens-web/                     前端
│   ├─ src/
│   │   ├─ modules/
│   │   │   ├─ ImageProcessingModule.tsx         图像处理 + 集成字迹标注（核心）
│   │   │   ├─ AnnotationModule.tsx              独立字迹标注入口（计划合并后移除）
│   │   │   └─ DatasetModule.tsx                 数据管理（上传/重跑/删除）
│   │   ├─ components/
│   │   │   ├─ CompareViewer.tsx                 对比滑块
│   │   │   ├─ LineParameterPanel.tsx            数字线图参数面板
│   │   │   ├─ LineLoadingOverlay.tsx            opencv.js 加载 overlay
│   │   │   ├─ BackendStatusBanner.tsx           后端在线/离线
│   │   │   ├─ RelicPicker.tsx                   文物切换下拉
│   │   │   └─ annotation/                       字迹标注公共组件（Viewport/Card/Form/Hook）
│   │   ├─ stores/
│   │   │   ├─ currentRelicStore.ts              当前文物 + 后端探测
│   │   │   └─ appStore.ts                       模块路由
│   │   └─ lib/
│   │       ├─ api.ts                            后端 API 封装（relic / line / product / ocr / annotation）
│   │       └─ lineProcessor.ts                  浏览器端 opencv.js 管线（实验）
│   ├─ scripts/copy-opencv.mjs                   把 opencv.js 拷到 public/vendor（不入库）
│   └─ public/storage/glyphlens.sqlite3          SQLite 单文件库
├─ tools/
│   ├─ backend/                                  FastAPI + SQLite + OpenCV（主后端）
│   ├─ image_processing/                         离线产物生成 + 算子库
│   └─ tiling/                                   DZI 瓦片化脚本（历史，已停用）
├─ start.bat / start_backend.bat                 Windows 一键启动
└─ README.md                                     本文件
```

---

## 快速开始

### 1. 启动后端（主路径）

```powershell
cd E:\relics-align
pip install -r tools/backend/requirements.txt
python -m uvicorn tools.backend.main:app --reload --port 8787
# 或双击：start_backend.bat
```

后端首次启动会空库自检并从 `public/demo/processed/metadata.json` 种子一条文物；首次调用 `/api/ocr` 时 `rapidocr` 会自动下载 PP-OCRv4 的三个 ONNX 模型（约 15 MB）到 `site-packages/rapidocr/models/`。

验证：`curl http://127.0.0.1:8787/api/health` → 200。

### 2. （可选）离线生成图像处理产物

```bash
cd tools/image_processing
pip install -r requirements.txt
python process.py                   # 读取 demo/_08A9952.tif，产物写到 glyphlens-web/public/demo/processed/
```

### 3. 启动前端

**Windows 一键：** 双击根目录 `start.bat`。

**手动：**

```bash
cd glyphlens-web
npm install
npm run dev                         # 会自动 predev: 从 node_modules 拷 opencv.js 到 public/vendor/
```

打开 `http://localhost:5173` → 默认进入"图像处理"模块。左栏切换产物（原始高清/微痕/锐化/灰度/数字线图/数字拓片），对顶部 **对比** 按钮开启分屏滑块，**标注** 按钮开启画框 + 右侧标注面板（与对比互斥）；draft 表单上 **识别** 按钮会把框内区域送到后端 OCR 并回填释读/标签。

---

## 架构要点

### 后端（`tools/backend/`，主路径）

- **FastAPI + SQLite**，数据库文件位于 `glyphlens-web/public/storage/glyphlens.sqlite3`（与前端 `public` 同目录方便 Vite 静态直出，后端也挂了 `/storage`）
- **产物参数化**：五种产物（原始 / 锐化 / 微痕 / 灰度 / 拓片）各自 dataclass 参数集，`/api/render-product` 接 JSON body 实时渲染；`operators.PRODUCT_PARAMS` 字典与前端 `PRODUCT_PARAM_DEFS` 一一对应
- **数字线图**：`/api/line` 接 `LineParams`，OpenCV 原生实现，返回 PNG 字节流 + `X-Line-Width/Height` 头
- **细线描边**：`/api/thin-line` 独立后处理，`cv2.findContours + drawContours`
- **区域 OCR**：`/api/ocr` 裁切选区 → `rapidocr` (PP-OCRv4 ONNX) 识别 → 返回 `{text, items:[{text, score}]}`；引擎延迟加载、首次调用自动下模型
- **标注 CRUD**：`/api/relics/{id}/annotations`、`/api/annotations/{id}`，归一化 bbox（0~1 浮点）

详见 `docs/开发进展-Phase-BC.md` 与 `docs/开发进展-20260424.md`。

### 前端字迹标注 · `components/annotation/`

- `AnnotationViewport` —— `<img>` + 容器级 `transform scale/translate`，归一化 bbox 用 CSS `%` 定位；画框 / 平移 / 滚轮缩放全自绘，不依赖 OSD
- `useAnnotationSession` —— 单 hook 封装列表拉取 / 草稿 / 保存 / OCR / 编辑 / 删除 / 导出
- **视口缩放保留**：切同尺寸底图（原图/锐化/微痕/线图…）不 fit，仅首次 / 真的换了分辨率才 fit —— 用户在图像处理模块调参数时画好的框和视角完全保留
- **独立模块 / 集成模块共用**：`modules/AnnotationModule.tsx` 和 `modules/ImageProcessingModule.tsx` 都消费同一套组件与 hook

### 前端 opencv.js 实时线图（实验性）

浏览器端 `opencv.js` 仍可用作降级，默认已切到后端 `/api/line`：

- `scripts/copy-opencv.mjs` 在 `predev` / `prebuild` 时把 `opencv.js`（10.4 MB）拷到 `public/vendor/`，**不进 bundle**、不入库
- `src/lib/lineProcessor.ts` 做了 base64 wasm 剥离 + `WebAssembly.compileStreaming` + 算子间 `yieldFrame`，避免 Long Task；细节见 `docs/开发进展-Phase-BC.md` §7

### 离线 Python 管线（`tools/image_processing/`）

- `operators.py`：5 个算子（sharpen / microtrace / grayscale / rubbing / line）+ 各自 `*_with_params()` 参数化入口 + `PRODUCT_PARAMS` 字典
- `process.py`：Typer CLI，读取原图 → 每个算子各输出一张 JPG + `metadata.json`（供后端首次 seed）

---

## 下一步计划

1. **合并独立字迹标注入口**：集成体验确认稳定后删除 `modules/AnnotationModule.tsx`、`stores/appStore.ts` 的 `'annotation'` 模块 ID、`ModuleSidebar` 对应菜单项
2. **OCR 体验增强**：draft 卡片显示识别置信度；对已保存标注暴露「重识别」按钮；多行结果可选择回填方式
3. **标注导出增强**：JSON / CSV / 带底图截图的复合报告
4. **画像石 3D / RTI**：多光源合成，研究阶段

---

## 设计主题

- 主色：宣纸米黄 `paper`
- 墨色：字迹与正文 `ink`
- 赭金：高亮与激活 `ochre`
- 朱砂：印章与警示 `seal`
- 显示字体：`Noto Serif SC` / `Songti SC` / `STSong`

---

## 贡献 / 运行注意

- `demo/*.tif` 原图 ~120 MB，不入库；请自行放入 `demo/` 后再跑离线管线。
- `glyphlens-web/public/vendor/opencv.js` 由 `scripts/copy-opencv.mjs` 自动生成，不入库。
- `public/demo/processed/*.jpg` 是离线管线生成的默认产物，已入库方便 clone 后直接启动。
