# GlyphLens

面向**碑刻文字**与**汉画像石**的数字文物微痕展示与分析系统。本仓库目前处于 MVP 阶段：前端（Vite + React + TS + Tailwind v4）+ 本地 Python 图像处理管线 + 浏览器端 OpenCV.js 实时线图。

截图见 `docs/`（暂未收录，后续补）。

---

## 当前状态速览（2026-04-23）

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 图像处理 · 后端产物 | ✅ 稳定 | `tools/image_processing/process.py` 生成 5 张默认 JPG：原始高清 / 微痕增强 / 锐化增强 / 灰度图 / 数字拓片 |
| 图像处理 · 前端 UI | ✅ 稳定 | 画卷米黄主题、窄侧栏图标导航、顶部产品切换、`OpenSeadragon` 高精查看、逐像素拖动对比滑块 |
| **数字线图 · 实时参数化** | ⚠️ **正在排障** | 已用浏览器端 `opencv.js` 打通整条管线；加载/初始化已可见进度；但具体渲染阶段在用户机器上会卡住主线程（见下文） |
| 多图层比对 | ✅ 可用 | OSD 双视图同步、叠加、分屏 |
| 字迹标注 | ⏳ 规划中 | 下一阶段 |
| 数据管理 | ⏳ 规划中 | 下一阶段 |

---

## 目录结构

```text
.
├─ demo/                              原始照片（.tif 不入库，自行放置）
├─ glyphlens-web/                     前端
│   ├─ src/
│   │   ├─ modules/ImageProcessingModule.tsx     图像处理主界面
│   │   ├─ components/
│   │   │   ├─ CompareViewer.tsx                 OSD 双窗口 + 逐像素对比滑块
│   │   │   ├─ LineParameterPanel.tsx            数字线图参数面板（sigma/Canny/close/…）
│   │   │   └─ LineLoadingOverlay.tsx            opencv.js 加载/初始化 overlay
│   │   └─ lib/lineProcessor.ts                  opencv.js 加载 + 线图渲染管线
│   ├─ scripts/copy-opencv.mjs                   把 opencv.js 拷到 public/vendor（不入库）
│   └─ public/demo/processed/                    离线管线生成的 5 张产物 JPG
├─ tools/
│   ├─ image_processing/                         Python 离线管线
│   └─ tiling/                                   DZI 瓦片化脚本（多图层比对用）
├─ start.bat                                     Windows 一键启动开发服务器
└─ README.md                                     本文件
```

---

## 快速开始

### 1. 生成图像处理产物（离线）

```bash
cd tools/image_processing
pip install -r requirements.txt
python process.py                   # 读取 demo/_08A9952.tif，产物写到 glyphlens-web/public/demo/processed/
```

### 2. 启动前端

**Windows 一键：** 双击根目录 `start.bat`。

**手动：**

```bash
cd glyphlens-web
npm install
npm run dev                         # 会自动 predev: 从 node_modules 拷 opencv.js 到 public/vendor/
```

打开 `http://localhost:5173` → 默认进入"图像处理"模块。顶部切换产品（原始高清/微痕/锐化/灰度/数字线图/数字拓片），右上角"逐像素对比"可开启分屏滑块。

---

## 架构要点

### 前端 opencv.js 实时线图

- **为什么前端跑 OpenCV**：数字线图参数（Gaussian σ、Canny 低/高、adaptive blockSize / C、morphClose、保留最大 N 连通域等）希望实时可调；全做到后端会有严重延迟。选择 `@techstark/opencv-js`（WASM 打包，离线可用）。
- **加载策略**：`scripts/copy-opencv.mjs` 在 `predev` / `prebuild` 时把 `opencv.js`（10.4 MB）拷到 `public/vendor/`，**不进 bundle**、不入库。bundle 仍保持 ~620 KB。
- **关键绕道（`src/lib/lineProcessor.ts`）**：
  1. `fetch('/vendor/opencv.js')` + `ReadableStream` → 实时下载进度；
  2. 正则抽出内嵌的 `wasmBinaryFile="data:application/octet-stream;base64,..."`，用 `atob` 解码成 `Uint8Array`；
  3. 从脚本文本中**剥掉 base64 wasm**（10MB → 225KB），注入体积和解析开销骤降；
  4. 替换 `if (typeof Module === 'undefined') var Module = {}` 让它改从 `window.__cvPreModule` 取，提前挂上 `wasmBinary` + `instantiateWasm`（用 `WebAssembly.compileStreaming`，真 off-thread）+ `onRuntimeInitialized`；
  5. `Module.print` / `Module.printErr` 全程捕获 emscripten 日志；超时错误附上所有里程碑时间戳。

### 离线 Python 管线（`tools/image_processing/`）

- `operators.py`：5 个算子（sharpen / microtrace / grayscale / rubbing / line）的单次默认实现。
- `process.py`：Typer CLI，读取原图 → 每个算子各输出一张 JPG + `metadata.json`。

---

## 当前阻塞问题（优先级最高）

**症状**：切到"数字线图"后，浏览器主线程被某一步同步卡住，直到 Chrome 弹"页面无响应"。

**已排除**：
- ❌ 不是 opencv.js 下载（下载 ~340 ms 就完成）
- ❌ 不是 wasm 编译（`compileStreaming` 后 +217ms `wasm-compiled`，+341ms `cv.Mat-ready`）
- ❌ 不是 `fetch(data:...)` 数据 URL 挂起（已被绕过）

**F12 最新日志**（`src/lib/lineProcessor.ts` 里 `mark(...)` 打的）:

```
[opencv] +0ms   start
[opencv] +101ms downloaded · 10.87 MB
[opencv] +341ms cv.Mat-ready
(之后 UI overlay 仍停留在 "注入 OpenCV.js")
```

说明 OpenCV 已完全就绪，卡死在**之后**的阶段，嫌疑定位：
1. `loadLineSource(metadata.source)` — 把 `original.jpg`（~6 MB / 8192 × 4096）缩到 3072 长边后 `getImageData`；
2. `renderLine()` 里的某个 OpenCV 算子在 3072 × 4096 单线程 WASM 上耗时过长，其中 `connectedComponentsWithStats` + 过滤循环最可疑。

已经给 `loadLineSource` / `renderLine` / React effect 每一步都挂了 `console.log`（`[flow]` / `[source]` / `[line]` 前缀），下次再跑一次就能精确定位到哪个算子卡住。

---

## 下一步计划

### Phase A（解当前阻塞，1–2 个工作日）

1. **根据 `[flow] / [line]` 日志精确定位卡死的算子**，可能的几种情况：
   - 如果是 `connectedComponentsWithStats` 卡：默认把 `minAreaRatio` / `keepLargestN` 关闭，或在 JS 侧只遍历 stats 而不逐像素重绘 mask；
   - 如果是 `loadLineSource` 卡：先把原图尺寸 max long edge 降到 2048，canvas 在 `requestIdleCallback` 里异步 `drawImage`；
   - 如果依旧是整条管线卡主线程：**整体迁到 Web Worker**，主线程只负责 UI。
2. 把默认线图参数调整到不会触发重算子（blockSize 小、close 关、minArea 关），让首次进入"数字线图"就能秒出默认结果。
3. 修掉 OpenSeadragon 5.x 的 `[TiledImage] options.drawer is required` assert（给 `viewer.open` 传 `drawer: 'canvas'`）。

### Phase B（完成前端 MVP）

1. "数字线图"的预设组升级：粗骨架 / 标准 / 细致 三档 + 参数面板；渲染结果可导出 PNG / 叠加到原图。
2. 其他 4 个算子也下沉到浏览器端，配置 1-2 个关键参数即可实时预览（目前只有后端单图）。
3. 多图层比对模块支持叠加"数字线图"层（当前靠静态 JPG）。

### Phase C（后端化与数据管理）

1. 引入 FastAPI + SQLite / PostgreSQL：上传原图、存储产物 + 元数据 + 版本。
2. 前端 `metadata.json` 改为后端接口驱动，支持多文物切换。
3. 字迹标注：框选 + 候选字推荐（参考 `文字库.csv` / `字库对照表.docx`）。
4. 画像石 3D / RTI 多光源合成（研究阶段）。

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
