import { useEffect, useState } from 'react'
import type OpenSeadragon from 'openseadragon'

import OSDViewer from '@/components/OSDViewer'
import { cn } from '@/lib/cn'
import { createViewportSync } from '@/lib/osdSync'
import type { ResolvedItemManifest, ViewId, ViewLayerModel } from '@/types/manifest'

interface SplitViewProps {
  item: ResolvedItemManifest
  splitMode: 1 | 2
  syncEnabled: boolean
  activePane: ViewId
  leftLayers: ViewLayerModel[]
  rightLayers: ViewLayerModel[]
}

export default function SplitView({
  item,
  splitMode,
  syncEnabled,
  activePane,
  leftLayers,
  rightLayers,
}: SplitViewProps) {
  const [leftViewer, setLeftViewer] = useState<OpenSeadragon.Viewer | null>(null)
  const [rightViewer, setRightViewer] = useState<OpenSeadragon.Viewer | null>(null)

  useEffect(() => {
    if (splitMode !== 2 || !syncEnabled || !leftViewer || !rightViewer) {
      return
    }

    return createViewportSync({
      leftViewer,
      rightViewer,
    })
  }, [leftViewer, rightViewer, splitMode, syncEnabled])

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 gap-4 p-4',
        splitMode === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2',
      )}
    >
      <OSDViewer
        key={`${item.id}-left`}
        viewId="left"
        title={`${item.title} · 原位工作视图`}
        layers={leftLayers}
        isActive={activePane === 'left'}
        onViewerChange={setLeftViewer}
      />

      {splitMode === 2 ? (
        <OSDViewer
          key={`${item.id}-right`}
          viewId="right"
          title={`${item.title} · 对照工作视图`}
          layers={rightLayers}
          isActive={activePane === 'right'}
          onViewerChange={setRightViewer}
        />
      ) : null}
    </div>
  )
}
