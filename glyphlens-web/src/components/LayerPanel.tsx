import { Eye, EyeOff, GripVertical, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/cn'
import { getActiveItem, useViewerStore } from '@/stores/viewerStore'
import { getDirectionLabel, isRakingLightLayer } from '@/types/manifest'

function moveLayer(order: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) {
    return order
  }

  const nextOrder = [...order]
  const draggedIndex = nextOrder.indexOf(draggedId)
  const targetIndex = nextOrder.indexOf(targetId)

  if (draggedIndex < 0 || targetIndex < 0) {
    return order
  }

  nextOrder.splice(draggedIndex, 1)
  nextOrder.splice(targetIndex, 0, draggedId)

  return nextOrder
}

export default function LayerPanel() {
  const activeItem = useViewerStore(getActiveItem)
  const activePane = useViewerStore((state) => state.activePane)
  const splitMode = useViewerStore((state) => state.splitMode)
  const paneState = useViewerStore((state) => state.views[state.activePane])
  const toggleLayerVisibility = useViewerStore((state) => state.toggleLayerVisibility)
  const setLayerOpacity = useViewerStore((state) => state.setLayerOpacity)
  const reorderLayers = useViewerStore((state) => state.reorderLayers)
  const activateExclusiveLayer = useViewerStore((state) => state.activateExclusiveLayer)
  const resetPane = useViewerStore((state) => state.resetPane)
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)

  const orderedLayers = useMemo(() => {
    if (!activeItem) {
      return []
    }

    return paneState.layerOrder
      .map((layerId) => {
        const layer = activeItem.layers.find((candidate) => candidate.id === layerId)
        const runtimeState = paneState.layerStateById[layerId]

        if (!layer || !runtimeState) {
          return null
        }

        return {
          ...layer,
          visible: runtimeState.visible,
          opacity: runtimeState.opacity,
        }
      })
      .filter((layer) => layer !== null)
  }, [activeItem, paneState])

  const rakingLayers = orderedLayers.filter((layer) => isRakingLightLayer(layer.kind))
  const activeRakingLayerId = rakingLayers.find((layer) => layer.visible)?.id ?? null

  if (!activeItem) {
    return null
  }

  return (
    <section className="rounded-2xl border border-paper-300/70 bg-paper-50/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink-300">Layer Panel</p>
          <h2 className="mt-2 font-display text-lg text-ink-600">
            图层控制 {splitMode === 2 ? `· 视图 ${activePane === 'left' ? 'A' : 'B'}` : ''}
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-400">
            调整图层可见性、不透明度与叠放顺序。
          </p>
        </div>

        <button
          type="button"
          onClick={() => resetPane(activePane)}
          className="inline-flex items-center gap-2 rounded-full border border-paper-400/70 px-3 py-2 text-sm text-ink-500 transition hover:border-ochre-500/60 hover:text-ochre-600"
        >
          <RotateCcw className="h-4 w-4" />
          重置
        </button>
      </div>

      {rakingLayers.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-seal-500/30 bg-seal-500/5 p-3">
          <p className="text-[11px] uppercase tracking-[0.3em] text-seal-500">Micro-trace</p>
          <p className="mt-1 font-display text-sm text-ink-600">掠射光方向切换</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {rakingLayers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() =>
                  activateExclusiveLayer(
                    activePane,
                    rakingLayers.map((candidate) => candidate.id),
                    layer.id,
                  )
                }
                className={cn(
                  'rounded-full border px-3 py-2 text-sm transition',
                  activeRakingLayerId === layer.id
                    ? 'border-seal-500/60 bg-seal-500/10 text-seal-600'
                    : 'border-paper-400/60 bg-paper-50 text-ink-400 hover:border-seal-500/40',
                )}
              >
                {getDirectionLabel(layer.kind) ?? layer.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {orderedLayers.map((layer) => {
          const isRaking = isRakingLightLayer(layer.kind)

          return (
            <article
              key={layer.id}
              draggable
              onDragStart={() => setDraggedLayerId(layer.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggedLayerId) {
                  return
                }

                reorderLayers(activePane, moveLayer(paneState.layerOrder, draggedLayerId, layer.id))
                setDraggedLayerId(null)
              }}
              onDragEnd={() => setDraggedLayerId(null)}
              className={cn(
                'rounded-2xl border p-3 transition',
                draggedLayerId === layer.id
                  ? 'border-ochre-500/60 bg-ochre-400/10'
                  : 'border-paper-300/70 bg-paper-50/70',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-1 text-ink-300">
                  <GripVertical className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm text-ink-600">{layer.label}</h3>
                    <span className="rounded-full border border-paper-400/70 px-2 py-[2px] text-[11px] text-ink-400">
                      {layer.kind}
                    </span>
                    {isRaking ? (
                      <span className="rounded-full border border-seal-500/30 bg-seal-500/5 px-2 py-[2px] text-[11px] text-seal-500">
                        方向组
                      </span>
                    ) : null}
                  </div>

                  {layer.notes ? (
                    <p className="mt-2 text-xs leading-5 text-ink-400">{layer.notes}</p>
                  ) : null}

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (isRaking && !layer.visible) {
                          activateExclusiveLayer(
                            activePane,
                            rakingLayers.map((candidate) => candidate.id),
                            layer.id,
                          )
                          return
                        }

                        toggleLayerVisibility(activePane, layer.id)
                      }}
                      className={cn(
                        'inline-flex h-9 w-9 items-center justify-center rounded-full border transition',
                        layer.visible
                          ? 'border-bamboo-500/50 bg-bamboo-400/15 text-bamboo-500'
                          : 'border-paper-400/60 bg-paper-50 text-ink-300',
                      )}
                      aria-label={layer.visible ? `隐藏 ${layer.label}` : `显示 ${layer.label}`}
                    >
                      {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between text-xs text-ink-400">
                        <span>透明度</span>
                        <span>{Math.round(layer.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(layer.opacity * 100)}
                        onChange={(event) =>
                          setLayerOpacity(activePane, layer.id, Number(event.target.value) / 100)
                        }
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-paper-300/80 accent-ochre-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
