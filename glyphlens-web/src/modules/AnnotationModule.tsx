import { BookMarked, Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  AnnotationCard,
  AnnotationForm,
  AnnotationViewport,
  useAnnotationSession,
} from '@/components/annotation'
import RelicPicker from '@/components/RelicPicker'
import { cn } from '@/lib/cn'
import {
  getActiveRelicDetail,
  getActiveRelicSummary,
  useCurrentRelicStore,
} from '@/stores/currentRelicStore'
import {
  PRODUCT_ORDER,
  type ImageProcessingProduct,
} from '@/types/imageProcessing'

export default function AnnotationModule() {
  const activeId = useCurrentRelicStore((s) => s.activeId)
  const activeSummary = useCurrentRelicStore((s) => getActiveRelicSummary(s))
  const cachedDetail = useCurrentRelicStore((s) => getActiveRelicDetail(s))
  const ensureDetail = useCurrentRelicStore((s) => s.ensureDetail)
  const backend = useCurrentRelicStore((s) => s.backend)
  const loadState = useCurrentRelicStore((s) => s.loadState)

  const [baseProductKey, setBaseProductKey] = useState<string>('original')

  // 按需拉详情
  useEffect(() => {
    if (activeId && !cachedDetail) {
      void ensureDetail(activeId)
    }
  }, [activeId, cachedDetail, ensureDetail])

  // 按 PRODUCT_ORDER 排序后的产物列表
  const products = useMemo<ImageProcessingProduct[]>(() => {
    if (!cachedDetail) return []
    return [...cachedDetail.products].sort((a, b) => {
      const ia = PRODUCT_ORDER.indexOf(a.key)
      const ib = PRODUCT_ORDER.indexOf(b.key)
      return (
        (ia === -1 ? PRODUCT_ORDER.length : ia) -
        (ib === -1 ? PRODUCT_ORDER.length : ib)
      )
    })
  }, [cachedDetail])

  // 底图：用户选择的 key，找不到则兜底 original / 第一个
  const baseProduct = useMemo<ImageProcessingProduct | null>(() => {
    if (products.length === 0) return null
    return (
      products.find((p) => p.key === baseProductKey) ??
      products.find((p) => p.key === 'original') ??
      products[0]
    )
  }, [products, baseProductKey])

  const session = useAnnotationSession({
    activeId,
    baseProduct,
    relicTitle: activeSummary?.title ?? '',
    backendOnline: backend.kind === 'online',
  })

  if (loadState.kind !== 'ready') {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <div className="rounded-2xl border border-paper-300/70 bg-paper-50/80 px-8 py-6 text-center shadow-sm">
          <p className="font-display text-lg text-ink-600">字迹标注</p>
          <p className="mt-2 text-xs text-ink-400">正在初始化 GlyphLens…</p>
        </div>
      </div>
    )
  }

  const {
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
  } = session

  return (
    <div className="flex h-screen flex-1">
      {/* ====== 左侧栏 ====== */}
      <aside className="flex h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-paper-300/70 bg-paper-50/60">
        <div className="flex items-center justify-center px-3 py-2.5">
          <RelicPicker className="w-full" />
        </div>

        <div className="mx-3 flex items-center justify-between rounded-xl bg-paper-100/80 px-3 py-1.5 ring-1 ring-paper-300/60">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
            <BookMarked className="h-3 w-3" />
            已保存 {annotations.length}
            {drafts.length ? (
              <span className="text-ochre-600">· 草稿 {drafts.length}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={exportJson}
            disabled={annotations.length === 0}
            title="导出当前文物所有已保存标注（JSON）"
            className="inline-flex items-center gap-1 rounded-lg bg-paper-50 px-2 py-0.5 text-[10px] text-ink-500 ring-1 ring-paper-300/60 transition hover:bg-paper-200 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            导出
          </button>
        </div>

        {listError ? (
          <p className="mx-3 mt-2 rounded border border-seal-500/30 bg-seal-500/5 p-2 text-[11px] text-seal-600">
            加载失败：{listError}
          </p>
        ) : null}

        {/* 列表 */}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-2 [scrollbar-width:none] [::-webkit-scrollbar]:hidden">
          {drafts.length === 0 && annotations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-paper-400/60 p-4 text-center text-[11px] leading-5 text-ink-400">
              还没有标注。
              <br />
              在右侧图上按
              <span className="mx-1 rounded bg-paper-200 px-1 text-ink-500">
                左键
              </span>
              拖拽画框创建。
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {drafts.map((d, i) => (
                <AnnotationCard
                  key={d.tempId}
                  index={annotations.length + i + 1}
                  color="draft"
                  selected={
                    selection?.kind === 'draft' && selection.tempId === d.tempId
                  }
                  glyph={d.glyph}
                  label={d.label || '（未保存草稿）'}
                  note={d.note}
                  bbox={d.bbox}
                  onClick={() => {
                    setSelection({ kind: 'draft', tempId: d.tempId })
                    setEditing(null)
                  }}
                  onDelete={() => discardDraft(d.tempId)}
                />
              ))}
              {annotations.map((a, i) => (
                <AnnotationCard
                  key={`s_${a.id}`}
                  index={i + 1}
                  color="saved"
                  selected={
                    selection?.kind === 'saved' && selection.id === a.id
                  }
                  glyph={a.glyph ?? ''}
                  label={a.label || '（未命名）'}
                  note={a.note ?? ''}
                  bbox={{ x: a.bboxX, y: a.bboxY, w: a.bboxW, h: a.bboxH }}
                  onClick={() => {
                    setSelection({ kind: 'saved', id: a.id })
                    setEditing(null)
                  }}
                  onEdit={() => startEdit(a)}
                  onDelete={() => void deleteSaved(a.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* 表单：优先 draft，其次 saved 编辑 */}
        {currentDraft ? (
          <AnnotationForm
            title={`新标注（未保存 · 底图：${baseProduct?.label ?? '原始'}）`}
            values={currentDraft}
            saving={!!currentDraft.saving}
            error={currentDraft.error ?? null}
            submitLabel="保存到数据库"
            canSubmit={canSubmit}
            submitHint={offlineHint}
            onChange={(patch) => updateDraft(currentDraft.tempId, patch)}
            onSubmit={() => void saveDraft(currentDraft)}
            onCancel={() => discardDraft(currentDraft.tempId)}
            onOcr={() => void runOcrForDraft(currentDraft)}
            ocrLoading={!!currentDraft.ocrLoading}
            ocrError={currentDraft.ocrError ?? null}
            ocrHint={offlineHint ?? undefined}
          />
        ) : editing ? (
          <AnnotationForm
            title={`编辑 #${editing.id}`}
            values={editing}
            saving={!!editing.saving}
            error={editing.error ?? null}
            submitLabel="更新"
            canSubmit={canSubmit}
            submitHint={offlineHint}
            onChange={updateEditing}
            onSubmit={() => void submitEdit()}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </aside>

      {/* ====== 右侧视口 ====== */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4">
        {/* 底图切换条 */}
        {products.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-paper-50/70 px-2 py-1 ring-1 ring-paper-300/60">
            <span className="px-1 text-[11px] text-ink-400">底图</span>
            <nav className="flex flex-1 flex-wrap gap-1">
              {products.map((p) => {
                const active = p.key === baseProduct?.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setBaseProductKey(p.key)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
                      active
                        ? 'bg-ochre-400/20 text-ochre-700 ring-1 ring-ochre-500/40'
                        : 'text-ink-500 hover:bg-paper-200/80 hover:text-ink-700',
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </nav>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-paper-300/70 bg-ink-800/95 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.5)]">
          {baseProduct ? (
            <AnnotationViewport
              imgUrl={baseProduct.src}
              drafts={drafts}
              annotations={annotations}
              selection={selection}
              onDrawComplete={handleDrawComplete}
              onSelect={(sel) => {
                setSelection(sel)
                if (sel?.kind !== 'saved') setEditing(null)
              }}
              onCancel={handleCancel}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-paper-300">
              请先在"数据管理"模块上传文物
            </div>
          )}
        </div>

        <p className="shrink-0 text-[11px] leading-5 text-ink-400">
          <span className="text-ink-500">左键</span>拖拽画框 ·
          <span className="ml-1 text-ink-500">中键</span>拖拽平移 ·
          <span className="ml-1 text-ink-500">滚轮</span>以鼠标为中心缩放 ·
          <span className="ml-1 text-ink-500">右键</span>
          {selection?.kind === 'draft'
            ? '删除选中草稿'
            : '取消画框/清除选中'}
        </p>
      </section>
    </div>
  )
}
