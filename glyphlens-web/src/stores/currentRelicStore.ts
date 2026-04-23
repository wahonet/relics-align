/**
 * 跨模块共享的"当前文物"上下文。
 *
 * - 图像处理 / 字迹标注 / 数据管理 三个模块都用同一个 relic 源
 * - 后端可用时从 `/api/relics` 读；不可用时（或后端挂了）降级到静态 metadata.json
 * - 切换 active 文物只存 id，详情在各模块按需请求（结合 api cache）
 */

import { create } from 'zustand'

import {
  detectBackend,
  getRelic,
  listRelics,
  type RelicDetail,
  type RelicSummary,
} from '@/lib/api'
import type { ImageProcessingMetadata } from '@/types/imageProcessing'

const LEGACY_METADATA_URL = '/demo/processed/metadata.json'

export type BackendStatus =
  | { kind: 'unknown' }
  | { kind: 'probing' }
  | { kind: 'online'; version: string; relicCount: number }
  | { kind: 'offline'; reason: string }

export type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

interface CurrentRelicStore {
  backend: BackendStatus
  loadState: LoadState
  relics: RelicSummary[]
  activeId: string | null
  detailById: Record<string, RelicDetail>
  // --- actions ---
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  setActive: (id: string) => void
  ensureDetail: (id: string) => Promise<RelicDetail | null>
  upsertDetail: (detail: RelicDetail) => void
  removeRelic: (id: string) => void
}

/**
 * 把静态 metadata.json 变成一份「RelicSummary + RelicDetail」伪数据，
 * 这样后端离线时图像处理模块仍可用老路径显示。
 */
async function loadLegacyRelic(): Promise<
  { summary: RelicSummary; detail: RelicDetail } | null
> {
  try {
    const resp = await fetch(LEGACY_METADATA_URL)
    if (!resp.ok) {
      return null
    }
    const data = (await resp.json()) as ImageProcessingMetadata
    const detail: RelicDetail = {
      ...data,
      kind: 'pictorial_stone',
      period: null,
      location: null,
      description: data.subtitle ?? null,
    }
    const summary: RelicSummary = {
      id: data.id,
      title: data.title,
      kind: 'pictorial_stone',
      period: null,
      location: null,
      description: data.subtitle ?? null,
      createdAt: data.generatedAt,
      productCount: data.products.length,
      annotationCount: 0,
    }
    return { summary, detail }
  } catch {
    return null
  }
}

export const useCurrentRelicStore = create<CurrentRelicStore>((set, get) => ({
  backend: { kind: 'unknown' },
  loadState: { kind: 'idle' },
  relics: [],
  activeId: null,
  detailById: {},

  async bootstrap() {
    if (get().loadState.kind === 'loading') {
      return
    }
    set({ loadState: { kind: 'loading' }, backend: { kind: 'probing' } })

    const detect = await detectBackend()
    if (detect.available) {
      set({
        backend: {
          kind: 'online',
          version: detect.health.version,
          relicCount: detect.health.relicCount,
        },
      })
      try {
        const relics = await listRelics()
        set({
          relics,
          activeId: get().activeId ?? relics[0]?.id ?? null,
          loadState: { kind: 'ready' },
        })
      } catch (error) {
        set({
          loadState: {
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
      return
    }

    // 后端不可用 → 降级到静态 metadata.json
    set({ backend: { kind: 'offline', reason: detect.reason } })
    const legacy = await loadLegacyRelic()
    if (legacy) {
      set((state) => ({
        relics: [legacy.summary],
        activeId: state.activeId ?? legacy.summary.id,
        detailById: { ...state.detailById, [legacy.detail.id]: legacy.detail },
        loadState: { kind: 'ready' },
      }))
    } else {
      set({
        loadState: {
          kind: 'error',
          message: '后端未启动，且本地 demo metadata.json 也无法读取。',
        },
      })
    }
  },

  async refresh() {
    const backend = get().backend
    if (backend.kind !== 'online') {
      await get().bootstrap()
      return
    }
    try {
      const relics = await listRelics()
      set({ relics })
      // 如果 active 已被删，退回到第一项
      const stillActive = relics.find((r) => r.id === get().activeId)
      if (!stillActive) {
        set({ activeId: relics[0]?.id ?? null })
      }
    } catch (error) {
      set({
        loadState: {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  },

  setActive(id) {
    set({ activeId: id })
  },

  async ensureDetail(id) {
    const cached = get().detailById[id]
    if (cached) {
      return cached
    }
    const backend = get().backend
    if (backend.kind !== 'online') {
      return cached ?? null
    }
    try {
      const detail = await getRelic(id)
      set((state) => ({
        detailById: { ...state.detailById, [id]: detail },
      }))
      return detail
    } catch {
      return null
    }
  },

  upsertDetail(detail) {
    set((state) => ({
      detailById: { ...state.detailById, [detail.id]: detail },
    }))
  },

  removeRelic(id) {
    set((state) => {
      const nextDetails = { ...state.detailById }
      delete nextDetails[id]
      const remaining = state.relics.filter((r) => r.id !== id)
      return {
        relics: remaining,
        detailById: nextDetails,
        activeId:
          state.activeId === id ? remaining[0]?.id ?? null : state.activeId,
      }
    })
  },
}))

export function getActiveRelicSummary(
  state: Pick<CurrentRelicStore, 'relics' | 'activeId'>,
): RelicSummary | null {
  return state.relics.find((r) => r.id === state.activeId) ?? null
}

export function getActiveRelicDetail(
  state: Pick<CurrentRelicStore, 'detailById' | 'activeId'>,
): RelicDetail | null {
  if (!state.activeId) {
    return null
  }
  return state.detailById[state.activeId] ?? null
}
