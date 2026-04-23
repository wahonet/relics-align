import { GripVertical, Home } from 'lucide-react'
import OpenSeadragon from 'openseadragon'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { cn } from '@/lib/cn'
import { createViewportSync } from '@/lib/osdSync'
import type { ImageProcessingProduct } from '@/types/imageProcessing'

interface CompareViewerProps {
  baseline: ImageProcessingProduct
  comparison: ImageProcessingProduct | null
  compareEnabled: boolean
  className?: string
}

const OSD_OPTIONS: Partial<OpenSeadragon.Options> = {
  showNavigationControl: false,
  showNavigator: false,
  visibilityRatio: 0.25,
  minZoomImageRatio: 0.6,
  maxZoomPixelRatio: 6,
  defaultZoomLevel: 0,
  animationTime: 0.5,
  blendTime: 0.1,
  constrainDuringPan: false,
  gestureSettingsMouse: {
    clickToZoom: false,
    dblClickToZoom: true,
    scrollToZoom: true,
    flickEnabled: true,
  },
}

export default function CompareViewer({
  baseline,
  comparison,
  compareEnabled,
  className,
}: CompareViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const baselineHostRef = useRef<HTMLDivElement | null>(null)
  const comparisonHostRef = useRef<HTMLDivElement | null>(null)
  const baselineViewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const comparisonViewerRef = useRef<OpenSeadragon.Viewer | null>(null)

  const [split, setSplit] = useState(0.5)
  const [baselineStatus, setBaselineStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [comparisonStatus, setComparisonStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const host = baselineHostRef.current
    if (!host) {
      return
    }

    const viewer = OpenSeadragon({
      element: host,
      ...OSD_OPTIONS,
    })

    const handleOpen = () => setBaselineStatus('ready')
    const handleFail = () => setBaselineStatus('error')
    viewer.addHandler('open', handleOpen)
    viewer.addHandler('open-failed', handleFail)

    baselineViewerRef.current = viewer

    return () => {
      viewer.removeHandler('open', handleOpen)
      viewer.removeHandler('open-failed', handleFail)
      viewer.destroy()
      baselineViewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = baselineViewerRef.current
    if (!viewer) {
      return
    }

    let preservedCenter: OpenSeadragon.Point | null = null
    let preservedZoom: number | null = null
    if (viewer.world.getItemCount() > 0) {
      preservedCenter = viewer.viewport.getCenter(true)
      preservedZoom = viewer.viewport.getZoom(true)
    }

    const handleOnce = () => {
      if (preservedCenter !== null && preservedZoom !== null) {
        viewer.viewport.panTo(preservedCenter, true)
        viewer.viewport.zoomTo(preservedZoom, preservedCenter, true)
        viewer.forceRedraw()
      }
    }
    viewer.addOnceHandler('open', handleOnce)

    setBaselineStatus('loading')
    viewer.open({ tileSource: { type: 'image', url: baseline.src } })
  }, [baseline.src])

  useEffect(() => {
    if (!compareEnabled || !comparison) {
      return
    }

    const host = comparisonHostRef.current
    const primary = baselineViewerRef.current
    if (!host || !primary) {
      return
    }

    setComparisonStatus('loading')

    const viewer = OpenSeadragon({
      element: host,
      ...OSD_OPTIONS,
      mouseNavEnabled: false,
    })

    const handleOpen = () => {
      setComparisonStatus('ready')
      if (primary.world.getItemCount() === 0) {
        return
      }
      const center = primary.viewport.getCenter(true)
      const zoom = primary.viewport.getZoom(true)
      viewer.viewport.panTo(center, true)
      viewer.viewport.zoomTo(zoom, center, true)
      viewer.forceRedraw()
    }
    const handleFail = () => setComparisonStatus('error')
    viewer.addHandler('open', handleOpen)
    viewer.addHandler('open-failed', handleFail)

    comparisonViewerRef.current = viewer
    viewer.open({ tileSource: { type: 'image', url: comparison.src } })

    const disposeSync = createViewportSync({ leftViewer: primary, rightViewer: viewer })

    return () => {
      disposeSync()
      viewer.removeHandler('open', handleOpen)
      viewer.removeHandler('open-failed', handleFail)
      viewer.destroy()
      comparisonViewerRef.current = null
    }
  }, [compareEnabled, comparison])

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const root = rootRef.current
      if (!root) {
        return
      }

      const rect = root.getBoundingClientRect()

      const updateFromClientX = (clientX: number) => {
        const ratio = Math.min(0.98, Math.max(0.02, (clientX - rect.left) / rect.width))
        setSplit(ratio)
      }

      updateFromClientX(event.clientX)

      const handleMove = (ev: PointerEvent) => updateFromClientX(ev.clientX)
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [],
  )

  const clipPath = `inset(0 ${Math.round((1 - split) * 10000) / 100}% 0 0)`

  const hasCompare = compareEnabled && comparison && comparison.key !== baseline.key

  const resetView = useCallback(() => {
    const primary = baselineViewerRef.current
    if (primary && primary.world.getItemCount() > 0) {
      primary.viewport.goHome(false)
    }
    const secondary = comparisonViewerRef.current
    if (secondary && secondary.world.getItemCount() > 0) {
      secondary.viewport.goHome(false)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-paper-400/60 bg-ink-800 shadow-[0_24px_60px_-35px_rgba(35,26,15,0.8)]',
        className,
      )}
    >
      <div ref={baselineHostRef} className="viewer-canvas absolute inset-0" />

      {hasCompare ? (
        <div
          ref={comparisonHostRef}
          className="viewer-canvas pointer-events-none absolute inset-0"
          style={{ clipPath, WebkitClipPath: clipPath }}
        />
      ) : null}

      <button
        type="button"
        onClick={resetView}
        title="回到全图 (Home)"
        className="absolute right-3 bottom-3 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300/70 bg-paper-50/90 text-ink-500 shadow-sm transition hover:border-ochre-500/70 hover:text-ochre-600"
      >
        <Home className="h-4 w-4" />
      </button>

      {hasCompare ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-20 border-l border-r border-ochre-500/80 bg-ochre-400/80"
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
            onPointerDown={startDrag}
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

      {baselineStatus === 'loading' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          <span className="rounded-full border border-paper-300/60 bg-paper-50/90 px-3 py-1 text-xs text-ink-400">
            正在载入 {baseline.label}...
          </span>
        </div>
      ) : null}

      {baselineStatus === 'error' ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink-800/80">
          <div className="rounded-xl border border-seal-500/40 bg-paper-50/95 px-4 py-3 text-sm text-ink-600">
            主图加载失败，请检查 `public/demo/processed/` 下的文件。
          </div>
        </div>
      ) : null}

      {hasCompare && comparisonStatus === 'loading' ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center">
          <span className="rounded-full border border-paper-300/60 bg-paper-50/90 px-3 py-1 text-xs text-ink-400">
            正在载入对比图 {comparison?.label ?? ''}...
          </span>
        </div>
      ) : null}
    </div>
  )
}
