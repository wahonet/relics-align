import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  ocrRegion,
  updateAnnotation,
  type Annotation,
  type AnnotationPayload,
} from '@/lib/api'
import type { ImageProcessingProduct } from '@/types/imageProcessing'

import type { BBox, Draft, EditingSaved, FormFields, Selection } from './types'

// ---------------------------------------------------------------------------
// 字迹标注会话 hook
//
// 把 AnnotationModule / ImageProcessingModule 两个消费者都会用到的
// 「后端 CRUD + 草稿 + OCR + 选中/编辑态 + 导出」集中在一处，
// 上层只关心 UI 编排。
// ---------------------------------------------------------------------------

export interface UseAnnotationSessionArgs {
  activeId: string | null
  baseProduct: ImageProcessingProduct | null
  relicTitle: string
  backendOnline: boolean
}

export interface UseAnnotationSessionReturn {
  annotations: Annotation[]
  drafts: Draft[]
  selection: Selection
  editing: EditingSaved | null
  currentDraft: Draft | null
  listError: string | null
  canSubmit: boolean
  offlineHint: string | null

  setSelection: (sel: Selection) => void
  setEditing: (e: EditingSaved | null) => void
  updateDraft: (tempId: string, patch: Partial<Draft>) => void

  handleDrawComplete: (bbox: BBox) => void
  discardDraft: (tempId: string) => void
  saveDraft: (draft: Draft) => Promise<void>

  deleteSaved: (id: number) => Promise<void>
  startEdit: (a: Annotation) => void
  updateEditing: (patch: Partial<FormFields>) => void
  submitEdit: () => Promise<void>

  runOcrForDraft: (draft: Draft) => Promise<void>
  handleCancel: () => void
  exportJson: () => void
}

export function useAnnotationSession({
  activeId,
  baseProduct,
  relicTitle,
  backendOnline,
}: UseAnnotationSessionArgs): UseAnnotationSessionReturn {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [editing, setEditing] = useState<EditingSaved | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const canSubmit = backendOnline
  const offlineHint = canSubmit ? null : '后端离线，无法保存到数据库'

  const reloadAnnotations = useCallback(async () => {
    if (!activeId || !backendOnline) {
      setAnnotations([])
      return
    }
    setListError(null)
    try {
      const list = await listAnnotations(activeId)
      setAnnotations(list)
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error))
    }
  }, [activeId, backendOnline])

  // 切换文物：清空草稿 / 选中 / 编辑态；重新拉列表
  useEffect(() => {
    setDrafts([])
    setSelection(null)
    setEditing(null)
    void reloadAnnotations()
  }, [activeId, reloadAnnotations])

  const updateDraft = useCallback((tempId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d)))
  }, [])

  const discardDraft = useCallback((tempId: string) => {
    setDrafts((prev) => prev.filter((d) => d.tempId !== tempId))
    setSelection((s) => (s?.kind === 'draft' && s.tempId === tempId ? null : s))
  }, [])

  const handleDrawComplete = useCallback((bbox: BBox) => {
    const tempId = `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    setDrafts((prev) => [
      ...prev,
      { tempId, bbox, glyph: '', label: '', note: '', author: '' },
    ])
    setSelection({ kind: 'draft', tempId })
    setEditing(null)
  }, [])

  const currentDraft = useMemo(
    () =>
      selection?.kind === 'draft'
        ? drafts.find((d) => d.tempId === selection.tempId) ?? null
        : null,
    [drafts, selection],
  )

  const saveDraft = useCallback(
    async (draft: Draft) => {
      if (!activeId || !backendOnline) return
      updateDraft(draft.tempId, { saving: true, error: null })
      try {
        const payload: AnnotationPayload = {
          productKey: baseProduct?.key ?? 'original',
          bboxX: draft.bbox.x,
          bboxY: draft.bbox.y,
          bboxW: draft.bbox.w,
          bboxH: draft.bbox.h,
          glyph: draft.glyph || null,
          label: draft.label || null,
          note: draft.note || null,
          author: draft.author || null,
        }
        const created = await createAnnotation(activeId, payload)
        setAnnotations((list) => [...list, created])
        setDrafts((list) => list.filter((d) => d.tempId !== draft.tempId))
        setSelection({ kind: 'saved', id: created.id })
      } catch (error) {
        updateDraft(draft.tempId, {
          saving: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [activeId, backendOnline, baseProduct, updateDraft],
  )

  const runOcrForDraft = useCallback(
    async (draft: Draft) => {
      if (!activeId || !backendOnline || !baseProduct) return
      updateDraft(draft.tempId, { ocrLoading: true, ocrError: null })
      try {
        const result = await ocrRegion({
          relicId: activeId,
          productKey: baseProduct.key,
          bboxX: draft.bbox.x,
          bboxY: draft.bbox.y,
          bboxW: draft.bbox.w,
          bboxH: draft.bbox.h,
        })
        const flat = result.text.replace(/\s+/g, '')
        const patch: Partial<Draft> = {
          ocrLoading: false,
          ocrError: flat ? null : '未识别到文字',
        }
        if (flat) {
          patch.glyph = flat.slice(0, 1)
          if (flat.length > 1) patch.label = result.text
        }
        updateDraft(draft.tempId, patch)
      } catch (error) {
        updateDraft(draft.tempId, {
          ocrLoading: false,
          ocrError: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [activeId, backendOnline, baseProduct, updateDraft],
  )

  const deleteSaved = useCallback(
    async (id: number) => {
      const prev = annotations
      setAnnotations((list) => list.filter((a) => a.id !== id))
      setSelection((s) => (s?.kind === 'saved' && s.id === id ? null : s))
      setEditing((e) => (e?.id === id ? null : e))
      try {
        await deleteAnnotation(id)
      } catch (error) {
        setAnnotations(prev)
        setListError(error instanceof Error ? error.message : String(error))
      }
    },
    [annotations],
  )

  const startEdit = useCallback((a: Annotation) => {
    setEditing({
      id: a.id,
      glyph: a.glyph ?? '',
      label: a.label ?? '',
      note: a.note ?? '',
      author: a.author ?? '',
    })
    setSelection({ kind: 'saved', id: a.id })
  }, [])

  const updateEditing = useCallback((patch: Partial<FormFields>) => {
    setEditing((s) => (s ? { ...s, ...patch } : s))
  }, [])

  const submitEdit = useCallback(async () => {
    if (!editing || !backendOnline) return
    setEditing((s) => (s ? { ...s, saving: true, error: null } : s))
    try {
      const updated = await updateAnnotation(editing.id, {
        glyph: editing.glyph || null,
        label: editing.label || null,
        note: editing.note || null,
        author: editing.author || null,
      })
      setAnnotations((list) => list.map((a) => (a.id === updated.id ? updated : a)))
      setEditing(null)
    } catch (error) {
      setEditing((s) =>
        s
          ? {
              ...s,
              saving: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : s,
      )
    }
  }, [editing, backendOnline])

  const handleCancel = useCallback(() => {
    if (selection?.kind === 'draft') {
      discardDraft(selection.tempId)
    } else {
      setSelection(null)
      setEditing(null)
    }
  }, [selection, discardDraft])

  const exportJson = useCallback(() => {
    if (!activeId || annotations.length === 0) return
    const payload = {
      relicId: activeId,
      title: relicTitle,
      exportedAt: new Date().toISOString(),
      annotations: annotations.map((a) => ({
        id: a.id,
        productKey: a.productKey,
        bbox: { x: a.bboxX, y: a.bboxY, w: a.bboxW, h: a.bboxH },
        glyph: a.glyph,
        label: a.label,
        note: a.note,
        author: a.author,
        createdAt: a.createdAt,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeId}-annotations.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [activeId, annotations, relicTitle])

  return {
    annotations,
    drafts,
    selection,
    editing,
    currentDraft,
    listError,
    canSubmit,
    offlineHint,
    setSelection,
    setEditing,
    updateDraft,
    handleDrawComplete,
    discardDraft,
    saveDraft,
    deleteSaved,
    startEdit,
    updateEditing,
    submitEdit,
    runOcrForDraft,
    handleCancel,
    exportJson,
  }
}
