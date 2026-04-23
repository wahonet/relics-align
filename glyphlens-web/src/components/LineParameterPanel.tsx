import { BookmarkPlus, Loader2, RotateCcw, Sparkles, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { cn } from '@/lib/cn'
import {
  DEFAULT_LINE_PARAMETERS,
  LINE_PRESETS,
  type LineParameters,
} from '@/lib/lineProcessor'

/** 自定义预设 1：用 localStorage 存一组用户调好的参数，避免写死。 */
const CUSTOM_PRESET_KEY = 'glyphlens.linePreset.custom1'

function readCustomPreset(): LineParameters | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CUSTOM_PRESET_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LineParameters>
    // 与默认值合并，兼容字段新增
    return { ...DEFAULT_LINE_PARAMETERS, ...parsed }
  } catch {
    return null
  }
}

function writeCustomPreset(params: LineParameters): void {
  try {
    window.localStorage.setItem(CUSTOM_PRESET_KEY, JSON.stringify(params))
  } catch {
    // 静默失败：私密模式 / 配额满；不影响主流程
  }
}

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
    <label className={cn('flex flex-col gap-0.5', disabled && 'opacity-50')}>
      <span className="flex items-center justify-between text-[10px] leading-tight text-ink-500">
        <span>
          <span className="font-medium text-ink-600">{label}</span>
          {hint ? <span className="ml-1 text-ink-400">{hint}</span> : null}
        </span>
        <span className="font-mono text-ochre-700">
          {format ? format(value) : value.toFixed(0)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-paper-300/70 accent-ochre-500"
        style={{
          background: `linear-gradient(to right, var(--color-ochre-500) 0%, var(--color-ochre-500) ${percentage}%, var(--color-paper-300) ${percentage}%, var(--color-paper-300) 100%)`,
        }}
      />
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
    <label className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full border transition',
          checked
            ? 'border-ochre-500/80 bg-ochre-400/60'
            : 'border-paper-400/70 bg-paper-200',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-paper-50 shadow transition-all',
            checked ? 'left-[calc(100%-0.875rem)]' : 'left-0.5',
          )}
        />
      </button>
      <span className="flex flex-col text-[10px] leading-tight text-ink-500">
        <span className="font-medium text-ink-600">{label}</span>
        {hint ? <span className="text-ink-400">{hint}</span> : null}
      </span>
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

  const [customPreset, setCustomPreset] = useState<LineParameters | null>(() =>
    readCustomPreset(),
  )

  useEffect(() => {
    // 同一浏览器多个 tab 间同步
    const handler = (event: StorageEvent) => {
      if (event.key === CUSTOM_PRESET_KEY) {
        setCustomPreset(readCustomPreset())
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const saveCustomPreset = useCallback(() => {
    writeCustomPreset(params)
    setCustomPreset(params)
  }, [params])

  const applyCustomPreset = useCallback(() => {
    if (customPreset) {
      onChange({ ...customPreset })
    }
  }, [customPreset, onChange])

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
    <div className="flex shrink-0 flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-600">
        <Sparkles className="h-3 w-3 text-ochre-500" />
        <span className="font-medium">线图参数</span>
        <div className="ml-auto">{renderStatus()}</div>
      </div>

      <div className="flex flex-wrap gap-1">
        <span className="text-[10px] text-ink-400">预设</span>
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
            onClick={applyCustomPreset}
            disabled={!customPreset}
            title={
              customPreset
                ? '应用已保存的「自定义 1」参数'
                : '尚未保存，先点右侧 “保存 自定义 1”'
            }
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition',
              customPreset
                ? 'border-ochre-500/60 bg-ochre-400/10 text-ochre-700 hover:border-ochre-500 hover:bg-ochre-400/20'
                : 'cursor-not-allowed border-paper-400/50 bg-paper-50 text-ink-300',
            )}
          >
            <Star className="h-3 w-3" />
            自定义 1
          </button>
          <button
            type="button"
            onClick={saveCustomPreset}
            title="把当前滑块参数保存为「自定义 1」（存在浏览器本地，可随时覆盖）"
            className="inline-flex items-center gap-1 rounded-full border border-paper-400/60 bg-paper-50 px-2.5 py-1 text-[11px] text-ink-500 transition hover:border-ochre-400/70 hover:text-ochre-600"
          >
            <BookmarkPlus className="h-3 w-3" />
            {customPreset ? '覆盖 自定义 1' : '保存 自定义 1'}
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_LINE_PARAMETERS })}
            className="ml-1 inline-flex items-center gap-1 rounded-full border border-paper-400/60 bg-paper-50 px-2.5 py-1 text-[11px] text-ink-500 transition hover:border-ochre-400/70 hover:text-ochre-600"
          >
            <RotateCcw className="h-3 w-3" />
            重置
          </button>
        </div>

      <div className="flex flex-col gap-2">
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
