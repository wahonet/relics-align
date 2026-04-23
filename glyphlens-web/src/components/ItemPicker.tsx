import { cn } from '@/lib/cn'
import { getActiveItem, useViewerStore } from '@/stores/viewerStore'
import { ITEM_KIND_LABELS } from '@/types/manifest'

export default function ItemPicker() {
  const items = useViewerStore((state) => state.items)
  const activeItem = useViewerStore(getActiveItem)
  const setActiveItem = useViewerStore((state) => state.setActiveItem)

  return (
    <section className="rounded-2xl border border-paper-300/70 bg-paper-50/80 p-4">
      <div className="mb-4">
        <p className="text-[11px] uppercase tracking-[0.3em] text-ink-300">Item Picker</p>
        <h2 className="mt-2 font-display text-lg text-ink-600">图像集</h2>
        <p className="mt-1 text-sm leading-6 text-ink-400">
          先切换碑刻与画像石示例，后续可替换为真实 manifest。
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const isActive = item.id === activeItem?.id

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveItem(item.id)}
              className={cn(
                'w-full rounded-2xl border p-4 text-left transition',
                isActive
                  ? 'border-ochre-500/60 bg-ochre-400/10'
                  : 'border-paper-300/70 bg-paper-50/60 hover:border-ochre-400/50 hover:bg-paper-50',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm text-ink-600">{item.title}</h3>
                <span className="rounded-full border border-paper-400/70 px-2 py-[2px] text-[11px] text-ink-400">
                  {ITEM_KIND_LABELS[item.kind]}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-400">
                {item.period ? <span>{item.period}</span> : null}
                {item.location ? <span>{item.location}</span> : null}
              </div>

              {item.description ? (
                <p className="mt-3 text-sm leading-6 text-ink-400">{item.description}</p>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
