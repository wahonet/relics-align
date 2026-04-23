# GlyphLens Tiling Tools

这组脚本负责把原始高清照片转换为 `OpenSeadragon` 可直接加载的 DZI 瓦片，并自动生成前端使用的 manifest。

## 1. 环境准备

建议使用 Python 3.11+。

```bash
cd tools/tiling
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

`pyvips` 依赖 `libvips` 动态库。Windows 建议流程：

1. 从 [libvips release](https://github.com/libvips/libvips/releases) 下载 `vips-dev-w64-all-*.zip`
2. 解压到本地目录，例如 `C:\libvips`
3. 把 `C:\libvips\bin` 加到系统 `PATH`
4. 重新打开终端，再执行 `pip install -r requirements.txt`

## 2. 单张图片切瓦片

下面以碑刻原石照为例：

```bash
python tile.py --input ..\..\raw\xian_01.tif ^
               --out ..\..\glyphlens-web\public\tiles\stele\xian_beilin_01\photo_raw ^
               --tile-size 256 --overlap 1 --suffix ".jpg[Q=85]"
```

执行后会生成：

```text
glyphlens-web/public/tiles/stele/xian_beilin_01/
├─ photo_raw.dzi
└─ photo_raw_files/
```

## 3. 自动生成 manifest

当某个 item 的多个图层都切好瓦片后：

```bash
python build_manifest.py
```

脚本会扫描 `glyphlens-web/public/tiles/<kind>/<item>/*.dzi`，并在 `glyphlens-web/public/manifests/` 下写出：

- `<item>.json`
- `index.json`

生成的 manifest 适合拿来做初稿，建议后续人工补充：

- `title`
- `location`
- `period`
- `description`
- 每个 layer 的 `notes`

## 4. 推荐命名

- 碑刻：`photo_raw`, `rubbing_paper`, `rubbing_digital`, `enhanced_clahe`
- 画像石：`photo_raw`, `photo_raking_light_n/e/s/w`, `line_drawing`, `rubbing_digital`
