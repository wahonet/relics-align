import {
  BookMarked,
  Database,
  Layers as LayersIcon,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import BackendStatusBanner from '@/components/BackendStatusBanner'
import {
  createRelic,
  deleteRelic,
  regenerateRelic,
  type RelicSummary,
} from '@/lib/api'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/stores/appStore'
import { useCurrentRelicStore } from '@/stores/currentRelicStore'

interface UploadForm {
  id: string
  title: string
  kind: 'stele' | 'pictorial_stone'
  period: string
  location: string
  description: string
  longEdge: number
  jpegQuality: number
  file: File | null
}

const EMPTY_FORM: UploadForm = {
  id: '',
  title: '',
  kind: 'pictorial_stone',
  period: '',
  location: '',
  description: '',
  longEdge: 4096,
  jpegQuality: 92,
  file: null,
}

function formatDate(iso: string): string {
  try {
    return new Date(iso.replace(' ', 'T')).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function DatasetModule() {
  const relics = useCurrentRelicStore((state) => state.relics)
  const activeId = useCurrentRelicStore((state) => state.activeId)
  const backend = useCurrentRelicStore((state) => state.backend)
  const loadState = useCurrentRelicStore((state) => state.loadState)
  const setActive = useCurrentRelicStore((state) => state.setActive)
  const removeRelicFromStore = useCurrentRelicStore((state) => state.removeRelic)
  const refresh = useCurrentRelicStore((state) => state.refresh)
  const setActiveModule = useAppStore((state) => state.setActiveModule)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [form, setForm] = useState<UploadForm>(EMPTY_FORM)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)

  const total = relics.length
  const activeRelic = useMemo(
    () => relics.find((r) => r.id === activeId) ?? null,
    [relics, activeId],
  )

  useEffect(() => {
    // 进入该模块时刷新一次（数据库可能被别处改过）
    if (loadState.kind === 'ready') {
      void refresh()
    }
    // 只在 mount 时刷
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openUpload = () => {
    setForm(EMPTY_FORM)
    setUploadError(null)
    setUploadOpen(true)
  }

  const submitUpload = async () => {
    if (!form.file) {
      setUploadError('请选择要上传的原图文件')
      return
    }
    if (!form.id) {
      setUploadError('请填写文物 ID（英文 / 数字 / 下划线）')
      return
    }
    if (!/^[A-Za-z0-9_-]+$/.test(form.id)) {
      setUploadError('文物 ID 仅允许英文字母、数字、下划线或连字符')
      return
    }
    if (!form.title) {
      setUploadError('请填写文物标题')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      await createRelic({
        id: form.id,
        title: form.title,
        kind: form.kind,
        period: form.period || undefined,
        location: form.location || undefined,
        description: form.description || undefined,
        longEdge: form.longEdge,
        jpegQuality: form.jpegQuality,
        file: form.file,
      })
      setUploadOpen(false)
      setActionOk(`已上传并处理：${form.title}`)
      await refresh()
      setActive(form.id)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
    }
  }

  const removeRelic = async (relic: RelicSummary) => {
    if (!window.confirm(`确认删除 "${relic.title}"（${relic.id}）及其所有产物与标注？`)) {
      return
    }
    setActionError(null)
    setActionOk(null)
    try {
      await deleteRelic(relic.id)
      removeRelicFromStore(relic.id)
      await refresh()
      setActionOk(`已删除：${relic.title}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const regenerate = async (relic: RelicSummary) => {
    if (!window.confirm(`重新跑图像处理管线 "${relic.title}"？（会覆盖现有 5 类产物）`)) {
      return
    }
    setRegeneratingId(relic.id)
    setActionError(null)
    setActionOk(null)
    try {
      await regenerateRelic(relic.id)
      await refresh()
      setActionOk(`已重新生成：${relic.title}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRegeneratingId(null)
    }
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-paper-300/70 bg-paper-50/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="seal-chip rounded-md px-2.5 py-1 text-[11px]">数据管理</span>
          <h2 className="font-display text-lg text-ink-600">文物与产物库</h2>
          <BackendStatusBanner dense />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-full border border-paper-400/70 bg-paper-50 px-3 py-1 text-[11px] text-ink-500 hover:border-ochre-500/70 hover:text-ochre-600"
          >
            <RefreshCw className="h-3 w-3" />
            刷新
          </button>
          <button
            type="button"
            onClick={openUpload}
            disabled={backend.kind !== 'online'}
            title={
              backend.kind === 'online'
                ? '上传 TIFF / JPG 原图，后端自动生成 5 类产物'
                : '后端未启动，无法上传；请先运行 start_backend.bat'
            }
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition',
              backend.kind === 'online'
                ? 'border-ochre-500/70 bg-ochre-400/20 text-ochre-700 hover:bg-ochre-400/30'
                : 'cursor-not-allowed border-paper-400/60 bg-paper-100 text-ink-400',
            )}
          >
            <Upload className="h-3 w-3" />
            上传新文物
          </button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-5">
        {actionOk ? (
          <div className="flex items-start gap-2 rounded-xl border border-bamboo-500/40 bg-bamboo-500/5 px-4 py-2 text-[12px] text-bamboo-700">
            <span className="flex-1">{actionOk}</span>
            <button type="button" onClick={() => setActionOk(null)}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}
        {actionError ? (
          <div className="flex items-start gap-2 rounded-xl border border-seal-500/40 bg-seal-500/5 px-4 py-2 text-[12px] text-seal-700">
            <span className="flex-1">{actionError}</span>
            <button type="button" onClick={() => setActionError(null)}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-4 text-[11px] text-ink-400">
          <span>
            共 <span className="font-display text-base text-ink-600">{total}</span> 件文物
          </span>
          {activeRelic ? (
            <span>
              当前工作中：<span className="text-ochre-700">{activeRelic.title}</span>
            </span>
          ) : null}
          {backend.kind === 'offline' ? (
            <span className="text-seal-500">
              当前处于只读模式：后端离线时无法新建、删除或重新生成。
            </span>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-paper-300/70 bg-paper-50/70">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-paper-100/80 text-[10px] uppercase tracking-[0.18em] text-ink-400">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">标题 / 类型</th>
                <th className="px-4 py-3">地域 / 年代</th>
                <th className="px-4 py-3">产物</th>
                <th className="px-4 py-3">标注</th>
                <th className="px-4 py-3">入库</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {relics.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-400">
                    {backend.kind === 'online'
                      ? '数据库为空，点击右上角"上传新文物"开始。'
                      : '后端未启动，且未找到 demo/processed/metadata.json。'}
                  </td>
                </tr>
              ) : (
                relics.map((relic) => {
                  const isActive = relic.id === activeId
                  const isRegen = regeneratingId === relic.id
                  return (
                    <tr
                      key={relic.id}
                      className={cn(
                        'border-t border-paper-300/50 transition',
                        isActive ? 'bg-ochre-400/10' : 'hover:bg-paper-100/40',
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-ink-600">{relic.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-display text-[13px] text-ink-600">
                          {relic.title}
                        </div>
                        <div className="mt-0.5 inline-flex items-center gap-2 text-[10px] text-ink-400">
                          <span className="rounded-full border border-paper-400/60 px-1.5 py-0.5">
                            {relic.kind === 'stele' ? '碑刻文字' : '汉画像石'}
                          </span>
                          {relic.description ? (
                            <span className="line-clamp-1 text-ink-400">
                              {relic.description}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-ink-500">
                        <div>{relic.location ?? '—'}</div>
                        <div className="text-ink-400">{relic.period ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-paper-400/60 bg-paper-50 px-2 py-0.5 text-[10px] text-ink-500">
                          <LayersIcon className="h-2.5 w-2.5" />
                          {relic.productCount}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-paper-400/60 bg-paper-50 px-2 py-0.5 text-[10px] text-ink-500">
                          <BookMarked className="h-2.5 w-2.5" />
                          {relic.annotationCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-ink-400">
                        {formatDate(relic.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setActive(relic.id)
                              setActiveModule('imageProcessing')
                            }}
                            className="rounded-full border border-paper-400/60 px-2.5 py-1 text-[10px] text-ink-500 hover:border-ochre-400/70 hover:text-ochre-600"
                          >
                            打开
                          </button>
                          <button
                            type="button"
                            onClick={() => void regenerate(relic)}
                            disabled={
                              backend.kind !== 'online' || isRegen
                            }
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-[10px] transition',
                              backend.kind === 'online'
                                ? 'border-paper-400/60 text-ink-500 hover:border-bamboo-500/70 hover:text-bamboo-600 disabled:cursor-not-allowed disabled:opacity-50'
                                : 'cursor-not-allowed border-paper-400/60 text-ink-400 opacity-50',
                            )}
                          >
                            {isRegen ? '处理中…' : '重跑管线'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeRelic(relic)}
                            disabled={backend.kind !== 'online'}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition',
                              backend.kind === 'online'
                                ? 'border-paper-400/60 text-ink-500 hover:border-seal-500/70 hover:text-seal-600'
                                : 'cursor-not-allowed border-paper-400/60 text-ink-400 opacity-50',
                            )}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] leading-5 text-ink-400">
          <Database className="mr-1 inline h-3 w-3 align-text-top" />
          所有产物存储在 `public/storage/relics/&lbrace;id&rbrace;/*.jpg`，数据库位于 `public/storage/glyphlens.sqlite3`。
          后端通过 FastAPI 提供 REST API，Vite dev server 同时也把 storage 作为静态资源返回，两端可独立运行。
        </p>
      </section>

      {uploadOpen ? (
        <UploadDialog
          form={form}
          setForm={setForm}
          onSubmit={submitUpload}
          onCancel={() => setUploadOpen(false)}
          uploading={uploading}
          error={uploadError}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 上传对话框
// ---------------------------------------------------------------------------

interface UploadDialogProps {
  form: UploadForm
  setForm: (form: UploadForm) => void
  onSubmit: () => void
  onCancel: () => void
  uploading: boolean
  error: string | null
}

function UploadDialog({
  form,
  setForm,
  onSubmit,
  onCancel,
  uploading,
  error,
}: UploadDialogProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink-800/35 backdrop-blur-sm">
      <div className="w-[520px] max-w-[95vw] rounded-2xl border border-paper-300/70 bg-paper-50 p-6 shadow-[0_30px_80px_-30px_rgba(35,26,15,0.65)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-ink-300">
              Upload
            </p>
            <h3 className="mt-1 font-display text-xl text-ink-600">上传新文物</h3>
            <p className="mt-1 text-[11px] leading-5 text-ink-400">
              接受 TIFF / JPG / PNG；后端自动跑长边 4096px 的图像处理管线生成 5 类产物。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-paper-400/60 p-1 text-ink-400 hover:border-seal-500/60 hover:text-seal-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">文物 ID *</span>
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value.trim() })}
              placeholder="如：beilin_zhangmenglong"
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 font-mono text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">类别 *</span>
            <select
              value={form.kind}
              onChange={(e) =>
                setForm({
                  ...form,
                  kind: e.target.value as UploadForm['kind'],
                })
              }
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            >
              <option value="pictorial_stone">汉画像石</option>
              <option value="stele">碑刻文字</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">标题 *</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如：张猛龙碑 · 正面"
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">地域</span>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="如：陕西西安"
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">年代</span>
            <input
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
              placeholder="如：北魏 正光三年"
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">备注</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="resize-none rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">长边 px</span>
            <input
              type="number"
              min={1024}
              max={8192}
              step={256}
              value={form.longEdge}
              onChange={(e) =>
                setForm({ ...form, longEdge: Number(e.target.value) || 4096 })
              }
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 font-mono text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">JPEG 质量</span>
            <input
              type="number"
              min={60}
              max={99}
              step={1}
              value={form.jpegQuality}
              onChange={(e) =>
                setForm({ ...form, jpegQuality: Number(e.target.value) || 92 })
              }
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 font-mono text-sm text-ink-600 focus:border-ochre-500/80 focus:outline-none"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[10px] text-ink-400">原图文件 *</span>
            <input
              type="file"
              accept="image/*,.tif,.tiff"
              onChange={(e) =>
                setForm({ ...form, file: e.target.files?.[0] ?? null })
              }
              className="rounded border border-paper-400/60 bg-paper-50 px-2 py-1 text-sm text-ink-600 file:mr-3 file:rounded-full file:border-0 file:bg-ochre-400/20 file:px-3 file:py-1 file:text-[11px] file:text-ochre-700"
            />
            {form.file ? (
              <span className="text-[10px] text-ink-500">
                {form.file.name} ·{' '}
                {(form.file.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            ) : null}
          </label>
        </div>

        {error ? (
          <p className="mt-3 rounded border border-seal-500/30 bg-seal-500/5 p-2 text-[11px] text-seal-600">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-paper-400/70 bg-paper-50 px-4 py-1.5 text-[12px] text-ink-500 hover:border-seal-500/60 hover:text-seal-600"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={uploading}
            className="rounded-full border border-ochre-500/70 bg-ochre-400/20 px-4 py-1.5 text-[12px] font-medium text-ochre-700 hover:bg-ochre-400/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? '上传并处理中…（20~60s）' : '开始上传'}
          </button>
        </div>
      </div>
    </div>
  )
}
