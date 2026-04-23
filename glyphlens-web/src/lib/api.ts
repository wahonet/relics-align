/**
 * GlyphLens 后端 API client。
 *
 * 设计要点：
 * - 所有请求走 `VITE_GLYPHLENS_API_BASE`（默认 `http://127.0.0.1:8787`）。
 * - 暴露一个一次性的 `detectBackend()`，给 UI 在进入各模块时做一次探测。
 *   探测失败时模块可以降级到静态 `metadata.json`。
 * - 所有接口的返回类型用 camelCase，与前端其它组件一致（后端 schemas 就是 camelCase）。
 */

import type {
  ImageProcessingMetadata,
  ImageProcessingProduct,
} from '@/types/imageProcessing'

export const API_BASE = (() => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  const fromEnv = env?.VITE_GLYPHLENS_API_BASE
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/+$/, '')
  }
  return 'http://127.0.0.1:8787'
})()

export interface BackendHealth {
  status: 'ok'
  version: string
  relicCount: number
  annotationCount: number
}

export interface RelicSummary {
  id: string
  title: string
  kind: 'stele' | 'pictorial_stone'
  period: string | null
  location: string | null
  description: string | null
  createdAt: string
  productCount: number
  annotationCount: number
}

export interface RelicDetail extends ImageProcessingMetadata {
  kind: 'stele' | 'pictorial_stone'
  period: string | null
  location: string | null
  description: string | null
}

export interface LineRenderRequest {
  relicId: string
  gaussianSigma: number
  cannyLow: number
  cannyHigh: number
  useAdaptive: boolean
  adaptiveBlockSize: number
  adaptiveC: number
  closeKernel: number
  minAreaRatio: number
  keepLargestN: number
  dilateIters: number
  invert: boolean
  previewLongEdge?: number
}

export interface LineRenderResult {
  url: string
  blob: Blob
  width: number
  height: number
  byteLength: number
  elapsedMs: number
}

export interface AnnotationPayload {
  productKey?: string
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
  label?: string | null
  glyph?: string | null
  note?: string | null
  author?: string | null
}

export interface AnnotationPatch {
  label?: string | null
  glyph?: string | null
  note?: string | null
  author?: string | null
  bboxX?: number
  bboxY?: number
  bboxW?: number
  bboxH?: number
}

export interface Annotation {
  id: number
  relicId: string
  productKey: string
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
  label: string | null
  glyph: string | null
  note: string | null
  author: string | null
  createdAt: string
}

export interface NewRelicInput {
  id: string
  title: string
  kind?: 'stele' | 'pictorial_stone'
  period?: string
  location?: string
  description?: string
  longEdge?: number
  jpegQuality?: number
  file: File
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

type DetectResult =
  | { available: true; health: BackendHealth }
  | { available: false; reason: string }

let detectPromise: Promise<DetectResult> | null = null
let cachedResult: DetectResult | null = null

/** 一次探测，30s 内多次调用复用结果。 */
export function detectBackend(forceRefresh = false): Promise<DetectResult> {
  if (!forceRefresh && cachedResult) {
    return Promise.resolve(cachedResult)
  }
  if (!forceRefresh && detectPromise) {
    return detectPromise
  }

  detectPromise = (async () => {
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 2500)
      const resp = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      window.clearTimeout(timer)

      if (!resp.ok) {
        cachedResult = { available: false, reason: `HTTP ${resp.status}` }
        return cachedResult
      }

      const health = (await resp.json()) as BackendHealth
      cachedResult = { available: true, health }
      return cachedResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      cachedResult = { available: false, reason: message }
      return cachedResult
    } finally {
      detectPromise = null
    }
  })()

  return detectPromise
}

export function resetBackendCache(): void {
  cachedResult = null
  detectPromise = null
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`)
  }

  if (resp.status === 204) {
    return undefined as T
  }

  return (await resp.json()) as T
}

// ---------------------------------------------------------------------------
// Relics
// ---------------------------------------------------------------------------

interface BackendRelicOut {
  id: string
  title: string
  kind: 'stele' | 'pictorial_stone'
  period: string | null
  location: string | null
  description: string | null
  originalFile: string
  pipelineLongEdge: number
  jpegQuality: number
  generatedAt: string
  source: string
  products: ImageProcessingProduct[]
}

function toRelicDetail(data: BackendRelicOut): RelicDetail {
  return {
    id: data.id,
    title: data.title,
    subtitle: data.description ?? undefined,
    source: data.source,
    originalFile: data.originalFile,
    generatedAt: data.generatedAt,
    pipelineLongEdge: data.pipelineLongEdge,
    jpegQuality: data.jpegQuality,
    products: data.products,
    kind: data.kind,
    period: data.period,
    location: data.location,
    description: data.description,
  }
}

export function listRelics(): Promise<RelicSummary[]> {
  return jsonRequest<RelicSummary[]>('/api/relics')
}

export async function getRelic(id: string): Promise<RelicDetail> {
  const data = await jsonRequest<BackendRelicOut>(`/api/relics/${encodeURIComponent(id)}`)
  return toRelicDetail(data)
}

export async function createRelic(input: NewRelicInput): Promise<RelicDetail> {
  const form = new FormData()
  form.append('file', input.file)
  form.append(
    'metadata',
    JSON.stringify({
      id: input.id,
      title: input.title,
      kind: input.kind ?? 'pictorial_stone',
      period: input.period ?? null,
      location: input.location ?? null,
      description: input.description ?? null,
    }),
  )
  if (input.longEdge !== undefined) {
    form.append('longEdge', String(input.longEdge))
  }
  if (input.jpegQuality !== undefined) {
    form.append('jpegQuality', String(input.jpegQuality))
  }

  const data = await jsonRequest<BackendRelicOut>('/api/relics', {
    method: 'POST',
    body: form,
  })
  return toRelicDetail(data)
}

export async function deleteRelic(id: string): Promise<void> {
  await jsonRequest(`/api/relics/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function regenerateRelic(id: string): Promise<RelicDetail> {
  const data = await jsonRequest<BackendRelicOut>(
    `/api/relics/${encodeURIComponent(id)}/regenerate`,
    { method: 'POST' },
  )
  return toRelicDetail(data)
}

// ---------------------------------------------------------------------------
// Product rendering（微痕/锐化/灰度/拓片 level 调节）
// ---------------------------------------------------------------------------

export interface ProductRenderResult {
  url: string
  blob: Blob
  width: number
  height: number
  byteLength: number
  elapsedMs: number
}

export async function renderProductViaBackend(
  relicId: string,
  key: string,
  params: Record<string, number | boolean>,
): Promise<ProductRenderResult> {
  const started = performance.now()
  const resp = await fetch(`${API_BASE}/api/render-product`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relicId, key, params }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${resp.status}: ${text.slice(0, 300)}`)
  }

  const blob = await resp.blob()
  const width = Number(resp.headers.get('x-product-width') ?? 0)
  const height = Number(resp.headers.get('x-product-height') ?? 0)

  return {
    url: URL.createObjectURL(blob),
    blob,
    width,
    height,
    byteLength: blob.size,
    elapsedMs: Math.round(performance.now() - started),
  }
}

// ---------------------------------------------------------------------------
// Line rendering
// ---------------------------------------------------------------------------

export async function renderLineViaBackend(
  payload: LineRenderRequest,
): Promise<LineRenderResult> {
  const started = performance.now()
  const resp = await fetch(`${API_BASE}/api/line`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify(payload),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`)
  }

  const blob = await resp.blob()
  const width = Number(resp.headers.get('x-line-width') ?? 0)
  const height = Number(resp.headers.get('x-line-height') ?? 0)
  const url = URL.createObjectURL(blob)

  return {
    url,
    blob,
    width,
    height,
    byteLength: blob.size,
    elapsedMs: Math.round(performance.now() - started),
  }
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export interface OcrItem {
  text: string
  score: number
}

export interface OcrResult {
  text: string
  items: OcrItem[]
}

export interface OcrRequest {
  relicId: string
  productKey: string
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
}

export function ocrRegion(payload: OcrRequest): Promise<OcrResult> {
  return jsonRequest<OcrResult>('/api/ocr', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export function listAnnotations(relicId: string): Promise<Annotation[]> {
  return jsonRequest<Annotation[]>(
    `/api/relics/${encodeURIComponent(relicId)}/annotations`,
  )
}

export function createAnnotation(
  relicId: string,
  payload: AnnotationPayload,
): Promise<Annotation> {
  return jsonRequest<Annotation>(
    `/api/relics/${encodeURIComponent(relicId)}/annotations`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export function updateAnnotation(
  annotationId: number,
  payload: AnnotationPatch,
): Promise<Annotation> {
  return jsonRequest<Annotation>(
    `/api/annotations/${annotationId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  )
}

export async function deleteAnnotation(annotationId: number): Promise<void> {
  await jsonRequest(`/api/annotations/${annotationId}`, { method: 'DELETE' })
}
