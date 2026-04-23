import ItemPicker from '@/components/ItemPicker'
import LayerPanel from '@/components/LayerPanel'
import { getActiveItem, useViewerStore } from '@/stores/viewerStore'

export default function Sidebar() {
  const activeItem = useViewerStore(getActiveItem)

  return (
    <aside className="flex min-h-full flex-col border-r border-paper-300/70 bg-paper-50/60">
      <div className="border-b border-paper-300/70 px-5 py-6">
        <p className="text-[11px] uppercase tracking-[0.4em] text-ink-300">Multi-layer</p>
        <h1 className="mt-3 font-display text-2xl text-ink-600">碑刻与画像石比对</h1>
        <p className="mt-3 text-sm leading-6 text-ink-400">
          通过高精查看、图层叠加与分屏同步，对照研究原石、拓片与各类处理产物。
        </p>

        {activeItem ? (
          <div className="mt-4 rounded-2xl border border-paper-300/70 bg-paper-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.3em] text-ink-300">Current Item</p>
            <h2 className="mt-2 font-display text-sm text-ink-600">{activeItem.title}</h2>
            <p className="mt-2 text-xs leading-5 text-ink-400">
              当前阶段以前端静态 manifest 驱动，后续可切换到 FastAPI + SQLite 元数据源。
            </p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 paper-scrollbar">
        <ItemPicker />
        <LayerPanel />
      </div>

      <div className="border-t border-paper-300/70 px-5 py-4 text-[11px] leading-5 text-ink-300">
        本地没有真实 DZI 时，查看器会自动回退到 OpenSeadragon 官方示例瓦片，方便先跑通 UI。
      </div>
    </aside>
  )
}
