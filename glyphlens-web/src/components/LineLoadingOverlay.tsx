import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'

import { cn } from '@/lib/cn'

export type LineOverlayState =
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'decoding'; wasmBytes: number }
  | { kind: 'injecting'; scriptBytes: number }
  | { kind: 'initializing'; elapsedMs: number }
  | { kind: 'rendering'; elapsedMs: number }
  | { kind: 'loading-source' }
  | { kind: 'error'; title: string; detail: string }

interface LineLoadingOverlayProps {
  state: LineOverlayState | null
  onDismissError?: () => void
  onRetry?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function ProgressBar({
  percent,
  indeterminate,
}: {
  percent?: number
  indeterminate?: boolean
}) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-paper-100/60">
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ochre-400 via-ochre-500 to-bamboo-500 transition-[width] duration-200 ease-out',
          indeterminate && 'w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite]',
        )}
        style={indeterminate ? undefined : { width: `${Math.max(2, Math.min(100, percent ?? 0))}%` }}
      />
      <style>{`@keyframes indeterminate {
        0% { transform: translateX(-100%); }
        60% { transform: translateX(220%); }
        100% { transform: translateX(220%); }
      }`}</style>
    </div>
  )
}

export default function LineLoadingOverlay({
  state,
  onDismissError,
  onRetry,
}: LineLoadingOverlayProps) {
  if (!state) {
    return null
  }

  if (state.kind === 'error') {
    return (
      <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-ink-700/55 backdrop-blur-[2px]">
        <div className="relative max-w-xl rounded-2xl border border-seal-500/60 bg-paper-50/97 p-6 shadow-xl">
          <button
            type="button"
            onClick={onDismissError}
            className="absolute right-3 top-3 rounded-full p-1 text-ink-400 transition hover:bg-paper-200/80 hover:text-ink-600"
            aria-label="关闭提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-full bg-seal-500/15 p-2 text-seal-500">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base text-seal-500">{state.title}</p>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-paper-300/70 bg-paper-100/60 p-3 text-[11px] leading-5 text-ink-500">
{state.detail}
              </pre>
              <p className="mt-3 text-[11px] leading-5 text-ink-400">
                常见排查：
                <br />
                · 确认 <code className="text-ochre-700">public/vendor/opencv.js</code> 已存在（仓库根目录运行 <code className="text-ochre-700">npm --prefix glyphlens-web run prepare:opencv</code>）。
                <br />
                · 打开浏览器 DevTools → Network 看 <code className="text-ochre-700">/vendor/opencv.js</code> 的状态码。
                <br />
                · WebAssembly 初始化超时可能是浏览器内存不足，换个浏览器或重启后再试。
              </p>
              {onRetry ? (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ochre-500/70 bg-ochre-400/15 px-3 py-1.5 text-[12px] text-ochre-700 transition hover:bg-ochre-400/25"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新加载
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 非错误状态走统一进度面板
  let title = '准备中'
  let subtitle = ''
  let percent: number | undefined
  let indeterminate = false

  if (state.kind === 'downloading') {
    const safeTotal = state.total > 0 ? state.total : Math.max(state.received, 10_000_000)
    percent = (state.received / safeTotal) * 100
    title = '正在加载 OpenCV.js 运行库'
    subtitle = `${formatBytes(state.received)} / ${formatBytes(safeTotal)} · ${Math.round(percent)}%`
  } else if (state.kind === 'decoding') {
    title = '正在解码 WebAssembly 字节码'
    subtitle = `从脚本中抽出 ${formatBytes(state.wasmBytes)} 的 wasm，绕开浏览器 fetch 挂起`
    indeterminate = true
  } else if (state.kind === 'injecting') {
    title = '正在注入精简后的 OpenCV.js 脚本'
    subtitle = `脚本体积 ${formatBytes(state.scriptBytes)}，已剥离 base64 wasm`
    indeterminate = true
  } else if (state.kind === 'initializing') {
    title = '正在初始化 WebAssembly 运行时'
    subtitle = `已耗时 ${(state.elapsedMs / 1000).toFixed(1)} 秒（WASM 编译通常 3~15 秒）`
    indeterminate = true
  } else if (state.kind === 'loading-source') {
    title = '正在载入原图到内存'
    subtitle = '从 /demo/processed/original.jpg 抽样到长边 3072'
    indeterminate = true
  } else if (state.kind === 'rendering') {
    title = '正在计算线图'
    subtitle = `本次耗时 ${(state.elapsedMs / 1000).toFixed(1)} 秒`
    indeterminate = true
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-ink-700/35 backdrop-blur-[1px]">
      <div className="w-[min(420px,80%)] rounded-2xl border border-paper-300/70 bg-paper-50/95 p-5 shadow-xl">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink-600">
          <Loader2 className="h-4 w-4 animate-spin text-ochre-500" />
          <span>{title}</span>
        </div>
        {subtitle ? (
          <p className="mt-1 text-[11px] leading-5 text-ink-400">{subtitle}</p>
        ) : null}
        <div className="mt-3">
          <ProgressBar percent={percent} indeterminate={indeterminate} />
        </div>
      </div>
    </div>
  )
}
