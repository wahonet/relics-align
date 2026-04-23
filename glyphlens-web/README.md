# GlyphLens Web

GlyphLens 的前端 MVP，面向碑刻文字与汉画像石的数字微痕工作台。

## 模块一览

- **图像处理**：展示 Python 管线生成的 5 种产物（微痕增强 / 锐化 / 灰度 / 数字线图 / 数字拓片），支持 OpenSeadragon 放大查看与原图对比。
- **多图层比对**：基于 manifest 的高精图层叠加、分屏同步。
- **字迹标注 / 数据管理**：规划中。

## 技术栈

- React 19 + Vite + TypeScript
- TailwindCSS v4（@theme 自定义画卷色板：paper / ink / ochre / seal / bamboo）
- OpenSeadragon（多图层、分屏、放大）
- Zustand（模块路由 & 多图层状态）

## 启动

```bash
cd glyphlens-web
npm install
npm run dev
```

首次启动前建议先在 `tools/image_processing/` 运行 `python process.py`，这样“图像处理”模块会看到真实产物。如果 `public/demo/processed/metadata.json` 不存在，该模块会提示执行命令。

## 目录

```text
src/
├─ App.tsx                  模块总入口
├─ modules/                 各功能模块
│  ├─ ImageProcessingModule.tsx
│  ├─ MultiLayerModule.tsx
│  └─ PlaceholderModule.tsx
├─ components/              跨模块复用组件
│  ├─ ModuleSidebar.tsx     左侧模块导航
│  ├─ ProductViewer.tsx     单图像 OSD 放大查看
│  ├─ CompareSlider.tsx     原图 / 处理 对比滑块
│  ├─ OSDViewer.tsx         多图层查看器
│  ├─ Sidebar.tsx / Workspace.tsx / LayerPanel.tsx / ...
├─ stores/
│  ├─ appStore.ts           当前模块
│  └─ viewerStore.ts        多图层状态
├─ styles/index.css         画卷主题 + 纸面纹理
└─ types/
    ├─ manifest.ts          多图层 manifest 类型
    └─ imageProcessing.ts   图像处理产物类型
```

## 画卷配色

```
paper-50/100/200/...   宣纸米黄（背景 / 卡片）
ink-300/400/500/600    墨色（正文 / 标题）
ochre-400/500/600      赭金（激活 / 高亮）
seal-500/600           朱砂（印章 / 警示）
bamboo-500             竹青（成功状态）
```

全局字体：`Noto Serif SC / Songti / STSong` 用于 h1-h3 等标题；正文使用 Inter + 中文 fallback。

## 开发命令

```bash
npm run dev     # 开发
npm run build   # 构建并做 tsc 类型检查
npm run lint    # ESLint
```
