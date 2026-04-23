import { Pencil, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'

import type { BBox } from './types'

export interface AnnotationCardProps {
  index: number
  color: 'saved' | 'draft'
  selected: boolean
  glyph: string
  label: string
  note: string
  bbox: BBox
  onClick: () => void
  onEdit?: () => void
  onDelete: () => void
}

export default function AnnotationCard({
  index,
  color,
  selected,
  glyph,
  label,
  note,
  bbox,
  onClick,
  onEdit,
  onDelete,
}: AnnotationCardProps) {
  const dotColor =
    color === 'saved'
      ? 'border-seal-500/50 bg-seal-500/15 text-seal-600'
      : 'border-ochre-500/60 bg-ochre-400/20 text-ochre-700'
  const selectedRing =
    color === 'saved'
      ? 'border-seal-500/70 bg-seal-500/5'
      : 'border-ochre-500/70 bg-ochre-400/10'

  return (
    <li
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-xl border p-2.5 text-[12px] transition',
        selected
          ? selectedRing
          : 'border-paper-300/70 bg-paper-50 hover:border-paper-400/80',
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-display text-sm',
            dotColor,
          )}
        >
          {glyph || '·'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-600">
            <span className="mr-1 text-[10px] text-ink-400">#{index}</span>
            {label}
          </p>
          <p className="mt-0.5 text-[10px] text-ink-400">
            {(bbox.x * 100).toFixed(1)}%, {(bbox.y * 100).toFixed(1)}% ·{' '}
            {(bbox.w * 100).toFixed(1)}×{(bbox.h * 100).toFixed(1)}
          </p>
          {note ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-500">
              {note}
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-400">
            {onEdit ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
                className="inline-flex items-center gap-1 rounded border border-paper-400/60 px-1.5 py-0.5 hover:border-ochre-400/70 hover:text-ochre-600"
              >
                <Pencil className="h-2.5 w-2.5" />
                编辑
              </button>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="inline-flex items-center gap-1 rounded border border-paper-400/60 px-1.5 py-0.5 hover:border-seal-500/70 hover:text-seal-600"
            >
              <Trash2 className="h-2.5 w-2.5" />
              {color === 'draft' ? '丢弃' : '删除'}
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
