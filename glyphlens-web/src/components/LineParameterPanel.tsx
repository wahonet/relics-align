import { Loader2, RotateCcw, Sparkles } from 'lucide-react'

import { cn } from '@/lib/cn'
import {
  DEFAULT_LINE_PARAMETERS,
  LINE_PRESETS,
  type LineParameters,
} from '@/lib/lineProcessor'

interface LineParameterPanelProps {
  params: LineParameters
  onChange: (next: LineParameters) => void
  processing: boolean
  status:
    | { kind: 'idle' }
    | { kind: 'downloading-cv'; received: number; total: number }
    | { kind: 'decoding-cv'; wasmBytes: number }
    | { kind: 'injecting-cv'; scriptBytes: number }
    | { kind: 'initializing-cv'; elapsedMs: number }
    | { kind: 'loading-source' }
    | { kind: 'rendering'; elapsedMs: number }
    | { kind: 'done'; elapsedMs: number; byteLength: number; width: number; height: number }
    | { kind: 'error'; title: string; detail: string }
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const percentage = ((value - min) / Math.max(0.0001, max - min)) * 100
  return (
    <label className={cn('flex items-center gap-3', disabled && 'opacity-50')}>
      <span className="flex w-24 shrink-0 flex-col text-[11px] leading-tight text-ink-500">
        <span className="font-medium text-ink-600">{label}</span>
        {hint ? <span className="text-[10px] text-ink-400">{hint}</span> : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-paper-300/70 accent-ochre-500"
        style={{
          background: `linear-gradient(to right, var(--color-ochre-500) 0%, var(--color-ochre-500) ${percentage}%, var(--color-paper-300) ${percentage}%, var(--color-paper-300) 100%)`,
        }}
      />
      <span className="w-14 shrink-0 text-right font-mono text-[11px] text-ochre-700">
        {format ? format(value) : value.toFixed(0)}
      </span>
    </label>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 flex-col text-[11px] leading-tight text-ink-500">
        <span className="font-medium text-ink-600">{label}</span>
        {hint ? <span className="text-[10px] text-ink-400">{hint}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition',
          checked
            ? 'border-ochre-500/80 bg-ochre-400/60'
            : 'border-paper-400/70 bg-paper-200',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-paper-50 shadow transition-all',
            checked ? 'left-[calc(100%-1.125rem)]' : 'left-0.5',
          )}
        />
      </button>
      <span className="ml-auto text-[10px] text-ink-400">{checked ? '开' : '关'}</span>
    </label>
  )
}

export default function LineParameterPanel({
  params,
  onChange,
  processing,
  status,
}: LineParameterPanelProps) {
  const setParam = <K extends keyof LineParameters>(key: K, value: LineParameters[K]) => {
    onChange({ ...params, [key]: value })
  }

  const renderStatus = () => {
    switch (status.kind) {
      case 'downloading-cv': {
        const total = status.total > 0 ? status.total : Math.max(status.received, 10_800_000)
        const percent = Math.round((status.received / total) * 100)
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-ochre-700">
            <Loader2 className="h-3 w-3 animate-spin" /> 下载 OpenCV.js {percent}%
          </span>
        )
      }
      case 'decoding-cv':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-ochre-700">
            <Loader2 className="h-3 w-3 animate-spin" /> 解码 wasm 字节码…
          </span>
        )
      case 'injecting-cv':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-ochre-700">
            <Loader2 className="h-3 w-3 animate-spin" /> 注入 OpenCV.js…
          </span>
        )
      case 'initializing-cv':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-ochre-700">
            <Loader2 className="h-3 w-3 animate-spin" /> 初始化 WebAssembly · {(status.elapsedMs / 1000).toFixed(1)}s
          </span>
        )
      case 'loading-source':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-ochre-700">
            <Loader2 className="h-3 w-3 animate-spin" /> 正在载入原图…
          </span>
        )
      case 'rendering':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-ochre-700">
            <Loader2 className="h-3 w-3 animate-spin" /> 处理中 · {(status.elapsedMs / 1000).toFixed(1)}s
          </span>
        )
      case 'done': {
        const kb = status.byteLength / 1024
        const size = kb > 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${kb.toFixed(0)}KB`
        return (
          <span className="text-[11px] text-ink-500">
            {status.width}×{status.height} · {size} · {status.elapsedMs}ms
          </span>
        )
      }
      case 'error':
        return (
          <span className="text-[11px] text-seal-500" title={status.detail}>
            错误：{status.title}
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-paper-300/70 bg-paper-50/40 px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-600">
          <Sparkles className="h-3.5 w-3.5 text-ochre-500" />
          <span className="font-medium">数字线图实时参数</span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-ink-400">预设</span>
          {Object.entries(LINE_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...preset.params })}
              className="rounded-full border border-paper-400/60 bg-paper-50 px-2.5 py-1 text-[11px] text-ink-500 transition hover:border-ochre-400/70 hover:text-ochre-600"
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_LINE_PARAMETERS })}
            className="ml-1 inline-flex items-center gap-1 rounded-full border border-paper-400/60 bg-paper-50 px-2.5 py-1 text-[11px] text-ink-500 transition hover:border-ochre-400/70 hover:text-ochre-600"
          >
            <RotateCcw className="h-3 w-3" />
            重置
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">{renderStatus()}</div>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
        <SliderRow
          label="高斯 σ"
          hint="平滑强度，越大越粗"
          value={params.gaussianSigma}
          min={0.5}
          max={16}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => setParam('gaussianSigma', v)}
          disabled={processing}
        />
        <SliderRow
          label="Canny 低"
          hint="越低边缘越多"
          value={params.cannyLow}
          min={5}
          max={200}
          step={1}
          onChange={(v) => setParam('cannyLow', v)}
          disabled={processing}
        />
        <SliderRow
          label="Canny 高"
          hint="越高只取强边"
          value={params.cannyHigh}
          min={30}
          max={260}
          step={1}
          onChange={(v) => setParam('cannyHigh', v)}
          disabled={processing}
        />

        <ToggleRow
          label="自适应阈值"
          hint="叠加细纹理"
          checked={params.useAdaptive}
          onChange={(v) => setParam('useAdaptive', v)}
        />
        <SliderRow
          label="blockSize"
          hint="自适应邻域"
          value={params.adaptiveBlockSize}
          min={5}
          max={51}
          step={2}
          onChange={(v) => setParam('adaptiveBlockSize', v)}
          disabled={processing || !params.useAdaptive}
        />
        <SliderRow
          label="常数 C"
          hint="阈值偏置"
          value={params.adaptiveC}
          min={-5}
          max={20}
          step={1}
          onChange={(v) => setParam('adaptiveC', v)}
          disabled={processing || !params.useAdaptive}
        />

        <SliderRow
          label="close 核"
          hint="0 不做，否则封闭断线"
          value={params.closeKernel}
          min={0}
          max={11}
          step={1}
          onChange={(v) => setParam('closeKernel', v)}
          disabled={processing}
        />
        <SliderRow
          label="最小面积"
          hint="%图像，删碎线"
          value={params.minAreaRatio * 1000}
          min={0}
          max={5}
          step={0.05}
          format={(v) => `${v.toFixed(2)}‰`}
          onChange={(v) => setParam('minAreaRatio', v / 1000)}
          disabled={processing}
        />
        <SliderRow
          label="保留前 N"
          hint="0 = 不限制"
          value={params.keepLargestN}
          min={0}
          max={200}
          step={1}
          onChange={(v) => setParam('keepLargestN', v)}
          disabled={processing}
        />

        <SliderRow
          label="描线加粗"
          hint="膨胀迭代次数"
          value={params.dilateIters}
          min={0}
          max={4}
          step={1}
          onChange={(v) => setParam('dilateIters', v)}
          disabled={processing}
        />
        <ToggleRow
          label="白底黑线"
          hint="关闭为负片"
          checked={params.invert}
          onChange={(v) => setParam('invert', v)}
        />
      </div>
    </div>
  )
}
