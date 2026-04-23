import { CloudOff, RefreshCw, Zap } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useCurrentRelicStore } from '@/stores/currentRelicStore'

interface BackendStatusBannerProps {
  className?: string
  dense?: boolean
}

/** 顶部横向展示的后端状态条：在线（绿色）/ 离线（黄色）/ 探测中（灰色） */
export default function BackendStatusBanner({
  className,
  dense,
}: BackendStatusBannerProps) {
  const backend = useCurrentRelicStore((state) => state.backend)
  const bootstrap = useCurrentRelicStore((state) => state.bootstrap)

  if (backend.kind === 'online') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-bamboo-500/50 bg-bamboo-500/10 text-[11px] text-bamboo-700',
          dense ? 'px-2 py-0.5' : 'px-3 py-1',
          className,
        )}
      >
        <Zap className="h-3 w-3" />
        <span className="font-medium">后端在线</span>
        <span className="text-bamboo-600/80">v{backend.version}</span>
        <span className="text-bamboo-600/60">·</span>
        <span>{backend.relicCount} 件文物</span>
      </div>
    )
  }

  if (backend.kind === 'offline') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-seal-500/50 bg-seal-500/5 text-[11px] text-seal-600',
          dense ? 'px-2 py-0.5' : 'px-3 py-1',
          className,
        )}
        title={`原因：${backend.reason}\n\n启动后端：双击仓库根目录的 start_backend.bat`}
      >
        <CloudOff className="h-3 w-3" />
        <span className="font-medium">后端离线</span>
        <button
          type="button"
          onClick={() => void bootstrap()}
          className="inline-flex items-center gap-1 rounded-full bg-paper-50 px-2 py-0.5 text-[10px] text-seal-600 hover:bg-paper-100"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          重试
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-paper-400/70 bg-paper-100 text-[11px] text-ink-400',
        dense ? 'px-2 py-0.5' : 'px-3 py-1',
        className,
      )}
    >
      <RefreshCw className="h-3 w-3 animate-spin" />
      <span>探测后端…</span>
    </div>
  )
}
