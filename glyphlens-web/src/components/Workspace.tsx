import { useMemo } from 'react'

import SplitView from '@/components/SplitView'
import Toolbar from '@/components/Toolbar'
import { getActiveItem, useViewerStore } from '@/stores/viewerStore'
import type { PaneState } from '@/stores/viewerStore'
import { ITEM_KIND_LABELS, type ResolvedItemManifest, type ViewLayerModel } from '@/types/manifest'

function buildLayersForPane(item: ResolvedItemManifest, pane: PaneState): ViewLayerModel[] {
  return pane.layerOrder
    .map((layerId) => {
      const layer = item.layers.find((candidate) => candidate.id === layerId)
      const runtimeState = pane.layerStateById[layerId]

      if (!layer || !runtimeState) {
        return null
      }

      return {
        ...layer,
        visible: runtimeState.visible,
        opacity: runtimeState.opacity,
      }
    })
    .filter((layer): layer is ViewLayerModel => layer !== null)
}

export default function Workspace() {
  const activeItem = useViewerStore(getActiveItem)
  const splitMode = useViewerStore((state) => state.splitMode)
  const syncEnabled = useViewerStore((state) => state.syncEnabled)
  const activePane = useViewerStore((state) => state.activePane)
  const leftPane = useViewerStore((state) => state.views.left)
  const rightPane = useViewerStore((state) => state.views.right)

  const leftLayers = useMemo(
    () => (activeItem ? buildLayersForPane(activeItem, leftPane) : []),
    [activeItem, leftPane],
  )
  const rightLayers = useMemo(
    () => (activeItem ? buildLayersForPane(activeItem, rightPane) : []),
    [activeItem, rightPane],
  )

  if (!activeItem) {
    return (
      <section className="flex min-h-full items-center justify-center px-6">
        <div className="max-w-md rounded-3xl border border-paper-300/70 bg-paper-50/90 p-8 text-center">
          <p className="text-[11px] uppercase tracking-[0.35em] text-ink-300">GlyphLens</p>
          <h1 className="mt-3 font-display text-2xl text-ink-600">尚未加载任何碑刻图像集</h1>
          <p className="mt-3 text-sm leading-6 text-ink-400">
            请检查 `public/manifests/index.json` 是否存在，或在侧边栏中补充示例 manifest。
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-full min-w-0 flex-col">
      <div className="border-b border-paper-300/70 bg-paper-50/60 px-6 py-5 backdrop-blur">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-ink-300">Workspace</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl text-ink-600">{activeItem.title}</h1>
              <span className="rounded-full border border-ochre-500/40 bg-ochre-400/15 px-3 py-1 text-xs text-ochre-600">
                {ITEM_KIND_LABELS[activeItem.kind]}
              </span>
              {activeItem.period ? (
                <span className="rounded-full border border-paper-400/60 px-3 py-1 text-xs text-ink-400">
                  {activeItem.period}
                </span>
              ) : null}
              {activeItem.location ? (
                <span className="rounded-full border border-paper-400/60 px-3 py-1 text-xs text-ink-400">
                  {activeItem.location}
                </span>
              ) : null}
            </div>
            {activeItem.description ? (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-400">{activeItem.description}</p>
            ) : null}
          </div>

          <Toolbar item={activeItem} />
        </div>
      </div>

      <SplitView
        item={activeItem}
        splitMode={splitMode}
        syncEnabled={syncEnabled}
        activePane={activePane}
        leftLayers={leftLayers}
        rightLayers={rightLayers}
      />
    </section>
  )
}
