import {
  BookMarked,
  ChevronDown,
  Cpu,
  Download,
  Pencil,
  Server,
  SplitSquareHorizontal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AnnotationCard,
  AnnotationForm,
  AnnotationViewport,
  useAnnotationSession,
} from '@/components/annotation'
import CompareViewer from '@/components/CompareViewer'
import LineLoadingOverlay, {
  type LineOverlayState,
} from '@/components/LineLoadingOverlay'
import LineParameterPanel from '@/components/LineParameterPanel'
import RelicPicker from '@/components/RelicPicker'
import {
  API_BASE,
  renderLineViaBackend,
  renderProductViaBackend,
  type LineRenderResult as BackendLineResult,
  type ProductRenderResult,
} from '@/lib/api'
import { cn } from '@/lib/cn'
import {
  applyThinLine,
  DEFAULT_LINE_PARAMETERS,
  getCv,
  loadLineSource,
  renderLine,
  type CvLoadProgress,
  type LineParameters,
  type LineRenderResult as BrowserLineResult,
  type ThinLineResult,
} from '@/lib/lineProcessor'
import {
  getActiveRelicDetail,
  getActiveRelicSummary,
  useCurrentRelicStore,
} from '@/stores/currentRelicStore'
import {
  PRODUCT_ORDER,
  type ImageProcessingMetadata,
  type ImageProcessingProduct,
} from '@/types/imageProcessing'

// ---------------------------------------------------------------------------
// 产物专属参数配置（每种产物各自的滑块 + 默认值）
// ---------------------------------------------------------------------------

interface ParamSliderDef {
  key: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  defaultValue: number
  format?: (v: number) => string
}

const PRODUCT_PARAM_DEFS: Record<string, ParamSliderDef[]> = {
  original: [
    { key: 'brightness', label: '亮度', hint: '整体明暗', min: -50, max: 50, step: 1, defaultValue: 0 },
    { key: 'contrast', label: '对比度', hint: '明暗差异', min: 0.5, max: 2.0, step: 0.02, defaultValue: 1.0 },
    { key: 'saturation', label: '饱和度', hint: '色彩鲜艳程度', min: 0, max: 2.0, step: 0.02, defaultValue: 1.0 },
    { key: 'gamma', label: '伽马', hint: '暗部提亮/压暗', min: 0.3, max: 3.0, step: 0.02, defaultValue: 1.0 },
  ],
  sharpen: [
    { key: 'amount', label: '锐化强度', hint: '越大边缘越硬', min: 0.3, max: 3.0, step: 0.05, defaultValue: 1.45 },
    { key: 'radius', label: '模糊半径', hint: '越大锐化范围越宽', min: 0.5, max: 5.0, step: 0.1, defaultValue: 1.9 },
  ],
  microtrace: [
    { key: 'clip_limit', label: 'CLAHE 对比', hint: '局部对比增强', min: 0.5, max: 8.0, step: 0.1, defaultValue: 3.3 },
    { key: 'tile_size', label: 'CLAHE 分块', hint: '越小越精细', min: 2, max: 24, step: 1, defaultValue: 10 },
    { key: 'bg_sigma', label: '背景均匀化', hint: '高斯核大小', min: 10, max: 120, step: 1, defaultValue: 60 },
    { key: 'gain', label: '增益', hint: '归一化亮度', min: 60, max: 220, step: 1, defaultValue: 140 },
    { key: 'blend_alpha', label: '原图混合', hint: '0=纯处理 1=纯原图', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
  ],
  grayscale: [
    { key: 'clip_limit', label: 'CLAHE 对比', hint: '局部对比增强', min: 0.5, max: 6.0, step: 0.1, defaultValue: 2.0 },
    { key: 'tile_size', label: 'CLAHE 分块', hint: '越小越精细', min: 2, max: 24, step: 1, defaultValue: 8 },
    { key: 'sharpen_amount', label: '纹理锐化', hint: '叠加 Unsharp', min: 0, max: 0.6, step: 0.01, defaultValue: 0 },
  ],
  rubbing: [
    { key: 'bg_sigma', label: '背景均匀化', hint: '高斯核大小', min: 10, max: 120, step: 1, defaultValue: 55 },
    { key: 'gain', label: '增益', hint: '归一化亮度', min: 60, max: 220, step: 1, defaultValue: 133 },
    { key: 'clip_limit', label: 'CLAHE 对比', hint: '拓片浓淡', min: 0.5, max: 6.0, step: 0.1, defaultValue: 2.5 },
    { key: 'tile_size', label: 'CLAHE 分块', hint: '越小越精细', min: 2, max: 24, step: 1, defaultValue: 12 },
    { key: 'sharpen_amount', label: '拓片锐化', hint: '边缘清晰度', min: 0, max: 0.5, step: 0.01, defaultValue: 0.1 },
  ],
}

function getDefaultParams(key: string): Record<string, number> {
  const defs = PRODUCT_PARAM_DEFS[key]
  if (!defs) return {}
  const out: Record<string, number> = {}
  for (const d of defs) out[d.key] = d.defaultValue
  return out
}

type LineEngine = 'backend' | 'browser'

type LineStatus =
  | { kind: 'idle' }
  | { kind: 'backend-rendering'; elapsedMs: number }
  | { kind: 'downloading-cv'; received: number; total: number }
  | { kind: 'decoding-cv'; wasmBytes: number }
  | { kind: 'injecting-cv'; scriptBytes: number }
  | { kind: 'initializing-cv'; elapsedMs: number }
  | { kind: 'loading-source' }
  | { kind: 'rendering'; elapsedMs: number }
  | {
      kind: 'done'
      elapsedMs: number
      byteLength: number
      width: number
      height: number
      engine: LineEngine
    }
  | { kind: 'error'; title: string; detail: string }

interface CurrentLineResult {
  url: string
  blob?: Blob
  width: number
  height: number
  byteLength: number
  elapsedMs: number
  engine: LineEngine
}

function sortProducts(products: ImageProcessingProduct[]): ImageProcessingProduct[] {
  return [...products].sort((a, b) => {
    const ia = PRODUCT_ORDER.indexOf(a.key)
    const ib = PRODUCT_ORDER.indexOf(b.key)
    return (ia === -1 ? PRODUCT_ORDER.length : ia) - (ib === -1 ? PRODUCT_ORDER.length : ib)
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 把 panel 需要的 status 映射回老定义（简化后的 union） */
function toPanelStatus(
  status: LineStatus,
): Parameters<typeof LineParameterPanel>[0]['status'] {
  switch (status.kind) {
    case 'backend-rendering':
      return { kind: 'rendering', elapsedMs: status.elapsedMs }
    case 'done':
      return {
        kind: 'done',
        elapsedMs: status.elapsedMs,
        byteLength: status.byteLength,
        width: status.width,
        height: status.height,
      }
    default:
      return status
  }
}

export default function ImageProcessingModule() {
  const activeId = useCurrentRelicStore((state) => state.activeId)
  const activeSummary = useCurrentRelicStore((state) =>
    getActiveRelicSummary(state),
  )
  const cachedDetail = useCurrentRelicStore((state) =>
    getActiveRelicDetail(state),
  )
  const ensureDetail = useCurrentRelicStore((state) => state.ensureDetail)
  const loadState = useCurrentRelicStore((state) => state.loadState)
  const backend = useCurrentRelicStore((state) => state.backend)

  const [detailError, setDetailError] = useState<string | null>(null)

  const [activeKeyOverride, setActiveKeyOverride] = useState<string | null>(null)
  const [compareKeyOverride, setCompareKeyOverride] = useState<string | null>(null)
  const [compareEnabled, setCompareEnabled] = useState(false)
  // 标注模式：开启后视口换成 AnnotationViewport，右侧多出标注面板
  const [annotationMode, setAnnotationMode] = useState(false)

  const [lineParams, setLineParams] = useState<LineParameters>(DEFAULT_LINE_PARAMETERS)
  const [lineResult, setLineResult] = useState<CurrentLineResult | null>(null)
  const [lineStatus, setLineStatus] = useState<LineStatus>({ kind: 'idle' })
  const [retryToken, setRetryToken] = useState(0)
  const [lineEngineOverride, setLineEngineOverride] = useState<LineEngine | null>(null)
  const lineResultRef = useRef<CurrentLineResult | null>(null)
  const lineRunIdRef = useRef(0)
  const lastRelicIdRef = useRef<string | null>(activeId)

  // ---- 细线描边（完全独立的后处理）----
  const [thinEnabled, setThinEnabled] = useState(false)
  const [thinWidth, setThinWidth] = useState(2)
  const [thinResult, setThinResult] = useState<ThinLineResult | null>(null)
  const [thinProcessing, setThinProcessing] = useState(false)
  const thinResultRef = useRef<ThinLineResult | null>(null)
  const thinRunIdRef = useRef(0)

  // ---- 产物参数调节（微痕/锐化/灰度/拓片）----
  const ADJUSTABLE_KEYS = useMemo(() => new Set(['original', 'microtrace', 'sharpen', 'grayscale', 'rubbing']), [])
  const [productParams, setProductParams] = useState<Record<string, number>>(() => getDefaultParams('sharpen'))
  const [productRenderResult, setProductRenderResult] = useState<ProductRenderResult | null>(null)
  const [productRendering, setProductRendering] = useState(false)
  const [productError, setProductError] = useState<string | null>(null)
  const productResultRef = useRef<ProductRenderResult | null>(null)
  const productRunIdRef = useRef(0)
  const lastProductKeyRef = useRef<string | null>(null)

  // 推荐的引擎：后端在线时走后端；否则走浏览器端。用户点击按钮时覆写 override。
  const recommendedEngine: LineEngine =
    backend.kind === 'online' ? 'backend' : 'browser'
  const lineEngine: LineEngine = lineEngineOverride ?? recommendedEngine

  // 当前 relic 的详情：优先用 store 里的缓存；缺失时触发一次异步拉取（副作用在 store，组件自身不 setState）
  useEffect(() => {
    if (!activeId || loadState.kind !== 'ready') {
      return
    }
    if (cachedDetail) {
      return
    }
    void ensureDetail(activeId).then((d) => {
      if (!d) {
        // 用 requestAnimationFrame 兜住，避免同步 setState 触发 effect lint
        window.requestAnimationFrame(() =>
          setDetailError('未找到该文物的详情数据。'),
        )
      }
    })
  }, [activeId, cachedDetail, ensureDetail, loadState.kind])

  // metadata 直接从详情派生
  const metadata = useMemo<ImageProcessingMetadata | null>(() => {
    if (!cachedDetail) {
      return null
    }
    return {
      id: cachedDetail.id,
      title: cachedDetail.title,
      subtitle: cachedDetail.description ?? undefined,
      source: cachedDetail.source,
      originalFile: cachedDetail.originalFile,
      generatedAt: cachedDetail.generatedAt,
      pipelineLongEdge: cachedDetail.pipelineLongEdge,
      jpegQuality: cachedDetail.jpegQuality,
      products: cachedDetail.products,
    }
  }, [cachedDetail])

  const products = useMemo(
    () => (metadata ? sortProducts(metadata.products) : []),
    [metadata],
  )

  // 活跃产物：优先用户显式选择；否则自动挑 microtrace / 第一个非 original
  const activeKey = useMemo(() => {
    if (products.length === 0) {
      return ''
    }
    if (activeKeyOverride && products.some((p) => p.key === activeKeyOverride)) {
      return activeKeyOverride
    }
    const defaultActive =
      products.find((p) => p.key === 'microtrace') ??
      products.find((p) => p.key !== 'original') ??
      products[0]
    return defaultActive.key
  }, [products, activeKeyOverride])

  const setActiveKey = (key: string) => {
    setActiveKeyOverride(key)
  }

  const baseActiveProduct = useMemo(
    () => products.find((product) => product.key === activeKey) ?? products[0] ?? null,
    [products, activeKey],
  )

  // 对比产物：默认 original（或第一个非 activeKey 的）
  const compareCandidates = useMemo(
    () => products.filter((product) => product.key !== activeKey),
    [products, activeKey],
  )
  const compareProduct = useMemo(() => {
    if (compareCandidates.length === 0) {
      return null
    }
    if (
      compareKeyOverride &&
      compareCandidates.some((p) => p.key === compareKeyOverride)
    ) {
      return compareCandidates.find((p) => p.key === compareKeyOverride) ?? null
    }
    return (
      compareCandidates.find((p) => p.key === 'original') ??
      compareCandidates[0] ??
      null
    )
  }, [compareCandidates, compareKeyOverride])

  const setCompareKey = (key: string) => {
    setCompareKeyOverride(key)
  }

  const renderingLine = useCallback(
    async (runId: number, params: LineParameters, engine: LineEngine) => {
      if (!metadata || !activeId) {
        return
      }

      if (engine === 'backend') {
        const started = performance.now()
        setLineStatus({ kind: 'backend-rendering', elapsedMs: 0 })
        const ticker = window.setInterval(() => {
          if (lineRunIdRef.current !== runId) {
            return
          }
          setLineStatus({
            kind: 'backend-rendering',
            elapsedMs: Math.round(performance.now() - started),
          })
        }, 200)

        try {
          const result: BackendLineResult = await renderLineViaBackend({
            relicId: activeId,
            gaussianSigma: params.gaussianSigma,
            cannyLow: params.cannyLow,
            cannyHigh: params.cannyHigh,
            useAdaptive: params.useAdaptive,
            adaptiveBlockSize: params.adaptiveBlockSize,
            adaptiveC: params.adaptiveC,
            closeKernel: params.closeKernel,
            minAreaRatio: params.minAreaRatio,
            keepLargestN: params.keepLargestN,
            dilateIters: params.dilateIters,
            invert: params.invert,
            previewLongEdge: 2048,
          })

          if (lineRunIdRef.current !== runId) {
            URL.revokeObjectURL(result.url)
            return
          }

          if (lineResultRef.current) {
            URL.revokeObjectURL(lineResultRef.current.url)
          }
          const next: CurrentLineResult = { ...result, engine: 'backend' }
          lineResultRef.current = next
          setLineResult(next)
          setLineStatus({
            kind: 'done',
            elapsedMs: result.elapsedMs,
            byteLength: result.byteLength,
            width: result.width,
            height: result.height,
            engine: 'backend',
          })
        } catch (error) {
          if (lineRunIdRef.current !== runId) {
            return
          }
          setLineStatus({
            kind: 'error',
            title: '后端渲染失败，请检查 /api/line',
            detail:
              error instanceof Error ? error.message : String(error),
          })
        } finally {
          window.clearInterval(ticker)
        }
        return
      }

      // --- engine === 'browser' ---
      const renderStarted = performance.now()
      const onCvProgress = (progress: CvLoadProgress) => {
        if (lineRunIdRef.current !== runId) {
          return
        }
        if (progress.stage === 'downloading') {
          setLineStatus({
            kind: 'downloading-cv',
            received: progress.received,
            total: progress.total,
          })
        } else if (progress.stage === 'decoding') {
          setLineStatus({ kind: 'decoding-cv', wasmBytes: progress.wasmBytes })
        } else if (progress.stage === 'injecting') {
          setLineStatus({
            kind: 'injecting-cv',
            scriptBytes: progress.scriptBytes,
          })
        } else if (progress.stage === 'initializing') {
          setLineStatus({
            kind: 'initializing-cv',
            elapsedMs: progress.elapsedMs,
          })
        }
      }

      let renderTicker: number | null = null
      try {
        setLineStatus((prev) =>
          prev.kind === 'done' && prev.engine === 'browser'
            ? prev
            : { kind: 'downloading-cv', received: 0, total: 0 },
        )
        await getCv(onCvProgress)
        if (lineRunIdRef.current !== runId) {
          return
        }

        setLineStatus((prev) =>
          prev.kind === 'done' && prev.engine === 'browser'
            ? prev
            : { kind: 'loading-source' },
        )
        const source = await loadLineSource(metadata.source)
        if (lineRunIdRef.current !== runId) {
          return
        }

        const renderStart = performance.now()
        setLineStatus({ kind: 'rendering', elapsedMs: 0 })
        renderTicker = window.setInterval(() => {
          if (lineRunIdRef.current !== runId) {
            return
          }
          setLineStatus((prev) =>
            prev.kind === 'rendering'
              ? {
                  kind: 'rendering',
                  elapsedMs: Math.round(performance.now() - renderStart),
                }
              : prev,
          )
        }, 200)

        const result: BrowserLineResult = await renderLine(source, params)
        if (lineRunIdRef.current !== runId) {
          URL.revokeObjectURL(result.url)
          return
        }

        if (lineResultRef.current) {
          URL.revokeObjectURL(lineResultRef.current.url)
        }
        const next: CurrentLineResult = {
          url: result.url,
          blob: result.blob,
          width: result.width,
          height: result.height,
          byteLength: result.byteLength,
          elapsedMs: result.elapsedMs,
          engine: 'browser',
        }
        lineResultRef.current = next
        setLineResult(next)
        setLineStatus({
          kind: 'done',
          elapsedMs: result.elapsedMs,
          byteLength: result.byteLength,
          width: result.width,
          height: result.height,
          engine: 'browser',
        })
      } catch (error) {
        if (lineRunIdRef.current !== runId) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        const phaseHint =
          performance.now() - renderStarted < 500
            ? '浏览器端未能启动线图管线。'
            : lineResultRef.current
              ? '浏览器端线图处理失败。'
              : 'opencv.js / 原图加载失败。'
        setLineStatus({
          kind: 'error',
          title: phaseHint,
          detail: message.slice(0, 2000),
        })
      } finally {
        if (renderTicker !== null) {
          window.clearInterval(renderTicker)
        }
      }
    },
    [activeId, metadata],
  )

  // 触发线图渲染（debounced）
  useEffect(() => {
    if (activeKey !== 'line' || !metadata || !activeId) {
      return
    }

    const runId = lineRunIdRef.current + 1
    lineRunIdRef.current = runId

    const handle = window.setTimeout(() => {
      void renderingLine(runId, lineParams, lineEngine)
    }, 280)

    return () => {
      window.clearTimeout(handle)
    }
  }, [activeKey, metadata, activeId, lineParams, lineEngine, retryToken, renderingLine])

  // 卸载时释放最后一张 blob URL
  useEffect(() => {
    return () => {
      if (lineResultRef.current) {
        URL.revokeObjectURL(lineResultRef.current.url)
        lineResultRef.current = null
      }
    }
  }, [])

  // 切换文物时，清空线图（释放上一次 blob URL + 重置 status）
  useEffect(() => {
    if (lastRelicIdRef.current === activeId) {
      return
    }
    lastRelicIdRef.current = activeId
    if (lineResultRef.current) {
      URL.revokeObjectURL(lineResultRef.current.url)
      lineResultRef.current = null
    }
    setLineResult(null)
    setLineStatus({ kind: 'idle' })
    // 同时清 thin（ref 同步释放，state 延迟更新）
    if (thinResultRef.current) {
      URL.revokeObjectURL(thinResultRef.current.url)
      thinResultRef.current = null
    }
    requestAnimationFrame(() => setThinResult(null))
  }, [activeId])

  // ---- 细线描边后处理：当 lineResult 变化 或 thinWidth 变化时运行 ----
  useEffect(() => {
    if (!thinEnabled || !lineResult) {
      if (thinResultRef.current) {
        URL.revokeObjectURL(thinResultRef.current.url)
        thinResultRef.current = null
      }
      // 延迟清空避免 set-state-in-effect 同步写
      const raf = requestAnimationFrame(() => setThinResult(null))
      return () => cancelAnimationFrame(raf)
    }

    const runId = ++thinRunIdRef.current

    const handle = window.setTimeout(() => {
      setThinProcessing(true)
      void applyThinLine(lineResult.url, thinWidth, API_BASE).then((result) => {
        if (thinRunIdRef.current !== runId) {
          URL.revokeObjectURL(result.url)
          return
        }
        if (thinResultRef.current) {
          URL.revokeObjectURL(thinResultRef.current.url)
        }
        thinResultRef.current = result
        setThinResult(result)
        setThinProcessing(false)
      }).catch(() => {
        if (thinRunIdRef.current === runId) {
          setThinProcessing(false)
        }
      })
    }, 120)

    return () => {
      window.clearTimeout(handle)
    }
  }, [thinEnabled, lineResult, thinWidth])

  // 卸载时释放 thin blob
  useEffect(() => {
    return () => {
      if (thinResultRef.current) {
        URL.revokeObjectURL(thinResultRef.current.url)
        thinResultRef.current = null
      }
    }
  }, [])

  // ---- 产物参数后端渲染 ----
  // 切换产物 key 时重置参数到默认
  useEffect(() => {
    if (lastProductKeyRef.current !== activeKey) {
      lastProductKeyRef.current = activeKey
      if (productResultRef.current) {
        URL.revokeObjectURL(productResultRef.current.url)
        productResultRef.current = null
      }
      const raf = requestAnimationFrame(() => {
        setProductRenderResult(null)
        setProductParams(getDefaultParams(activeKey))
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [activeKey])

  // 参数变化时请求后端渲染
  useEffect(() => {
    if (!activeId || !ADJUSTABLE_KEYS.has(activeKey) || backend.kind !== 'online') {
      return
    }
    // 判断是否全部为默认值 → 不请求，用预生成图
    const defs = PRODUCT_PARAM_DEFS[activeKey]
    const isDefault = defs?.every((d) => productParams[d.key] === d.defaultValue)
    if (isDefault) {
      if (productResultRef.current) {
        URL.revokeObjectURL(productResultRef.current.url)
        productResultRef.current = null
      }
      const raf = requestAnimationFrame(() => setProductRenderResult(null))
      return () => cancelAnimationFrame(raf)
    }

    const runId = ++productRunIdRef.current
    const handle = window.setTimeout(() => {
      setProductRendering(true)
      setProductError(null)
      void renderProductViaBackend(activeId, activeKey, productParams).then((result) => {
        if (productRunIdRef.current !== runId) {
          URL.revokeObjectURL(result.url)
          return
        }
        if (productResultRef.current) {
          URL.revokeObjectURL(productResultRef.current.url)
        }
        productResultRef.current = result
        setProductRenderResult(result)
        setProductRendering(false)
      }).catch((err: unknown) => {
        if (productRunIdRef.current === runId) {
          setProductRendering(false)
          setProductError(err instanceof Error ? err.message : String(err))
        }
      })
    }, 350)

    return () => window.clearTimeout(handle)
  }, [activeId, activeKey, productParams, ADJUSTABLE_KEYS, backend.kind])

  // 卸载时释放 product blob
  useEffect(() => {
    return () => {
      if (productResultRef.current) {
        URL.revokeObjectURL(productResultRef.current.url)
        productResultRef.current = null
      }
    }
  }, [])

  const activeProduct = useMemo<ImageProcessingProduct | null>(() => {
    if (!baseActiveProduct) {
      return null
    }
    if (baseActiveProduct.key === 'line') {
      // 优先用细线描边结果
      if (thinEnabled && thinResult) {
        return {
          ...baseActiveProduct,
          label: `细线描边（${thinWidth}px）`,
          description: `矢量描线：${thinResult.width}×${thinResult.height}，${formatBytes(thinResult.byteLength)}，${thinResult.elapsedMs}ms`,
          src: thinResult.url,
          sizeBytes: thinResult.byteLength,
          width: thinResult.width,
          height: thinResult.height,
        }
      }
      if (lineResult) {
        const tag = lineResult.engine === 'backend' ? '后端' : '浏览器端'
        return {
          ...baseActiveProduct,
          label: `数字线图（${tag}实时）`,
          description: `${tag}实时渲染：${lineResult.width}×${lineResult.height}，${formatBytes(lineResult.byteLength)}`,
          src: lineResult.url,
          sizeBytes: lineResult.byteLength,
          width: lineResult.width,
          height: lineResult.height,
        }
      }
    }
    // 微痕/锐化/灰度/拓片参数调节后的实时结果
    if (ADJUSTABLE_KEYS.has(baseActiveProduct.key) && productRenderResult) {
      return {
        ...baseActiveProduct,
        label: `${baseActiveProduct.label}（自定义参数）`,
        description: `实时渲染：${productRenderResult.width}×${productRenderResult.height}，${formatBytes(productRenderResult.byteLength)}，${productRenderResult.elapsedMs}ms`,
        src: productRenderResult.url,
        sizeBytes: productRenderResult.byteLength,
        width: productRenderResult.width,
        height: productRenderResult.height,
      }
    }
    return baseActiveProduct
  }, [baseActiveProduct, lineResult, thinEnabled, thinResult, thinWidth, ADJUSTABLE_KEYS, productRenderResult])

  // 标注与对比互斥：开启一个就自动关闭另一个
  const toggleCompare = () => {
    setCompareEnabled((v) => {
      const next = !v
      if (next) setAnnotationMode(false)
      return next
    })
  }
  const toggleAnnotationMode = () => {
    setAnnotationMode((v) => {
      const next = !v
      if (next) setCompareEnabled(false)
      return next
    })
  }

  // 标注会话：底图 = 当前 activeProduct（即参数调节/线图实时渲染后的图）
  const annotationSession = useAnnotationSession({
    activeId,
    baseProduct: activeProduct,
    relicTitle: activeSummary?.title ?? '',
    backendOnline: backend.kind === 'online',
  })

  if (loadState.kind === 'loading' || loadState.kind === 'idle') {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <div className="rounded-2xl border border-paper-300/70 bg-paper-50/80 px-8 py-6 text-center shadow-sm">
          <p className="font-display text-lg text-ink-600">正在初始化 GlyphLens</p>
          <p className="mt-2 text-xs text-ink-400">探测后端、加载文物列表…</p>
        </div>
      </div>
    )
  }

  if (loadState.kind === 'error') {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-seal-500/40 bg-paper-50/90 p-8 text-center">
          <p className="font-display text-xl text-seal-500">初始化失败</p>
          <p className="mt-3 text-sm leading-6 text-ink-500">{loadState.message}</p>
          <p className="mt-3 text-xs text-ink-400">
            请确认后端已启动（双击 start_backend.bat），或生成 demo 产物：
          </p>
          <pre className="mt-3 overflow-auto rounded-xl border border-paper-300/60 bg-ink-700/95 p-3 text-left text-[11px] leading-5 text-paper-100">
{`cd tools/image_processing
pip install -r requirements.txt
python process.py`}
          </pre>
        </div>
      </div>
    )
  }

  if (!activeSummary || !metadata) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <div className="max-w-md rounded-2xl border border-paper-300/70 bg-paper-50/80 p-8 text-center">
          <p className="font-display text-lg text-ink-600">没有可用的文物</p>
          <p className="mt-2 text-sm text-ink-400">
            请先在"数据管理"模块上传一件文物，或运行 `python tools/image_processing/process.py`。
          </p>
          {detailError ? (
            <p className="mt-3 text-xs text-seal-500">{detailError}</p>
          ) : null}
        </div>
      </div>
    )
  }

  if (!activeProduct) {
    return null
  }

  const isLineActive = activeKey === 'line'
  const lineProcessing =
    isLineActive &&
    (lineStatus.kind === 'backend-rendering' ||
      lineStatus.kind === 'downloading-cv' ||
      lineStatus.kind === 'decoding-cv' ||
      lineStatus.kind === 'injecting-cv' ||
      lineStatus.kind === 'initializing-cv' ||
      lineStatus.kind === 'loading-source' ||
      lineStatus.kind === 'rendering')

  let overlayState: LineOverlayState | null = null
  if (isLineActive) {
    switch (lineStatus.kind) {
      case 'backend-rendering':
        if (!lineResult) {
          overlayState = { kind: 'rendering', elapsedMs: lineStatus.elapsedMs }
        }
        break
      case 'downloading-cv':
        overlayState = {
          kind: 'downloading',
          received: lineStatus.received,
          total: lineStatus.total,
        }
        break
      case 'decoding-cv':
        overlayState = { kind: 'decoding', wasmBytes: lineStatus.wasmBytes }
        break
      case 'injecting-cv':
        overlayState = { kind: 'injecting', scriptBytes: lineStatus.scriptBytes }
        break
      case 'initializing-cv':
        overlayState = { kind: 'initializing', elapsedMs: lineStatus.elapsedMs }
        break
      case 'loading-source':
        overlayState = { kind: 'loading-source' }
        break
      case 'rendering':
        if (!lineResult) {
          overlayState = { kind: 'rendering', elapsedMs: lineStatus.elapsedMs }
        }
        break
      case 'error':
        overlayState = { kind: 'error', title: lineStatus.title, detail: lineStatus.detail }
        break
      default:
        overlayState = null
    }
  }

  return (
    <div className="flex h-screen flex-1">
      {/* ====== 左侧面板 ====== */}
      <aside className="flex h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-paper-300/70 bg-paper-50/60">
        {/* 文物选择 */}
        <div className="flex items-center justify-center px-3 py-2.5">
          <RelicPicker className="w-full" />
        </div>

        {/* 对比 / 标注 开关（互斥） */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <button
            type="button"
            onClick={toggleCompare}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition',
              compareEnabled
                ? 'bg-bamboo-500/15 text-bamboo-700 ring-1 ring-bamboo-500/40'
                : 'bg-paper-100 text-ink-500 ring-1 ring-paper-300/70 hover:bg-paper-200 hover:text-ink-600',
            )}
          >
            <SplitSquareHorizontal className="h-3 w-3" />
            对比
          </button>
          <button
            type="button"
            onClick={toggleAnnotationMode}
            title="开启后可在当前图上画框标注 / OCR"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition',
              annotationMode
                ? 'bg-ochre-400/20 text-ochre-700 ring-1 ring-ochre-500/40'
                : 'bg-paper-100 text-ink-500 ring-1 ring-paper-300/70 hover:bg-paper-200 hover:text-ink-600',
            )}
          >
            <Pencil className="h-3 w-3" />
            标注
          </button>
          {compareEnabled ? (
            <div className="relative flex-1">
              <select
                value={compareProduct?.key ?? ''}
                onChange={(event) => setCompareKey(event.target.value)}
                className="w-full appearance-none rounded-lg bg-paper-100 py-1.5 pl-2 pr-7 text-[11px] text-ink-600 ring-1 ring-paper-300/70 focus:ring-ochre-500/60 focus:outline-none"
              >
                {compareCandidates.map((product) => (
                  <option key={product.key} value={product.key}>
                    {product.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400" />
            </div>
          ) : null}
        </div>

        {/* 产物选择（居中圆角卡片） */}
        <div className="mx-3 rounded-xl bg-paper-100/80 ring-1 ring-paper-300/60">
          <nav className="flex flex-col py-1">
            {products.map((product) => {
              const active = product.key === baseActiveProduct?.key
              return (
                <button
                  key={product.key}
                  type="button"
                  onClick={() => setActiveKey(product.key)}
                  className={cn(
                    'mx-1 flex items-center justify-center rounded-lg px-3 py-1.5 text-[11px] font-medium transition',
                    active
                      ? 'bg-ochre-400/15 text-ochre-700 ring-1 ring-ochre-500/30'
                      : 'text-ink-500 hover:bg-paper-200/80 hover:text-ink-700',
                  )}
                >
                  {product.label}
                </button>
              )
            })}
          </nav>
        </div>

        {/* 可调产物参数面板 */}
        {ADJUSTABLE_KEYS.has(activeKey) && backend.kind === 'online' && PRODUCT_PARAM_DEFS[activeKey] ? (
          <div className="mx-3 mt-2 flex flex-col gap-1.5 rounded-xl bg-paper-100/80 px-3 py-2 ring-1 ring-paper-300/60">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-medium text-ink-600">参数调节</span>
              {productRendering ? (
                <span className="text-ochre-600">渲染中…</span>
              ) : (
                <button
                  type="button"
                  onClick={() => { setProductParams(getDefaultParams(activeKey)); setProductError(null) }}
                  className="text-ink-400 hover:text-ochre-600"
                >
                  重置
                </button>
              )}
            </div>
            {productError ? (
              <p className="rounded bg-seal-500/10 px-2 py-1 text-[10px] leading-4 text-seal-600">
                渲染失败：{productError.slice(0, 120)}
              </p>
            ) : null}
            {PRODUCT_PARAM_DEFS[activeKey].map((def) => {
              const val = productParams[def.key] ?? def.defaultValue
              const pct = ((val - def.min) / Math.max(0.001, def.max - def.min)) * 100
              return (
                <label key={def.key} className="flex flex-col gap-0.5">
                  <span className="flex items-center justify-between text-[10px] text-ink-500">
                    <span className="font-medium text-ink-600">{def.label}</span>
                    <span className="font-mono text-ochre-700">
                      {def.format ? def.format(val) : (Number.isInteger(def.step) ? val.toFixed(0) : val.toFixed(2))}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    value={val}
                    onChange={(e) =>
                      setProductParams((prev) => ({ ...prev, [def.key]: Number(e.target.value) }))
                    }
                    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-paper-300/70 accent-ochre-500"
                    style={{
                      background: `linear-gradient(to right, var(--color-ochre-500) 0%, var(--color-ochre-500) ${pct}%, var(--color-paper-300) ${pct}%, var(--color-paper-300) 100%)`,
                    }}
                  />
                </label>
              )
            })}
          </div>
        ) : null}

        {/* 线图引擎 + 参数（仅 line 激活时） */}
        {isLineActive ? (
          <div className="mx-3 mt-2 flex min-h-0 flex-1 flex-col gap-1.5 rounded-xl bg-paper-100/80 ring-1 ring-paper-300/60">
            {/* 渲染引擎切换 */}
            <div className="flex items-center gap-1 px-3 pt-2">
              <span className="text-[10px] font-medium text-ink-400">引擎</span>
              <div className="ml-auto flex overflow-hidden rounded-lg text-[10px] ring-1 ring-paper-300/60">
                <button
                  type="button"
                  onClick={() => setLineEngineOverride('backend')}
                  disabled={backend.kind !== 'online'}
                  className={cn(
                    'px-2 py-0.5 transition',
                    lineEngine === 'backend'
                      ? 'bg-ochre-400/20 text-ochre-700'
                      : 'text-ink-500 hover:bg-paper-200',
                    backend.kind !== 'online' && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <Server className="mr-0.5 inline h-2.5 w-2.5" />
                  后端
                </button>
                <button
                  type="button"
                  onClick={() => setLineEngineOverride('browser')}
                  className={cn(
                    'border-l border-paper-300/60 px-2 py-0.5 transition',
                    lineEngine === 'browser'
                      ? 'bg-ochre-400/20 text-ochre-700'
                      : 'text-ink-500 hover:bg-paper-200',
                  )}
                >
                  <Cpu className="mr-0.5 inline h-2.5 w-2.5" />
                  浏览器
                </button>
              </div>
            </div>

            {/* 线图参数（内部可滚动，不露滚动条） */}
            <div className="min-h-0 flex-1 overflow-y-auto px-0.5 [scrollbar-width:none] [::-webkit-scrollbar]:hidden">
              <LineParameterPanel
                params={lineParams}
                onChange={setLineParams}
                processing={lineProcessing}
                status={toPanelStatus(lineStatus)}
              />
            </div>

            {/* 细线描边 */}
            <div className="flex flex-col gap-1 border-t border-paper-300/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setThinEnabled(!thinEnabled)}
                  disabled={!lineResult}
                  className={cn(
                    'relative h-4 w-7 shrink-0 rounded-full border transition',
                    thinEnabled
                      ? 'border-ochre-500/80 bg-ochre-400/60'
                      : 'border-paper-400/70 bg-paper-200',
                    !lineResult && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-paper-50 shadow transition-all',
                      thinEnabled ? 'left-[calc(100%-0.875rem)]' : 'left-0.5',
                    )}
                  />
                </button>
                <span className="text-[10px] font-medium text-ink-600">细线描边</span>
                {thinProcessing ? <span className="text-[10px] text-ochre-600">描线中…</span> : null}
              </div>
              {thinEnabled ? (
                <label className="flex flex-col gap-0.5">
                  <span className="flex items-center justify-between text-[10px] text-ink-500">
                    <span className="font-medium text-ink-600">线宽</span>
                    <span className="font-mono text-ochre-700">{thinWidth}px</span>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={0.5}
                    value={thinWidth}
                    onChange={(e) => setThinWidth(Number(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-paper-300/70 accent-ochre-500"
                    style={{
                      background: `linear-gradient(to right, var(--color-ochre-500) 0%, var(--color-ochre-500) ${((thinWidth - 1) / 7) * 100}%, var(--color-paper-300) ${((thinWidth - 1) / 7) * 100}%, var(--color-paper-300) 100%)`,
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>

      {/* ====== 中间：图像视口 ====== */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="relative min-h-0 flex-1">
          {annotationMode ? (
            <div className="absolute inset-0 overflow-hidden rounded-2xl border border-paper-300/70 bg-ink-800/95 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.5)]">
              <AnnotationViewport
                imgUrl={activeProduct.src}
                drafts={annotationSession.drafts}
                annotations={annotationSession.annotations}
                selection={annotationSession.selection}
                onDrawComplete={annotationSession.handleDrawComplete}
                onSelect={(sel) => {
                  annotationSession.setSelection(sel)
                  if (sel?.kind !== 'saved') annotationSession.setEditing(null)
                }}
                onCancel={annotationSession.handleCancel}
              />
            </div>
          ) : (
            <>
              <CompareViewer
                baseline={activeProduct}
                comparison={compareProduct}
                compareEnabled={compareEnabled && Boolean(compareProduct)}
                className="absolute inset-0"
              />
              <LineLoadingOverlay
                state={overlayState}
                onDismissError={() => setLineStatus({ kind: 'idle' })}
                onRetry={() => {
                  setLineStatus({ kind: 'idle' })
                  setRetryToken((value) => value + 1)
                }}
              />
            </>
          )}
        </div>

        <p className="shrink-0 text-[11px] leading-5 text-ink-400">
          <span className="font-medium text-ink-500">{activeProduct.label}</span>
          <span className="mx-2 text-paper-400">·</span>
          {activeProduct.description}
          {annotationMode ? (
            <>
              <span className="mx-2 text-paper-400">·</span>
              <span className="text-ink-500">左键</span>画框 ·
              <span className="mx-1 text-ink-500">中键</span>平移 ·
              <span className="mx-1 text-ink-500">滚轮</span>缩放 ·
              <span className="ml-1 text-ink-500">右键</span>
              {annotationSession.selection?.kind === 'draft'
                ? '删除草稿'
                : '清除选中'}
            </>
          ) : compareEnabled && compareProduct ? (
            <>
              <span className="mx-2 text-paper-400">·</span>
              拖动分割线在 <span className="text-ochre-600">{compareProduct.label}</span>
              （左）与 <span className="text-ochre-600">{activeProduct.label}</span>（右）间滑动
            </>
          ) : null}
        </p>
      </section>

      {/* ====== 右侧：标注面板（仅标注模式） ====== */}
      {annotationMode ? (
        <AnnotationSidePanel
          session={annotationSession}
          baseProductLabel={activeProduct.label}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 右侧标注面板：统计 / 导出 / 列表 / 表单
// ---------------------------------------------------------------------------

interface AnnotationSidePanelProps {
  session: ReturnType<typeof useAnnotationSession>
  baseProductLabel: string
}

function AnnotationSidePanel({ session, baseProductLabel }: AnnotationSidePanelProps) {
  const {
    annotations,
    drafts,
    selection,
    editing,
    currentDraft,
    listError,
    canSubmit,
    offlineHint,
    setSelection,
    setEditing,
    updateDraft,
    discardDraft,
    saveDraft,
    deleteSaved,
    startEdit,
    updateEditing,
    submitEdit,
    runOcrForDraft,
    exportJson,
  } = session

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col overflow-hidden border-l border-paper-300/70 bg-paper-50/60">
      {/* 标题 + 统计 + 导出 */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
          <BookMarked className="h-3.5 w-3.5 text-ochre-600" />
          字迹标注
        </span>
        <button
          type="button"
          onClick={exportJson}
          disabled={annotations.length === 0}
          title="导出当前文物所有已保存标注（JSON）"
          className="inline-flex items-center gap-1 rounded-lg bg-paper-50 px-2 py-0.5 text-[10px] text-ink-500 ring-1 ring-paper-300/60 transition hover:bg-paper-200 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          导出
        </button>
      </div>

      <div className="mx-3 flex items-center justify-between rounded-xl bg-paper-100/80 px-3 py-1.5 text-[11px] ring-1 ring-paper-300/60">
        <span className="text-ink-500">
          已保存 {annotations.length}
          {drafts.length ? (
            <span className="ml-1 text-ochre-600">· 草稿 {drafts.length}</span>
          ) : null}
        </span>
        <span className="truncate text-[10px] text-ink-400" title={baseProductLabel}>
          底图：{baseProductLabel}
        </span>
      </div>

      {listError ? (
        <p className="mx-3 mt-2 rounded border border-seal-500/30 bg-seal-500/5 p-2 text-[11px] text-seal-600">
          加载失败：{listError}
        </p>
      ) : null}

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-2 [scrollbar-width:none] [::-webkit-scrollbar]:hidden">
        {drafts.length === 0 && annotations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-paper-400/60 p-4 text-center text-[11px] leading-5 text-ink-400">
            还没有标注。
            <br />
            在左侧视口按
            <span className="mx-1 rounded bg-paper-200 px-1 text-ink-500">
              左键
            </span>
            拖拽画框创建。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {drafts.map((d, i) => (
              <AnnotationCard
                key={d.tempId}
                index={annotations.length + i + 1}
                color="draft"
                selected={
                  selection?.kind === 'draft' && selection.tempId === d.tempId
                }
                glyph={d.glyph}
                label={d.label || '（未保存草稿）'}
                note={d.note}
                bbox={d.bbox}
                onClick={() => {
                  setSelection({ kind: 'draft', tempId: d.tempId })
                  setEditing(null)
                }}
                onDelete={() => discardDraft(d.tempId)}
              />
            ))}
            {annotations.map((a, i) => (
              <AnnotationCard
                key={`s_${a.id}`}
                index={i + 1}
                color="saved"
                selected={selection?.kind === 'saved' && selection.id === a.id}
                glyph={a.glyph ?? ''}
                label={a.label || '（未命名）'}
                note={a.note ?? ''}
                bbox={{ x: a.bboxX, y: a.bboxY, w: a.bboxW, h: a.bboxH }}
                onClick={() => {
                  setSelection({ kind: 'saved', id: a.id })
                  setEditing(null)
                }}
                onEdit={() => startEdit(a)}
                onDelete={() => void deleteSaved(a.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {currentDraft ? (
        <AnnotationForm
          title={`新标注（底图：${baseProductLabel}）`}
          values={currentDraft}
          saving={!!currentDraft.saving}
          error={currentDraft.error ?? null}
          submitLabel="保存"
          canSubmit={canSubmit}
          submitHint={offlineHint}
          onChange={(patch) => updateDraft(currentDraft.tempId, patch)}
          onSubmit={() => void saveDraft(currentDraft)}
          onCancel={() => discardDraft(currentDraft.tempId)}
          onOcr={() => void runOcrForDraft(currentDraft)}
          ocrLoading={!!currentDraft.ocrLoading}
          ocrError={currentDraft.ocrError ?? null}
          ocrHint={offlineHint ?? undefined}
        />
      ) : editing ? (
        <AnnotationForm
          title={`编辑 #${editing.id}`}
          values={editing}
          saving={!!editing.saving}
          error={editing.error ?? null}
          submitLabel="更新"
          canSubmit={canSubmit}
          submitHint={offlineHint}
          onChange={updateEditing}
          onSubmit={() => void submitEdit()}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </aside>
  )
}
