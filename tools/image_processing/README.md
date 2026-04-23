# GlyphLens 图像处理管线

用 Python + OpenCV 把一张高清碑刻或汉画像石照片转换为 5 种工作产物，供前端“图像处理”模块直接加载：

| key | 说明 |
| --- | --- |
| `original` | 原图的 web 预览（长边降采样到 4096px） |
| `microtrace` | 微痕增强（LAB CLAHE + 光照均匀化） |
| `sharpen` | 锐化增强（Unsharp Mask） |
| `grayscale` | 灰度图（灰度 + 轻 CLAHE） |
| `line` | 数字线图（双边滤波 + 自适应阈值 + Canny 融合） |
| `rubbing` | 数字拓片（背景归一化 + CLAHE + 反相） |

## 1. 环境准备

```bash
cd tools/image_processing
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2. 运行管线

默认会读取 `demo/_08A9952.tif`，并把结果写到 `glyphlens-web/public/demo/processed/`：

```bash
python process.py
```

可选参数：

```bash
python process.py \
  --input ..\..\demo\_08A9952.tif \
  --out ..\..\glyphlens-web\public\demo\processed \
  --long-edge 4096 \
  --quality 92
```

执行后会得到：

```text
glyphlens-web/public/demo/processed/
├─ original.jpg
├─ microtrace.jpg
├─ sharpen.jpg
├─ grayscale.jpg
├─ line.jpg
├─ rubbing.jpg
└─ metadata.json   <- 前端直接读它
```

## 3. 自定义算子

每个算子定义在 `operators.py`，都遵循一个接口：

```python
def my_operator(image: np.ndarray) -> OperatorResult: ...
```

- 输入：任意通道数的 uint8/uint16 numpy 数组
- 输出：`OperatorResult(key, label, color_mode, description, image)`

把新的算子加到 `operators.OPERATORS` 列表中，再跑一次 `process.py` 即可出现在前端产品总览里。
