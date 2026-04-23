import { useEffect, useState } from 'react'

import Sidebar from '@/components/Sidebar'
import Workspace from '@/components/Workspace'
import { useViewerStore } from '@/stores/viewerStore'
import type { ManifestIndex, RelicItemManifest } from '@/types/manifest'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export default function MultiLayerModule() {
  const loadItems = useViewerStore((state) => state.loadItems)
  const hasItems = useViewerStore((state) => state.items.length > 0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    hasItems ? 'ready' : 'loading',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (hasItems) {
      return
    }

    let cancelled = false

    const bootstrap = async (): Promise<void> => {
      try {
        const index = await fetchJson<ManifestIndex>('/manifests/index.json')
        const items = await Promise.all(
          index.items.map((manifestUrl) => fetchJson<RelicItemManifest>(manifestUrl)),
        )

        if (cancelled) {
          return
        }

        loadItems(items)
        setStatus('ready')
      } catch (error) {
        if (cancelled) {
          return
        }

        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : '加载 manifest 失败')
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [hasItems, loadItems])

  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center py-24">
        <div className="rounded-2xl border border-paper-300/70 bg-paper-50/80 px-8 py-6 text-center shadow-sm">
          <p className="font-display text-lg text-ink-600">正在加载多图层比对工作台</p>
          <p className="mt-2 text-xs text-ink-400">读取 public/manifests/index.json</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-full items-center justify-center py-24">
        <div className="max-w-md rounded-2xl border border-seal-500/40 bg-paper-50/90 p-8 text-center">
          <p className="font-display text-xl text-seal-500">多图层清单读取失败</p>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            无法读取 `public/manifests/index.json` 或其引用的 item manifest。
          </p>
          {errorMessage ? (
            <p className="mt-3 rounded-xl border border-seal-500/30 bg-seal-500/5 px-4 py-3 text-sm text-seal-600">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-full grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Sidebar />
      <Workspace />
    </div>
  )
}
