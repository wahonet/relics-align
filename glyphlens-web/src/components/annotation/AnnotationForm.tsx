import { Save, ScanLine, X } from 'lucide-react'

import { cn } from '@/lib/cn'

import type { FormFields } from './types'

export interface AnnotationFormProps {
  title: string
  values: FormFields
  saving: boolean
  error: string | null
  submitLabel: string
  canSubmit: boolean
  submitHint: string | null
  onChange: (patch: Partial<FormFields>) => void
  onSubmit: () => void
  onCancel: () => void
  /** OCR 识别（仅 draft 传，editing 不传） */
  onOcr?: () => void
  ocrLoading?: boolean
  ocrError?: string | null
  ocrHint?: string | null
}

export default function AnnotationForm({
  title,
  values,
  saving,
  error,
  submitLabel,
  canSubmit,
  submitHint,
  onChange,
  onSubmit,
  onCancel,
  onOcr,
  ocrLoading,
  ocrError,
  ocrHint,
}: AnnotationFormProps) {
  return (
    <div className="border-t border-paper-300/70 bg-paper-50 px-3 py-2.5 shadow-[0_-8px_24px_-18px_rgba(35,26,15,0.25)]">
      <p className="text-[11px] font-medium text-ink-600">{title}</p>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-400">释读（单字）</span>
          <input
            value={values.glyph}
            onChange={(e) => onChange({ glyph: e.target.value })}
            placeholder="如：禮"
            maxLength={8}
            className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 font-display text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-400">标签</span>
          <input
            value={values.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="如：第 2 行第 3 字"
            className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-[12px] text-ink-600 focus:border-ochre-500/80 focus:outline-none"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-400">备注</span>
          <textarea
            value={values.note}
            onChange={(e) => onChange({ note: e.target.value })}
            rows={2}
            placeholder="存疑、异体、工艺等"
            className="resize-none rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-[12px] text-ink-600 focus:border-ochre-500/80 focus:outline-none"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-400">作者</span>
          <input
            value={values.author}
            onChange={(e) => onChange({ author: e.target.value })}
            placeholder="留空则为匿名"
            className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-[12px] text-ink-600 focus:border-ochre-500/80 focus:outline-none"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-2 rounded border border-seal-500/30 bg-seal-500/5 p-1.5 text-[10px] leading-4 text-seal-600">
          {error}
        </p>
      ) : null}
      {ocrError ? (
        <p className="mt-2 rounded border border-seal-500/30 bg-seal-500/5 p-1.5 text-[10px] leading-4 text-seal-600">
          识别失败：{ocrError}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || !canSubmit}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg bg-ochre-400/20 px-2.5 py-1 text-[11px] font-medium text-ochre-700 ring-1 ring-ochre-500/40 transition',
            'hover:bg-ochre-400/30 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Save className="h-3 w-3" />
          {saving ? '保存中…' : submitLabel}
        </button>
        {onOcr ? (
          <button
            type="button"
            onClick={onOcr}
            disabled={ocrLoading || !canSubmit}
            title={ocrHint ?? '用当前底图对选区跑 OCR，把结果填入释读/标签'}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg bg-bamboo-500/10 px-2.5 py-1 text-[11px] font-medium text-bamboo-700 ring-1 ring-bamboo-500/40 transition',
              'hover:bg-bamboo-500/20 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <ScanLine className="h-3 w-3" />
            {ocrLoading ? '识别中…' : '识别'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] text-ink-500 ring-1 ring-paper-300/70 transition hover:text-seal-600 hover:ring-seal-500/50"
        >
          <X className="h-3 w-3" />
          取消
        </button>
        {submitHint ? (
          <span className="text-[10px] text-seal-500">{submitHint}</span>
        ) : null}
      </div>
    </div>
  )
}
