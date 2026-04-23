import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useCurrentRelicStore } from '@/stores/currentRelicStore'

interface RelicPickerProps {
  className?: string
}

/**
 * 顶部文物切换下拉框。多模块共用，挂在当前 relic store 上。
 * 在只有 1 件文物（例如后端未启动、只有 demo）时也会正常显示，只是不可切换。
 */
export default function RelicPicker({ className }: RelicPickerProps) {
  const relics = useCurrentRelicStore((state) => state.relics)
  const activeId = useCurrentRelicStore((state) => state.activeId)
  const setActive = useCurrentRelicStore((state) => state.setActive)

  if (relics.length === 0) {
    return null
  }

  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        value={activeId ?? ''}
        onChange={(event) => setActive(event.target.value)}
        disabled={relics.length === 1}
        className={cn(
          'w-full appearance-none rounded-lg border border-paper-400/60 bg-paper-50 py-1.5 pl-3 pr-8 text-[12px] text-ink-600 transition',
          'hover:border-ochre-400/60 focus:border-ochre-500/80 focus:outline-none',
          relics.length === 1 && 'cursor-not-allowed opacity-75',
        )}
      >
        {relics.map((relic) => (
          <option key={relic.id} value={relic.id}>
            {relic.title} · {relic.id}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
    </div>
  )
}
