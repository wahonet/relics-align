"""Pydantic schemas for API 输入输出。"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


ColorMode = Literal["color", "gray", "binary"]
RelicKind = Literal["stele", "pictorial_stone"]


class RelicIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=120)
    kind: RelicKind = "pictorial_stone"
    period: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None


class RelicPatch(BaseModel):
    title: Optional[str] = None
    kind: Optional[RelicKind] = None
    period: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None


class ProductOut(BaseModel):
    key: str
    label: str
    description: str
    colorMode: ColorMode
    src: str
    sizeBytes: int
    width: int
    height: int


class RelicOut(BaseModel):
    id: str
    title: str
    kind: RelicKind
    period: Optional[str]
    location: Optional[str]
    description: Optional[str]
    originalFile: str
    pipelineLongEdge: int
    jpegQuality: int
    generatedAt: str
    source: str
    products: list[ProductOut]


class RelicSummary(BaseModel):
    id: str
    title: str
    kind: RelicKind
    period: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    createdAt: str
    productCount: int
    annotationCount: int


class LineRenderIn(BaseModel):
    relicId: str
    gaussianSigma: float = Field(3.2, ge=0.1, le=20.0)
    cannyLow: int = Field(45, ge=1, le=250)
    cannyHigh: int = Field(130, ge=5, le=260)
    useAdaptive: bool = True
    adaptiveBlockSize: int = Field(21, ge=3, le=99)
    adaptiveC: int = Field(9, ge=-10, le=30)
    closeKernel: int = Field(3, ge=0, le=15)
    minAreaRatio: float = Field(0.0005, ge=0.0, le=0.01)
    keepLargestN: int = Field(0, ge=0, le=500)
    dilateIters: int = Field(0, ge=0, le=6)
    invert: bool = True
    # 后端线图在原尺寸上跑；传 preview=True 则先缩到 longEdge 加速
    previewLongEdge: Optional[int] = Field(None, ge=512, le=8192)


class AnnotationIn(BaseModel):
    productKey: str = "original"
    bboxX: float = Field(..., ge=0.0, le=1.0)
    bboxY: float = Field(..., ge=0.0, le=1.0)
    bboxW: float = Field(..., gt=0.0, le=1.0)
    bboxH: float = Field(..., gt=0.0, le=1.0)
    label: Optional[str] = None
    glyph: Optional[str] = None
    note: Optional[str] = None
    author: Optional[str] = None


class AnnotationPatch(BaseModel):
    label: Optional[str] = None
    glyph: Optional[str] = None
    note: Optional[str] = None
    author: Optional[str] = None
    bboxX: Optional[float] = Field(None, ge=0.0, le=1.0)
    bboxY: Optional[float] = Field(None, ge=0.0, le=1.0)
    bboxW: Optional[float] = Field(None, gt=0.0, le=1.0)
    bboxH: Optional[float] = Field(None, gt=0.0, le=1.0)


class AnnotationOut(BaseModel):
    id: int
    relicId: str
    productKey: str
    bboxX: float
    bboxY: float
    bboxW: float
    bboxH: float
    label: Optional[str]
    glyph: Optional[str]
    note: Optional[str]
    author: Optional[str]
    createdAt: str


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    relicCount: int
    annotationCount: int


def annotation_to_out(record: dict) -> AnnotationOut:
    return AnnotationOut(
        id=int(record["id"]),
        relicId=record["relic_id"],
        productKey=record["product_key"],
        bboxX=float(record["bbox_x"]),
        bboxY=float(record["bbox_y"]),
        bboxW=float(record["bbox_w"]),
        bboxH=float(record["bbox_h"]),
        label=record.get("label"),
        glyph=record.get("glyph"),
        note=record.get("note"),
        author=record.get("author"),
        createdAt=record["created_at"],
    )
