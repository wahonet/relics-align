import { GripVertical, Home } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'

import { cn } from '@/lib/cn'
import type { ImageProcessingProduct } from '@/types/imageProcessing'

interface CompareViewerProps {
  baseline: ImageProcessingProduct
  comparison: ImageProcessingProduct | null
  compareEnabled: boolean
  className?: string
}

interface View {
  scale: number
  tx: number
  ty: number
}

/**
 * 图像对比视口：两张图重叠渲染、共享一个 pan/zoom 变换，
 * 通过 clip-path 把对比图从中缝向左展示。
 *
 * 交互：左键拖拽 pan、滚轮以鼠标为锚缩放、Home 按钮 fit。
 * 基准图 natural 尺寸未变时保留 view，切到不同尺寸会重新 fit。
 */
export default function CompareViewer({
  baseline,
  comparison,
  compareEnabled,
  className,
}: CompareViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const baselineImgRef = useRef<HTMLImageElement | null>(null)
  const panRef = useRef<{
    startX: number
    startY: number
    origTx: number
    origTy: number
  } | null>(null)
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null)

  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 })
  const [baselineReady, setBaselineReady] = useState(false)
  const [comparisonReady, setComparisonReady] = useState(false)
  const [baselineFailed, setBaselineFailed] = useState(false)
  const [split, setSplit] = useState(0.5)

  const hasCompare =
    compareEnabled && !!comparison && comparison.key !== baseline.key

  // 切 src 时重置 ready 标记（但保留 view，等 onLoad 根据尺寸决定是否 fit）
  useEffect(() => {
    setBaselineReady(false)
    setBaselineFailed(false)
  }, [baseline.src])

  useEffect(() => {
    setComparisonReady(false)
  }, [comparison?.src])

  const fitTo = useCallback((imgW: number, imgH: number) => {
    const root = rootRef.current
    if (!root || !imgW || !imgH) return
    const cw = root.clientWidth
    const ch = root.clientHeight
    const scale = Math.min(cw / imgW, ch / imgH) * 0.95
    setView({
      scale,
      tx: (cw - imgW * scale) / 2,
      ty: (ch - imgH * scale) / 2,
    })
  }, [])

  // 容器尺寸变化：如果图的自然尺寸未变（即用户未进入过别件文物），就按当前 naturalSize 重 fit
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      const img = baselineImgRef.current
      if (img?.naturalWidth && img.naturalHeight) {
        fitTo(img.naturalWidth, img.naturalHeight)
      }
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [fitTo])

  const handleBaselineLoad = () => {
    const img = baselineImgRef.current
    if (!img) return
    setBaselineReady(true)
    const size = { w: img.naturalWidth, h: img.naturalHeight }
    const last = lastSizeRef.current
    // 同尺寸（通常是"同件文物不同产物"）保留视角；异尺寸 fit
    if (!last || last.w !== size.w || last.h !== size.h) {
      fitTo(size.w, size.h)
    }
    lastSizeRef.current = size
  }

  const handleReset = () => {
    const img = baselineImgRef.current
    if (img?.naturalWidth) {
      fitTo(img.naturalWidth, img.naturalHeight)
    }
  }

  // ---- pan / zoom ----
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!baselineReady) return
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    const cx = e.clientX - r.left
    const cy = e.clientY - r.top
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.max(0.05, Math.min(40, v.scale * factor))
      const k = next / v.scale
      return {
        scale: next,
        tx: cx - k * (cx - v.tx),
        ty: cy - k * (cy - v.ty),
      }
    })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!baselineReady) return
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origTx: view.tx,
      origTy: view.ty,
    }
    rootRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan) return
    setView((v) => ({
      ...v,
      tx: pan.origTx + (e.clientX - pan.startX),
      ty: pan.origTy + (e.clientY - pan.startY),
    }))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null
      rootRef.current?.releasePointerCapture(e.pointerId)
    }
  }

  // ---- split 拖动条 ----
  const startSplitDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const update = (clientX: number) => {
        const ratio = Math.min(
          0.98,
          Math.max(0.02, (clientX - rect.left) / rect.width),
        )
        setSplit(ratio)
      }
      update(event.clientX)
      const onMove = (ev: PointerEvent) => update(ev.clientX)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [],
  )

  const clipPath = useMemo(
    () => `inset(0 ${Math.round((1 - split) * 10000) / 100}% 0 0)`,
    [split],
  )

  const transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-paper-400/60 bg-ink-800 shadow-[0_24px_60px_-35px_rgba(35,26,15,0.8)] select-none touch-none',
        panRef.current ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* 基准图 */}
      <div
        className="absolute left-0 top-0"
        style={{
          transform,
          transformOrigin: 'top left',
          visibility: baselineReady ? 'visible' : 'hidden',
        }}
      >
        <img
          ref={baselineImgRef}
          src={baseline.src}
          alt=""
          draggable={false}
          onLoad={handleBaselineLoad}
          onError={() => setBaselineFailed(true)}
          className="block"
          style={{ maxWidth: 'none' }}
        />
      </div>

      {/* 对比图：只显示左半边（由 split 控制） */}
      {hasCompare ? (
        <div
          className="pointer-events-none absolute left-0 top-0 h-full w-full"
          style={{ clipPath, WebkitClipPath: clipPath }}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              transform,
              transformOrigin: 'top left',
              visibility: comparisonReady ? 'visible' : 'hidden',
            }}
          >
            <img
              src={comparison!.src}
              alt=""
              draggable={false}
              onLoad={() => setComparisonReady(true)}
              className="block"
              style={{ maxWidth: 'none' }}
            />
          </div>
        </div>
      ) : null}

      {/* Home */}
      <button
        type="button"
        onClick={handleReset}
        title="回到全图 (Home)"
        className="absolute right-3 bottom-3 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300/70 bg-paper-50/90 text-ink-500 shadow-sm transition hover:border-ochre-500/70 hover:text-ochre-600"
      >
        <Home className="h-4 w-4" />
      </button>

      {hasCompare ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-20 bg-ochre-400/80"
            style={{ left: `calc(${split * 100}% - 1px)`, width: '2px' }}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(split * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="absolute inset-y-0 z-30 flex cursor-ew-resize items-center justify-center"
            style={{ left: `calc(${split * 100}% - 14px)`, width: '28px' }}
            onPointerDown={startSplitDrag}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-ochre-500/80 bg-paper-50 text-ochre-600 shadow-[0_8px_22px_-10px_rgba(35,26,15,0.5)]">
              <GripVertical className="h-4 w-4" />
            </span>
          </div>

          <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full border border-paper-300/60 bg-paper-50/90 px-3 py-1 text-[11px] text-ink-500 shadow-sm">
            左 · {comparison?.label ?? '—'}
          </div>
          <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-full border border-paper-300/60 bg-paper-50/90 px-3 py-1 text-[11px] text-ink-500 shadow-sm">
            右 · {baseline.label}
          </div>
        </>
      ) : null}

      {!baselineReady && !baselineFailed ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          <span className="rounded-full border border-paper-300/60 bg-paper-50/90 px-3 py-1 text-xs text-ink-400">
            正在载入 {baseline.label}…
          </span>
        </div>
      ) : null}

      {baselineFailed ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink-800/80">
          <div className="rounded-xl border border-seal-500/40 bg-paper-50/95 px-4 py-3 text-sm text-ink-600">
            主图加载失败：请确认后端产物或 `public/storage/relics/` 下的文件。
          </div>
        </div>
      ) : null}

      {hasCompare && !comparisonReady ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center">
          <span className="rounded-full border border-paper-300/60 bg-paper-50/90 px-3 py-1 text-xs text-ink-400">
            正在载入对比图 {comparison?.label ?? ''}…
          </span>
        </div>
      ) : null}
    </div>
  )
}
