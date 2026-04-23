"""碑刻与汉画像石微痕图像处理算子集合。

每个算子都有参数化的 `_at(image, level)` 形式，level ∈ [0, 1]：
  * 0   = 最弱/最粗（保留整体走向，细节最少）
  * 0.5 = 标准档
  * 1.0 = 最强/最细（细节最丰富，噪点相应增加）

包装函数（例如 `sharpen`, `extract_lines`）默认使用 level=0.5，
用来生成 metadata.products 里每个功能的默认缩略。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

import cv2
import numpy as np


ImageArray = np.ndarray
ColorMode = Literal["color", "gray", "binary"]


@dataclass(frozen=True)
class OperatorResult:
    key: str
    label: str
    description: str
    color_mode: ColorMode
    image: ImageArray


def _ensure_bgr(image: ImageArray) -> ImageArray:
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)

    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    return image


def _ensure_gray(image: ImageArray) -> ImageArray:
    if image.ndim == 2:
        return image

    if image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _normalize_to_uint8(image: ImageArray) -> ImageArray:
    if image.dtype == np.uint8:
        return image

    if image.dtype == np.uint16:
        return cv2.convertScaleAbs(image, alpha=255.0 / 65535.0)

    max_value = float(image.max()) if image.size else 1.0

    if max_value <= 0:
        max_value = 1.0

    return cv2.convertScaleAbs(image, alpha=255.0 / max_value)


def prepare_base(image: ImageArray) -> ImageArray:
    image = _normalize_to_uint8(image)
    image = _ensure_bgr(image)
    return image


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


# ---------------------------------------------------------------------------
# Sharpen（锐化增强）
# ---------------------------------------------------------------------------

def sharpen_at(image: ImageArray, level: float = 0.5) -> ImageArray:
    level = _clamp01(level)
    base = prepare_base(image)

    # level 0 → amount 0.5 (轻度)；level 1 → amount 2.4 (强烈)
    amount = _lerp(0.5, 2.4, level)
    radius = _lerp(2.6, 1.2, level)  # 细档 radius 更小，保留纹理

    blur = cv2.GaussianBlur(base, (0, 0), sigmaX=radius, sigmaY=radius)
    sharpened = cv2.addWeighted(base, 1.0 + amount, blur, -amount, 0)
    return sharpened


def sharpen(image: ImageArray) -> OperatorResult:
    """Unsharp Mask 高频增强，凸显刻痕边缘与纹理。"""

    return OperatorResult(
        key="sharpen",
        label="锐化增强",
        color_mode="color",
        description="基于 Unsharp Mask 的高频锐化，在原图基础上放大笔画边缘与凿刻痕迹；可用滑块调节锐化强度。",
        image=sharpen_at(image, level=0.5),
    )


# ---------------------------------------------------------------------------
# Microtrace enhancement（微痕增强）
# ---------------------------------------------------------------------------

def microtrace_at(image: ImageArray, level: float = 0.5) -> ImageArray:
    level = _clamp01(level)
    base = prepare_base(image)

    lab = cv2.cvtColor(base, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    clip_limit = _lerp(1.6, 5.0, level)
    tile = int(round(_lerp(14, 6, level)))
    tile = max(2, tile)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    l_enhanced = clahe.apply(l_channel)

    bg_sigma = _lerp(80, 40, level)
    background = cv2.GaussianBlur(l_enhanced, (0, 0), sigmaX=bg_sigma, sigmaY=bg_sigma)
    gain = _lerp(120, 160, level)
    l_float = l_enhanced.astype(np.float32) + 1.0
    background_float = background.astype(np.float32) + 1.0
    ratio = np.clip(l_float / background_float * gain, 0, 255).astype(np.uint8)

    merged = cv2.merge((ratio, a_channel, b_channel))
    enhanced_bgr = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    alpha = _lerp(0.55, 0.15, level)  # level 小时更接近原图，level 大时几乎全处理
    final = cv2.addWeighted(enhanced_bgr, 1.0 - alpha, base, alpha, 0)
    return final


def enhance_microtrace(image: ImageArray) -> OperatorResult:
    """微痕增强：多尺度 CLAHE + 去光场不均。"""

    return OperatorResult(
        key="microtrace",
        label="微痕增强",
        color_mode="color",
        description="先对 L 通道做 CLAHE，再用大核高斯做光照均匀化，使浅浮雕与风化痕迹显影；可用滑块调节显影强度。",
        image=microtrace_at(image, level=0.5),
    )


# ---------------------------------------------------------------------------
# Grayscale（灰度图）
# ---------------------------------------------------------------------------

def grayscale_at(image: ImageArray, level: float = 0.5) -> ImageArray:
    level = _clamp01(level)
    gray = _ensure_gray(_normalize_to_uint8(image))

    clip_limit = _lerp(0.8, 3.2, level)
    tile = int(round(_lerp(12, 5, level)))
    tile = max(2, tile)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    balanced = clahe.apply(gray)

    # level 高时加一点 unsharp 让纹理更硬朗
    if level > 0.6:
        blur = cv2.GaussianBlur(balanced, (0, 0), sigmaX=1.2)
        weight = (level - 0.6) / 0.4
        balanced = cv2.addWeighted(balanced, 1.0 + 0.35 * weight, blur, -0.35 * weight, 0)

    return balanced


def to_grayscale(image: ImageArray) -> OperatorResult:
    """转灰度 + 可调 CLAHE，保留纹理层次。"""

    return OperatorResult(
        key="grayscale",
        label="灰度图",
        color_mode="gray",
        description="在单通道灰度上做 CLAHE，去除色相干扰、强调石面明度结构；可用滑块调节对比强弱。",
        image=grayscale_at(image, level=0.5),
    )


# ---------------------------------------------------------------------------
# Digital line drawing（数字线图）
# ---------------------------------------------------------------------------

def line_at(image: ImageArray, level: float = 0.5) -> ImageArray:
    """参数化的数字线图。

    level = 0 → 只保留最粗的主轮廓；level = 1 → 细密纹理俱全。

    算法：
      1. 以 σ 随 level 变化的高斯模糊得到低频版本
      2. Canny 从低频版本取主边缘（粗档阈值高，细档阈值低）
      3. level > 0.3 时再叠加自适应阈值，引入细纹理
      4. 形态学 close 把断线补上
      5. **按连通域面积过滤**，粗档删掉所有小碎块，只留最大几个主轮廓
      6. 粗档做一次膨胀让描线更有手绘感
    """

    level = _clamp01(level)

    gray = _ensure_gray(_normalize_to_uint8(image))

    # 1. 多尺度低通
    sigma = _lerp(13.0, 1.2, level)
    blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)

    # 2. 主边缘（粗档更保守）
    canny_lo = int(round(_lerp(70, 25, level)))
    canny_hi = int(round(_lerp(180, 85, level)))
    edges = cv2.Canny(blurred, canny_lo, canny_hi)

    # 3. 细档额外引入自适应阈值（但做 open 去噪）
    combined = edges
    if level > 0.3:
        smoothed = cv2.bilateralFilter(gray, d=9, sigmaColor=80, sigmaSpace=80)
        block_raw = int(round(_lerp(33, 13, level)))
        block_size = block_raw if block_raw % 2 == 1 else block_raw + 1
        block_size = max(5, block_size)
        c_val = int(round(_lerp(6, 14, level)))
        adaptive = cv2.adaptiveThreshold(
            smoothed,
            maxValue=255,
            adaptiveMethod=cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            thresholdType=cv2.THRESH_BINARY_INV,
            blockSize=block_size,
            C=c_val,
        )
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        adaptive = cv2.morphologyEx(adaptive, cv2.MORPH_OPEN, kernel, iterations=1)
        combined = cv2.bitwise_or(combined, adaptive)

    # 4. 闭合断线
    close_ksize = 3 if level > 0.45 else 5
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_ksize, close_ksize))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, close_kernel, iterations=1)

    # 5. 按连通域面积过滤：level 越小，阈值越大（删更多碎块）
    img_area = combined.shape[0] * combined.shape[1]
    min_area_ratio = 0.0012 * ((1.0 - level) ** 2)
    min_area = int(img_area * min_area_ratio)

    if min_area > 0:
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(combined, connectivity=8)
        filtered = np.zeros_like(combined)
        # 按面积排序，粗档仅保留前 N 条主轮廓以避免仍有中等碎线
        if level < 0.2:
            # 最粗档：只留面积最大的 40 条线
            areas = [(i, stats[i, cv2.CC_STAT_AREA]) for i in range(1, num_labels)]
            areas.sort(key=lambda item: item[1], reverse=True)
            keep_ids = {i for i, area in areas[:40] if area >= min_area}
            for idx in keep_ids:
                filtered[labels == idx] = 255
        else:
            for i in range(1, num_labels):
                if stats[i, cv2.CC_STAT_AREA] >= min_area:
                    filtered[labels == i] = 255
        combined = filtered

    # 6. 粗档描线加粗，带点考古线图的手绘感
    if level < 0.4:
        thicken = int(round(_lerp(2, 1, level / 0.4)))
        dilate_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        combined = cv2.dilate(combined, dilate_k, iterations=max(1, thicken))

    return cv2.bitwise_not(combined)


def extract_lines(image: ImageArray) -> OperatorResult:
    """数字线图：低通 + Canny + 连通域过滤，默认档（level=0.5）。"""

    return OperatorResult(
        key="line",
        label="数字线图",
        color_mode="binary",
        description="对图像做低通后只取主边缘，再按连通域面积过滤小碎线；滑块从「粗骨架」到「细致」连续调节。",
        image=line_at(image, level=0.5),
    )


@dataclass(frozen=True)
class LineParams:
    """前端 LineParameterPanel 一一对应的完整参数集。"""

    gaussian_sigma: float = 3.2
    canny_low: int = 45
    canny_high: int = 130
    use_adaptive: bool = True
    adaptive_block_size: int = 21
    adaptive_c: int = 9
    close_kernel: int = 3  # 0 表示不做形态学闭合
    min_area_ratio: float = 0.0005
    keep_largest_n: int = 0  # 0 表示保留全部通过面积阈值的连通域
    dilate_iters: int = 0
    invert: bool = True


def line_with_params(image: ImageArray, params: LineParams) -> ImageArray:
    """根据 LineParams 生成线图（与前端 opencv.js 管线一一对应）。"""

    gray = _ensure_gray(_normalize_to_uint8(image))

    sigma = max(0.1, float(params.gaussian_sigma))
    blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)

    combined = cv2.Canny(blurred, int(params.canny_low), int(params.canny_high))

    if params.use_adaptive:
        block = int(params.adaptive_block_size)
        if block < 3:
            block = 3
        if block % 2 == 0:
            block += 1
        adaptive = cv2.adaptiveThreshold(
            gray,
            maxValue=255,
            adaptiveMethod=cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            thresholdType=cv2.THRESH_BINARY_INV,
            blockSize=block,
            C=int(params.adaptive_c),
        )
        open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        adaptive = cv2.morphologyEx(adaptive, cv2.MORPH_OPEN, open_kernel)
        combined = cv2.bitwise_or(combined, adaptive)

    close_ksize = int(params.close_kernel)
    if close_ksize > 0:
        close_ksize = max(3, close_ksize if close_ksize % 2 == 1 else close_ksize + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_ksize, close_ksize))
        combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)

    if params.min_area_ratio > 0 or params.keep_largest_n > 0:
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            combined, connectivity=8
        )
        min_area = int(combined.shape[0] * combined.shape[1] * params.min_area_ratio)

        areas = [
            (i, int(stats[i, cv2.CC_STAT_AREA]))
            for i in range(1, num_labels)
            if stats[i, cv2.CC_STAT_AREA] >= min_area
        ]

        if params.keep_largest_n > 0:
            areas.sort(key=lambda item: item[1], reverse=True)
            keep_ids = {i for i, _ in areas[: params.keep_largest_n]}
        else:
            keep_ids = {i for i, _ in areas}

        filtered = np.zeros_like(combined)
        if keep_ids:
            mask = np.isin(labels, list(keep_ids))
            filtered[mask] = 255
        combined = filtered

    if params.dilate_iters > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        combined = cv2.dilate(combined, kernel, iterations=int(params.dilate_iters))

    if params.invert:
        combined = cv2.bitwise_not(combined)

    return combined


# ---------------------------------------------------------------------------
# Digital rubbing（数字拓片）
# ---------------------------------------------------------------------------

def rubbing_at(image: ImageArray, level: float = 0.5) -> ImageArray:
    level = _clamp01(level)
    gray = _ensure_gray(_normalize_to_uint8(image))

    bg_sigma = _lerp(70, 40, level)
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=bg_sigma, sigmaY=bg_sigma)
    gray_float = gray.astype(np.float32) + 1.0
    background_float = background.astype(np.float32) + 1.0
    gain = _lerp(96, 170, level)
    normalized = np.clip(gray_float / background_float * gain, 0, 255).astype(np.uint8)

    clip_limit = _lerp(1.2, 3.8, level)
    tile = int(round(_lerp(16, 8, level)))
    tile = max(2, tile)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    contrasted = clahe.apply(normalized)

    rubbed = cv2.bitwise_not(contrasted)

    if level > 0.4:
        sharpen_amount = _lerp(0.0, 0.35, (level - 0.4) / 0.6)
        blur = cv2.GaussianBlur(rubbed, (0, 0), sigmaX=2.0)
        rubbed = cv2.addWeighted(rubbed, 1.0 + sharpen_amount, blur, -sharpen_amount, 0)

    return rubbed


def digital_rubbing(image: ImageArray) -> OperatorResult:
    """数字拓片：背景归一化 + CLAHE + 黑白反相。"""

    return OperatorResult(
        key="rubbing",
        label="数字拓片",
        color_mode="gray",
        description="高斯背景归一化消除光照不均，再做 CLAHE 和黑白反相，接近传统乌金拓片；滑块可调墨色浓淡。",
        image=rubbing_at(image, level=0.5),
    )


# ---------------------------------------------------------------------------
# 参数化渲染（与前端多滑块一一对应）
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SharpenParams:
    amount: float = 1.45       # 锐化强度 0.3 ~ 3.0
    radius: float = 1.9        # 模糊半径 0.5 ~ 5.0

def sharpen_with_params(image: ImageArray, p: SharpenParams) -> ImageArray:
    base = prepare_base(image)
    blur = cv2.GaussianBlur(base, (0, 0), sigmaX=max(0.1, p.radius), sigmaY=max(0.1, p.radius))
    return cv2.addWeighted(base, 1.0 + p.amount, blur, -p.amount, 0)


@dataclass(frozen=True)
class MicrotraceParams:
    clip_limit: float = 3.3    # CLAHE 对比度 0.5 ~ 8.0
    tile_size: int = 10        # CLAHE 分块 2 ~ 24
    bg_sigma: float = 60.0     # 背景均匀化核 10 ~ 120
    gain: float = 140.0        # 归一化增益 60 ~ 220
    blend_alpha: float = 0.35  # 与原图混合 0 ~ 1（0=纯处理，1=纯原图）

def microtrace_with_params(image: ImageArray, p: MicrotraceParams) -> ImageArray:
    base = prepare_base(image)
    lab = cv2.cvtColor(base, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)

    tile = max(2, int(round(p.tile_size)))
    clahe = cv2.createCLAHE(clipLimit=max(0.1, p.clip_limit), tileGridSize=(tile, tile))
    l_enh = clahe.apply(l_ch)

    sigma = max(1.0, p.bg_sigma)
    bg = cv2.GaussianBlur(l_enh, (0, 0), sigmaX=sigma, sigmaY=sigma)
    l_f = l_enh.astype(np.float32) + 1.0
    bg_f = bg.astype(np.float32) + 1.0
    ratio = np.clip(l_f / bg_f * p.gain, 0, 255).astype(np.uint8)

    merged = cv2.merge((ratio, a_ch, b_ch))
    enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    alpha = max(0.0, min(1.0, p.blend_alpha))
    return cv2.addWeighted(enhanced, 1.0 - alpha, base, alpha, 0)


@dataclass(frozen=True)
class GrayscaleParams:
    clip_limit: float = 2.0    # CLAHE 对比度 0.5 ~ 6.0
    tile_size: int = 8         # CLAHE 分块 2 ~ 24
    sharpen_amount: float = 0.0  # 锐化叠加 0 ~ 0.6

def grayscale_with_params(image: ImageArray, p: GrayscaleParams) -> ImageArray:
    gray = _ensure_gray(_normalize_to_uint8(image))
    tile = max(2, int(round(p.tile_size)))
    clahe = cv2.createCLAHE(clipLimit=max(0.1, p.clip_limit), tileGridSize=(tile, tile))
    balanced = clahe.apply(gray)

    amt = max(0.0, min(1.0, p.sharpen_amount))
    if amt > 0:
        blur = cv2.GaussianBlur(balanced, (0, 0), sigmaX=1.2)
        balanced = cv2.addWeighted(balanced, 1.0 + amt, blur, -amt, 0)
    return balanced


@dataclass(frozen=True)
class RubbingParams:
    bg_sigma: float = 55.0     # 背景均匀化核 10 ~ 120
    gain: float = 133.0        # 归一化增益 60 ~ 220
    clip_limit: float = 2.5    # CLAHE 对比度 0.5 ~ 6.0
    tile_size: int = 12        # CLAHE 分块 2 ~ 24
    sharpen_amount: float = 0.1  # 拓片锐化 0 ~ 0.5

def rubbing_with_params(image: ImageArray, p: RubbingParams) -> ImageArray:
    gray = _ensure_gray(_normalize_to_uint8(image))

    sigma = max(1.0, p.bg_sigma)
    bg = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)
    g_f = gray.astype(np.float32) + 1.0
    bg_f = bg.astype(np.float32) + 1.0
    normalized = np.clip(g_f / bg_f * p.gain, 0, 255).astype(np.uint8)

    tile = max(2, int(round(p.tile_size)))
    clahe = cv2.createCLAHE(clipLimit=max(0.1, p.clip_limit), tileGridSize=(tile, tile))
    contrasted = clahe.apply(normalized)
    rubbed = cv2.bitwise_not(contrasted)

    amt = max(0.0, min(1.0, p.sharpen_amount))
    if amt > 0:
        blur = cv2.GaussianBlur(rubbed, (0, 0), sigmaX=2.0)
        rubbed = cv2.addWeighted(rubbed, 1.0 + amt, blur, -amt, 0)
    return rubbed


@dataclass(frozen=True)
class OriginalParams:
    brightness: float = 0.0     # 亮度偏移 -50 ~ 50
    contrast: float = 1.0       # 对比度倍率 0.5 ~ 2.0
    saturation: float = 1.0     # 饱和度倍率 0.0 ~ 2.0
    gamma: float = 1.0          # 伽马校正 0.3 ~ 3.0

def original_with_params(image: ImageArray, p: OriginalParams) -> ImageArray:
    base = prepare_base(image)
    result = base.astype(np.float32)

    # 对比度：以 128 为中心缩放
    if p.contrast != 1.0:
        result = (result - 128.0) * max(0.01, p.contrast) + 128.0

    # 亮度
    if p.brightness != 0.0:
        result = result + p.brightness

    result = np.clip(result, 0, 255).astype(np.uint8)

    # 伽马
    if p.gamma != 1.0:
        g = max(0.1, p.gamma)
        lut = np.array([((i / 255.0) ** (1.0 / g)) * 255 for i in range(256)], dtype=np.uint8)
        result = cv2.LUT(result, lut)

    # 饱和度：在 HSV 空间调
    if p.saturation != 1.0:
        hsv = cv2.cvtColor(result, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * max(0.0, p.saturation), 0, 255)
        result = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    return result


PRODUCT_PARAMS = {
    "original": (OriginalParams, original_with_params),
    "sharpen": (SharpenParams, sharpen_with_params),
    "microtrace": (MicrotraceParams, microtrace_with_params),
    "grayscale": (GrayscaleParams, grayscale_with_params),
    "rubbing": (RubbingParams, rubbing_with_params),
}


# ---------------------------------------------------------------------------
# Operators exposed to process.py
# ---------------------------------------------------------------------------

OPERATORS: list[Callable[[ImageArray], OperatorResult]] = [
    enhance_microtrace,
    sharpen,
    to_grayscale,
    extract_lines,
    digital_rubbing,
]
