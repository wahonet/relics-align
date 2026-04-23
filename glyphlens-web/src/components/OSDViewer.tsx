import { useEffect, useMemo, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'

import { cn } from '@/lib/cn'
import type { ViewId, ViewLayerModel } from '@/types/manifest'

interface OSDViewerProps {
  viewId: ViewId
  title: string
  layers: ViewLayerModel[]
  isActive?: boolean
  className?: string
  onViewerChange?: (viewer: OpenSeadragon.Viewer | null) => void
}

type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error'

interface LoadResult {
  item: OpenSeadragon.TiledImage
  usingFallback: boolean
}

function buildStructuralKey(layers: ViewLayerModel[]): string {
  return layers
    .map((layer) =>
      [
        layer.id,
        layer.tileSource,
        layer.fallbackTileSource,
        layer.x ?? 0,
        layer.y ?? 0,
        layer.width ?? 1,
        layer.height ?? 'auto',
      ].join(':'),
    )
    .join('|')
}

function buildPresentationKey(layers: ViewLayerModel[]): string {
  return layers.map((layer) => `${layer.id}:${layer.visible}:${layer.opacity}`).join('|')
}

function loadTiledImage(
  viewer: OpenSeadragon.Viewer,
  layer: ViewLayerModel,
  tileSource: string,
): Promise<OpenSeadragon.TiledImage> {
  return new Promise((resolve, reject) => {
    viewer.addTiledImage({
      tileSource,
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      width: layer.width ?? 1,
      height: layer.height,
      opacity: layer.visible ? layer.opacity : 0,
      success: (event) => {
        resolve((event as unknown as { item: OpenSeadragon.TiledImage }).item)
      },
      error: (error) => {
        reject(error)
      },
    })
  })
}

async function loadLayerWithFallback(
  viewer: OpenSeadragon.Viewer,
  layer: ViewLayerModel,
): Promise<LoadResult> {
  try {
    const item = await loadTiledImage(viewer, layer, layer.tileSource)
    return { item, usingFallback: false }
  } catch {
    const item = await loadTiledImage(viewer, layer, layer.fallbackTileSource)
    return { item, usingFallback: true }
  }
}

export default function OSDViewer({
  viewId,
  title,
  layers,
  isActive = false,
  className,
  onViewerChange,
}: OSDViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const tiledImageMapRef = useRef<Map<string, OpenSeadragon.TiledImage>>(new Map())
  const [status, setStatus] = useState<ViewerStatus>('idle')
  const [fallbackLayerIds, setFallbackLayerIds] = useState<string[]>([])

  const structuralKey = useMemo(() => buildStructuralKey(layers), [layers])
  const presentationKey = useMemo(() => buildPresentationKey(layers), [layers])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const viewer = OpenSeadragon({
      element: containerRef.current,
      showNavigationControl: false,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      visibilityRatio: 0.8,
      minZoomLevel: 0.5,
      maxZoomPixelRatio: 2.5,
      crossOriginPolicy: 'Anonymous',
      preserveImageSizeOnResize: true,
      animationTime: 0.8,
      blendTime: 0.15,
      gestureSettingsMouse: {
        clickToZoom: false,
      },
    })

    viewerRef.current = viewer
    onViewerChange?.(viewer)

    return () => {
      tiledImageMapRef.current.clear()
      onViewerChange?.(null)
      viewer.destroy()
      viewerRef.current = null
    }
  }, [onViewerChange])

  useEffect(() => {
    const viewer = viewerRef.current

    if (!viewer) {
      return
    }

    let cancelled = false

    const reloadLayers = async (): Promise<void> => {
      viewer.world.removeAll()
      tiledImageMapRef.current.clear()
      setFallbackLayerIds([])

      if (layers.length === 0) {
        setStatus('idle')
        return
      }

      setStatus('loading')

      const nextMap = new Map<string, OpenSeadragon.TiledImage>()
      const nextFallbackLayerIds: string[] = []

      for (const layer of layers) {
        if (cancelled) {
          return
        }

        const result = await loadLayerWithFallback(viewer, layer)
        nextMap.set(layer.id, result.item)

        if (result.usingFallback) {
          nextFallbackLayerIds.push(layer.id)
        }
      }

      if (cancelled) {
        return
      }

      tiledImageMapRef.current = nextMap
      setFallbackLayerIds(nextFallbackLayerIds)
      viewer.viewport.goHome(true)
      viewer.viewport.applyConstraints(true)
      viewer.forceRedraw()
      setStatus('ready')
    }

    void reloadLayers().catch(() => {
      if (cancelled) {
        return
      }

      setStatus('error')
    })

    return () => {
      cancelled = true
      viewer.world.removeAll()
      tiledImageMapRef.current.clear()
    }
  }, [structuralKey, layers])

  useEffect(() => {
    for (const layer of layers) {
      const image = tiledImageMapRef.current.get(layer.id)

      if (image) {
        image.setOpacity(layer.visible ? layer.opacity : 0)
      }
    }
  }, [presentationKey, layers])

  return (
    <section
      className={cn(
        'relative flex min-h-[320px] flex-col overflow-hidden rounded-2xl border bg-paper-50/90 shadow-[0_18px_40px_-28px_rgba(35,26,15,0.6)]',
        isActive ? 'border-ochre-500/70' : 'border-paper-300/80',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-paper-300/70 bg-paper-50/80 px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink-300">View {viewId === 'left' ? 'A' : 'B'}</p>
          <h3 className="font-display text-sm text-ink-600">{title}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-400">
          {fallbackLayerIds.length > 0 ? (
            <span className="rounded-full border border-seal-500/30 bg-seal-500/5 px-2 py-1 text-seal-500">
              占位瓦片
            </span>
          ) : null}
          <span
            className={cn(
              'rounded-full px-2 py-1',
              status === 'ready' && 'bg-bamboo-400/15 text-bamboo-500',
              status === 'loading' && 'bg-ochre-400/15 text-ochre-600',
              status === 'error' && 'bg-seal-500/10 text-seal-500',
              status === 'idle' && 'bg-paper-200 text-ink-300',
            )}
          >
            {status === 'ready'
              ? '已加载'
              : status === 'loading'
                ? '加载中'
                : status === 'error'
                  ? '加载失败'
                  : '待命'}
          </span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 viewer-canvas">
        <div ref={containerRef} className="absolute inset-0" />

        {status === 'loading' ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="rounded-full border border-paper-300/70 bg-paper-50/90 px-3 py-2 text-xs text-ink-400">
              正在加载高精图层...
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-700/70">
            <div className="rounded-2xl border border-seal-500/40 bg-paper-50/95 px-4 py-3 text-sm text-ink-600">
              图层加载失败，请检查 tileSource 或网络连通性。
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
