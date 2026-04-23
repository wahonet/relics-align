import { BookMarked, Database, Layers, Sparkles } from 'lucide-react'

import { cn } from '@/lib/cn'
import { MODULES, useAppStore, type ModuleId } from '@/stores/appStore'

const ICONS: Record<ModuleId, typeof Sparkles> = {
  imageProcessing: Sparkles,
  multiLayer: Layers,
  annotation: BookMarked,
  dataset: Database,
}

export default function ModuleSidebar() {
  const activeModule = useAppStore((state) => state.activeModule)
  const setActiveModule = useAppStore((state) => state.setActiveModule)

  return (
    <aside className="flex min-h-screen w-20 shrink-0 flex-col items-center border-r border-paper-300/70 bg-paper-50/70 backdrop-blur">
      <div
        className="mt-4 flex h-11 w-11 items-center justify-center rounded-xl border border-seal-500/60 bg-seal-500/10 text-seal-500"
        title="GlyphLens · 碑刻与画像石微痕工作台"
      >
        <span className="font-display text-lg leading-none">碑</span>
      </div>

      <nav className="mt-6 flex w-full flex-1 flex-col items-center gap-2 px-2">
        {MODULES.map((module) => {
          const Icon = ICONS[module.id]
          const isActive = activeModule === module.id

          return (
            <button
              key={module.id}
              type="button"
              onClick={() => setActiveModule(module.id)}
              disabled={!module.available}
              title={module.available ? module.title : `${module.title}（规划中）`}
              className={cn(
                'group flex w-full flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 transition',
                isActive
                  ? 'border-ochre-500/70 bg-ochre-400/15 text-ochre-600 shadow-[0_8px_24px_-18px_rgba(166,119,35,0.6)]'
                  : 'border-transparent text-ink-400 hover:border-paper-400/60 hover:bg-paper-100 hover:text-ink-600',
                !module.available && 'cursor-not-allowed opacity-45 hover:bg-transparent',
              )}
            >
              <Icon className="h-5 w-5" />
              <span
                className={cn(
                  'text-[11px] leading-tight tracking-wide',
                  isActive ? 'text-ochre-700' : 'text-ink-500 group-hover:text-ink-700',
                )}
              >
                {module.title}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="mb-3 text-[10px] uppercase tracking-[0.3em] text-ink-300" title="GlyphLens v0.1">
        v0.1
      </div>
    </aside>
  )
}
