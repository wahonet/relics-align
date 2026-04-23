/**
 * 字迹标注共享类型。
 *
 * AnnotationModule 和 ImageProcessingModule 集成的标注视图都依赖这里的类型，
 * 不依赖任何 UI 组件，可放心 barrel 导出。
 */

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Draft {
  tempId: string
  bbox: BBox
  glyph: string
  label: string
  note: string
  author: string
  saving?: boolean
  error?: string | null
  ocrLoading?: boolean
  ocrError?: string | null
}

export interface EditingSaved {
  id: number
  glyph: string
  label: string
  note: string
  author: string
  saving?: boolean
  error?: string | null
}

export type Selection =
  | { kind: 'draft'; tempId: string }
  | { kind: 'saved'; id: number }
  | null

export interface FormFields {
  glyph: string
  label: string
  note: string
  author: string
}
