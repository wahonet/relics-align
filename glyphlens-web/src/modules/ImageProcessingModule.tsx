import { ChevronDown, Download, SplitSquareHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import CompareViewer from '@/components/CompareViewer'
import LineLoadingOverlay, {
  type LineOverlayState,
} from '@/components/LineLoadingOverlay'
import LineParameterPanel from '@/components/LineParameterPanel'
import { cn } from '@/lib/cn'
import {
  DEFAULT_LINE_PARAMETERS,
  getCv,
  loadLineSource,
  renderLine,
  type CvLoadProgress,
  type LineParameters,
  type LineRenderResult,
} from '@/lib/lineProcessor'
import {
  PRODUCT_ORDER,
  type ImageProcessingMetadata,
  type ImageProcessingProduct,
} from '@/types/imageProcessing'

const METADATA_URL = '/demo/processed/metadata.json'

type LineStatus =
  | { kind: 'idle' }
  | { kind: 'downloading-cv'; received: number; total: number }
  | { kind: 'decoding-cv'; wasmBytes: number }
  | { kind: 'injecting-cv'; scriptBytes: number }
  | { kind: 'initializing-cv'; elapsedMs: number }
  | { kind: 'loading-source' }
  | { kind: 'rendering'; elapsedMs: number }
  | { kind: 'done'; elapsedMs: number; byteLength: number; width: number; height: number }
  | { kind: 'error'; title: string; detail: string }

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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function ImageProcessingModule() {
  const [metadata, setMetadata] = useState<ImageProcessingMetadata | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string>('microtrace')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareKey, setCompareKey] = useState<string>('original')

  const [lineParams, setLineParams] = useState<LineParameters>(DEFAULT_LINE_PARAMETERS)
  const [lineResult, setLineResult] = useState<LineRenderResult | null>(null)
  const [lineStatus, setLineStatus] = useState<LineStatus>({ kind: 'idle' })
  const [retryToken, setRetryToken] = useState(0)
  const lineResultRef = useRef<LineRenderResult | null>(null)
  const lineRunIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    const loadMetadata = async (): Promise<void> => {
      try {
        const response = await fetch(METADATA_URL)

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }

        const data = (await response.json()) as ImageProcessingMetadata

        if (cancelled) {
          return
        }

        setMetadata(data)
        setStatus('ready')

        if (data.products.length > 0) {
          const defaultActive =
            data.products.find((product) => product.key === 'microtrace') ??
            data.products.find((product) => product.key !== 'original') ??
            data.products[0]
          setActiveKey(defaultActive.key)

          const defaultCompare =
            data.products.find(
              (product) => product.key === 'original' && product.key !== defaultActive.key,
            ) ?? data.products.find((product) => product.key !== defaultActive.key)
          if (defaultCompare) {
            setCompareKey(defaultCompare.key)
          }
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : '未知错误')
      }
    }

    void loadMetadata()

    return () => {
      cancelled = true
    }
  }, [])

  const products = useMemo(
    () => (metadata ? sortProducts(metadata.products) : []),
    [metadata],
  )

  const baseActiveProduct = useMemo(
    () => products.find((product) => product.key === activeKey) ?? products[0] ?? null,
    [products, activeKey],
  )

  // 线图实时管线：当 activeKey === 'line' 时，对 metadata.source 做参数化处理
  useEffect(() => {
    if (activeKey !== 'line' || !metadata) {
      return
    }

    const runId = lineRunIdRef.current + 1
    lineRunIdRef.current = runId
    let cancelled = false

    const onCvProgress = (progress: CvLoadProgress) => {
      if (cancelled || lineRunIdRef.current !== runId) {
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
        setLineStatus({ kind: 'injecting-cv', scriptBytes: progress.scriptBytes })
      } else if (progress.stage === 'initializing') {
        setLineStatus({ kind: 'initializing-cv', elapsedMs: progress.elapsedMs })
      }
    }

    const renderStartRef = { current: 0 }
    let renderTicker: number | null = null

    const handle = window.setTimeout(() => {
      const run = async () => {
        const renderStarted = performance.now()
        const flow = (name: string, extra?: string) => {
          const at = Math.round(performance.now() - renderStarted)
          console.log(
            `[flow] run#${runId} +${at}ms ${name}${extra ? ' · ' + extra : ''}`,
          )
        }
        flow('run-started')
        try {
          setLineStatus((prev) => {
            if (prev.kind === 'done' || prev.kind === 'rendering') {
              return prev
            }
            return { kind: 'downloading-cv', received: 0, total: 0 }
          })

          flow('before-getCv')
          await getCv(onCvProgress)
          flow(
            'after-getCv',
            `cancelled=${cancelled} runId=${lineRunIdRef.current}`,
          )

          if (cancelled || lineRunIdRef.current !== runId) {
            flow('abort-after-getCv')
            return
          }

          setLineStatus((prev) =>
            prev.kind === 'done' ? prev : { kind: 'loading-source' },
          )
          flow('before-loadLineSource', metadata.source)
          const source = await loadLineSource(metadata.source)
          flow(
            'after-loadLineSource',
            `${source.width}x${source.height} cancelled=${cancelled}`,
          )

          if (cancelled || lineRunIdRef.current !== runId) {
            flow('abort-after-loadSource')
            return
          }

          renderStartRef.current = performance.now()
          setLineStatus({ kind: 'rendering', elapsedMs: 0 })
          renderTicker = window.setInterval(() => {
            if (cancelled || lineRunIdRef.current !== runId) {
              return
            }
            setLineStatus((prev) =>
              prev.kind === 'rendering'
                ? {
                    kind: 'rendering',
                    elapsedMs: Math.round(performance.now() - renderStartRef.current),
                  }
                : prev,
            )
          }, 200)

          flow('before-renderLine')
          const result = await renderLine(source, lineParams)
          flow('after-renderLine', `${result.byteLength} bytes`)

          if (cancelled || lineRunIdRef.current !== runId) {
            URL.revokeObjectURL(result.url)
            flow('abort-after-render')
            return
          }

          if (lineResultRef.current) {
            URL.revokeObjectURL(lineResultRef.current.url)
          }
          lineResultRef.current = result
          setLineResult(result)
          setLineStatus({
            kind: 'done',
            elapsedMs: result.elapsedMs,
            byteLength: result.byteLength,
            width: result.width,
            height: result.height,
          })
          flow('done')
        } catch (error) {
          flow('run-threw', error instanceof Error ? error.message : String(error))
          if (cancelled || lineRunIdRef.current !== runId) {
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          const stack =
            error instanceof Error && error.stack ? `\n\n${error.stack}` : ''
          const phaseHint =
            performance.now() - renderStarted < 500
              ? '未能启动线图管线。'
              : lineResultRef.current
                ? '线图处理阶段失败。'
                : 'OpenCV.js / 原图加载阶段失败。'
          setLineStatus({
            kind: 'error',
            title: phaseHint,
            detail: `${message}${stack}`.slice(0, 2000),
          })
        } finally {
          if (renderTicker !== null) {
            window.clearInterval(renderTicker)
          }
        }
      }

      void run()
    }, 280)

    console.log(`[flow] effect-mounted run#${runId}`)

    return () => {
      cancelled = true
      console.log(
        `[flow] effect-cleanup run#${runId} (lineParams ref changed?)`,
      )
      window.clearTimeout(handle)
      if (renderTicker !== null) {
        window.clearInterval(renderTicker)
      }
    }
  }, [activeKey, metadata, lineParams, retryToken])

  // 组件卸载时释放最后一次的 blob URL
  useEffect(() => {
    return () => {
      if (lineResultRef.current) {
        URL.revokeObjectURL(lineResultRef.current.url)
        lineResultRef.current = null
      }
    }
  }, [])

  const activeProduct = useMemo<ImageProcessingProduct | null>(() => {
    if (!baseActiveProduct) {
      return null
    }
    if (baseActiveProduct.key === 'line' && lineResult) {
      return {
        ...baseActiveProduct,
        label: '数字线图（实时）',
        description: `由前端 opencv.js 实时生成：${lineResult.width}×${lineResult.height}`,
        src: lineResult.url,
        sizeBytes: lineResult.byteLength,
        width: lineResult.width,
        height: lineResult.height,
      }
    }
    return baseActiveProduct
  }, [baseActiveProduct, lineResult])

  const compareCandidates = useMemo(
    () => products.filter((product) => product.key !== activeKey),
    [products, activeKey],
  )

  const compareProduct = useMemo(() => {
    if (compareCandidates.length === 0) {
      return null
    }
    return (
      compareCandidates.find((product) => product.key === compareKey) ??
      compareCandidates.find((product) => product.key === 'original') ??
      compareCandidates[0]
    )
  }, [compareCandidates, compareKey])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <div className="rounded-2xl border border-paper-300/70 bg-paper-50/80 px-8 py-6 text-center shadow-sm">
          <p className="font-display text-lg text-ink-600">正在载入图像处理产物</p>
          <p className="mt-2 text-xs text-ink-400">读取 public/demo/processed/metadata.json</p>
        </div>
      </div>
    )
  }

  if (status === 'error' || !metadata) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <div className="max-w-md rounded-2xl border border-seal-500/40 bg-paper-50/90 p-8 text-center">
          <p className="font-display text-xl text-seal-500">图像处理产物尚未生成</p>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            请在仓库根目录执行以下命令，生成微痕增强、灰度、线图与数字拓片：
          </p>
          <pre className="mt-4 overflow-auto rounded-xl border border-paper-300/60 bg-ink-700/95 p-3 text-left text-[11px] leading-5 text-paper-100">
{`cd tools/image_processing
pip install -r requirements.txt
python process.py`}
          </pre>
          {errorMessage ? (
            <p className="mt-4 text-xs text-ink-300">错误详情：{errorMessage}</p>
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
    (lineStatus.kind === 'downloading-cv' ||
      lineStatus.kind === 'decoding-cv' ||
      lineStatus.kind === 'injecting-cv' ||
      lineStatus.kind === 'initializing-cv' ||
      lineStatus.kind === 'loading-source' ||
      lineStatus.kind === 'rendering')

  let overlayState: LineOverlayState | null = null
  if (isLineActive) {
    switch (lineStatus.kind) {
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
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-paper-300/70 bg-paper-50/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="seal-chip rounded-md px-2.5 py-1 text-[11px]">图像处理</span>
          <h2 className="font-display text-lg text-ink-600">{metadata.title}</h2>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-ink-400">
          <span>
            原始：<span className="text-ink-600">{metadata.originalFile}</span>
          </span>
          <span>长边 {metadata.pipelineLongEdge}px</span>
          <span>Q={metadata.jpegQuality}</span>
          <span>{formatDate(metadata.generatedAt)}</span>
          <a
            href={activeProduct.src}
            download={isLineActive ? 'line_realtime.png' : `${activeProduct.key}.jpg`}
            className="inline-flex items-center gap-1.5 rounded-full border border-paper-400/70 bg-paper-50 px-3 py-1 text-[11px] text-ink-500 transition hover:border-ochre-500/70 hover:text-ochre-600"
          >
            <Download className="h-3.5 w-3.5" />
            下载 {activeProduct.label} · {formatBytes(activeProduct.sizeBytes)}
          </a>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-paper-300/70 bg-paper-50/40 px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {products.map((product) => {
            const isActive = product.key === baseActiveProduct?.key
            return (
              <button
                key={product.key}
                type="button"
                onClick={() => setActiveKey(product.key)}
                title={product.description}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12px] transition',
                  isActive
                    ? 'border-ochre-500/80 bg-ochre-400/20 text-ochre-700 shadow-[0_6px_18px_-12px_rgba(166,119,35,0.6)]'
                    : 'border-paper-400/60 bg-paper-50 text-ink-500 hover:border-ochre-400/60 hover:text-ochre-600',
                )}
              >
                {product.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition select-none',
              compareEnabled
                ? 'border-bamboo-500/70 bg-bamboo-500/10 text-bamboo-600'
                : 'border-paper-400/60 bg-paper-50 text-ink-500 hover:border-bamboo-500/60 hover:text-bamboo-600',
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-bamboo-500"
              checked={compareEnabled}
              onChange={(event) => setCompareEnabled(event.target.checked)}
            />
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
            逐像素对比
          </label>

          {compareEnabled ? (
            <div className="relative">
              <select
                value={compareProduct?.key ?? ''}
                onChange={(event) => setCompareKey(event.target.value)}
                className="appearance-none rounded-full border border-paper-400/60 bg-paper-50 py-1.5 pl-3 pr-8 text-[12px] text-ink-600 transition hover:border-ochre-400/60 focus:border-ochre-500/80 focus:outline-none"
              >
                {compareCandidates.map((product) => (
                  <option key={product.key} value={product.key}>
                    对比 · {product.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            </div>
          ) : null}
        </div>
      </div>

      {isLineActive ? (
        <LineParameterPanel
          params={lineParams}
          onChange={setLineParams}
          processing={lineProcessing}
          status={lineStatus}
        />
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col gap-2 px-6 py-4">
        <div className="relative min-h-0 flex-1">
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
        </div>

        <p className="shrink-0 text-[11px] leading-5 text-ink-400">
          <span className="font-medium text-ink-500">{activeProduct.label}</span>
          <span className="mx-2 text-paper-400">·</span>
          {activeProduct.description}
          {compareEnabled && compareProduct ? (
            <>
              <span className="mx-2 text-paper-400">·</span>
              <span>
                拖动中间分割线可在 <span className="text-ochre-600">{compareProduct.label}</span>
                （左）与 <span className="text-ochre-600">{activeProduct.label}</span>（右）之间滑动；两侧放大倍率与平移保持同步。
              </span>
            </>
          ) : null}
        </p>
      </section>
    </div>
  )
}
