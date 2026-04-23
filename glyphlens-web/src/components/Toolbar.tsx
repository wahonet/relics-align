import { Columns2, RefreshCw, Search, Sparkles, Square } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useViewerStore } from '@/stores/viewerStore'
import type { ResolvedItemManifest } from '@/types/manifest'

interface ToolbarProps {
  item: ResolvedItemManifest
}

function ToolButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active?: boolean
  onClick: () => void
  icon: typeof Square
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition',
        active
          ? 'border-ochre-500/60 bg-ochre-400/15 text-ochre-600'
          : 'border-paper-400/60 bg-paper-50 text-ink-500 hover:border-ochre-500/50 hover:text-ink-600',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function DisabledAction({
  icon: Icon,
  label,
  hint,
}: {
  icon: typeof Square
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      disabled
      title={hint}
      className="inline-flex items-center gap-2 rounded-full border border-paper-300/70 bg-paper-100/70 px-3 py-2 text-sm text-ink-300"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

export default function Toolbar({ item }: ToolbarProps) {
  const splitMode = useViewerStore((state) => state.splitMode)
  const activePane = useViewerStore((state) => state.activePane)
  const syncEnabled = useViewerStore((state) => state.syncEnabled)
  const setSplitMode = useViewerStore((state) => state.setSplitMode)
  const setActivePane = useViewerStore((state) => state.setActivePane)
  const setSyncEnabled = useViewerStore((state) => state.setSyncEnabled)

  const placeholderActions =
    item.kind === 'stele'
      ? [
          { label: 'CLAHE 增强', icon: Sparkles, hint: 'Phase 2 接 FastAPI + OpenCV' },
          { label: '数字拓印', icon: Sparkles, hint: 'Phase 2 接数字拓印接口' },
          { label: '字框识别', icon: Search, hint: 'Phase 3 接古文字识别模型' },
        ]
      : [
          { label: '掠射增强', icon: Sparkles, hint: 'Phase 2 接图像增强接口' },
          { label: '数字拓印', icon: Sparkles, hint: 'Phase 2 接数字拓印接口' },
          { label: '线条提取', icon: Search, hint: 'Phase 3 接线条分割模型' },
        ]

  return (
    <div className="flex flex-col gap-3 xl:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.3em] text-ink-300">布局</span>
        <ToolButton
          active={splitMode === 1}
          onClick={() => setSplitMode(1)}
          icon={Square}
          label="单视图"
        />
        <ToolButton
          active={splitMode === 2}
          onClick={() => setSplitMode(2)}
          icon={Columns2}
          label="双视图"
        />

        {splitMode === 2 ? (
          <>
            <div className="mx-1 h-6 w-px bg-paper-300" />
            <button
              type="button"
              onClick={() => setActivePane('left')}
              className={cn(
                'rounded-full px-3 py-2 text-sm transition',
                activePane === 'left'
                  ? 'bg-ink-600 text-paper-50'
                  : 'bg-paper-50 text-ink-500 hover:text-ink-600',
              )}
            >
              编辑视图 A
            </button>
            <button
              type="button"
              onClick={() => setActivePane('right')}
              className={cn(
                'rounded-full px-3 py-2 text-sm transition',
                activePane === 'right'
                  ? 'bg-ink-600 text-paper-50'
                  : 'bg-paper-50 text-ink-500 hover:text-ink-600',
              )}
            >
              编辑视图 B
            </button>
            <button
              type="button"
              onClick={() => setSyncEnabled(!syncEnabled)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition',
                syncEnabled
                  ? 'border-bamboo-500/60 bg-bamboo-400/15 text-bamboo-500'
                  : 'border-paper-400/60 bg-paper-50 text-ink-400',
              )}
            >
              <RefreshCw className="h-4 w-4" />
              {syncEnabled ? '同步缩放已开' : '同步缩放已关'}
            </button>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.3em] text-ink-300">后续能力</span>
        {placeholderActions.map((action) => (
          <DisabledAction
            key={action.label}
            icon={action.icon}
            label={action.label}
            hint={action.hint}
          />
        ))}
      </div>
    </div>
  )
}
