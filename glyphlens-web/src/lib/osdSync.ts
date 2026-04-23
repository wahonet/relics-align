import type OpenSeadragon from 'openseadragon'

export interface OSDViewportSyncOptions {
  leftViewer: OpenSeadragon.Viewer
  rightViewer: OpenSeadragon.Viewer
}

export function createViewportSync({
  leftViewer,
  rightViewer,
}: OSDViewportSyncOptions): () => void {
  let syncing = false

  const syncViewport = (
    sourceViewer: OpenSeadragon.Viewer,
    targetViewer: OpenSeadragon.Viewer,
  ): void => {
    if (syncing) {
      return
    }

    if (sourceViewer.world.getItemCount() === 0 || targetViewer.world.getItemCount() === 0) {
      return
    }

    syncing = true

    const center = sourceViewer.viewport.getCenter(true)
    const zoom = sourceViewer.viewport.getZoom(true)

    targetViewer.viewport.panTo(center, true)
    targetViewer.viewport.zoomTo(zoom, center, true)
    targetViewer.viewport.applyConstraints(true)
    targetViewer.forceRedraw()

    syncing = false
  }

  const handleLeftChange = (): void => {
    syncViewport(leftViewer, rightViewer)
  }

  const handleRightChange = (): void => {
    syncViewport(rightViewer, leftViewer)
  }

  leftViewer.addHandler('viewport-change', handleLeftChange)
  rightViewer.addHandler('viewport-change', handleRightChange)

  return () => {
    leftViewer.removeHandler('viewport-change', handleLeftChange)
    rightViewer.removeHandler('viewport-change', handleRightChange)
  }
}
