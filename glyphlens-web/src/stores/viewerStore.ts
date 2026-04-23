import { create } from 'zustand'

import {
  type LayerRuntimeState,
  type RelicItemManifest,
  type ResolvedItemManifest,
  type ViewId,
  resolveItemManifest,
} from '@/types/manifest'

export type SplitMode = 1 | 2

export interface PaneState {
  layerOrder: string[]
  layerStateById: Record<string, LayerRuntimeState>
}

interface ViewerStore {
  items: ResolvedItemManifest[]
  activeItemId: string | null
  activePane: ViewId
  splitMode: SplitMode
  syncEnabled: boolean
  views: Record<ViewId, PaneState>
  loadItems: (items: RelicItemManifest[]) => void
  setActiveItem: (itemId: string) => void
  setActivePane: (viewId: ViewId) => void
  setSplitMode: (mode: SplitMode) => void
  setSyncEnabled: (enabled: boolean) => void
  toggleLayerVisibility: (viewId: ViewId, layerId: string) => void
  setLayerOpacity: (viewId: ViewId, layerId: string, opacity: number) => void
  reorderLayers: (viewId: ViewId, layerOrder: string[]) => void
  activateExclusiveLayer: (viewId: ViewId, layerIds: string[], activeLayerId: string) => void
  resetPane: (viewId: ViewId) => void
}

function createEmptyPaneState(): PaneState {
  return {
    layerOrder: [],
    layerStateById: {},
  }
}

function clonePaneState(pane: PaneState): PaneState {
  return {
    layerOrder: [...pane.layerOrder],
    layerStateById: Object.fromEntries(
      Object.entries(pane.layerStateById).map(([layerId, layerState]) => [
        layerId,
        { ...layerState },
      ]),
    ),
  }
}

function createPaneState(item: ResolvedItemManifest): PaneState {
  return {
    layerOrder: item.layers.map((layer) => layer.id),
    layerStateById: Object.fromEntries(
      item.layers.map((layer) => [
        layer.id,
        {
          visible: layer.defaultVisible,
          opacity: layer.defaultOpacity,
        },
      ]),
    ),
  }
}

function buildViewStateForItem(item: ResolvedItemManifest | undefined): Record<ViewId, PaneState> {
  if (!item) {
    return {
      left: createEmptyPaneState(),
      right: createEmptyPaneState(),
    }
  }

  const baseState = createPaneState(item)

  return {
    left: clonePaneState(baseState),
    right: clonePaneState(baseState),
  }
}

function updatePane(
  views: Record<ViewId, PaneState>,
  viewId: ViewId,
  updater: (pane: PaneState) => PaneState,
): Record<ViewId, PaneState> {
  return {
    ...views,
    [viewId]: updater(views[viewId]),
  }
}

export const useViewerStore = create<ViewerStore>((set, get) => ({
  items: [],
  activeItemId: null,
  activePane: 'left',
  splitMode: 1,
  syncEnabled: true,
  views: {
    left: createEmptyPaneState(),
    right: createEmptyPaneState(),
  },
  loadItems: (items) => {
    const resolvedItems = items.map(resolveItemManifest)
    const firstItem = resolvedItems[0]

    set({
      items: resolvedItems,
      activeItemId: firstItem?.id ?? null,
      activePane: 'left',
      splitMode: 1,
      syncEnabled: true,
      views: buildViewStateForItem(firstItem),
    })
  },
  setActiveItem: (itemId) => {
    const item = get().items.find((candidate) => candidate.id === itemId)

    if (!item) {
      return
    }

    set({
      activeItemId: item.id,
      activePane: 'left',
      views: buildViewStateForItem(item),
    })
  },
  setActivePane: (viewId) => {
    set({ activePane: viewId })
  },
  setSplitMode: (mode) => {
    set((state) => ({
      splitMode: mode,
      activePane: mode === 1 ? 'left' : state.activePane,
    }))
  },
  setSyncEnabled: (enabled) => {
    set({ syncEnabled: enabled })
  },
  toggleLayerVisibility: (viewId, layerId) => {
    set((state) => ({
      views: updatePane(state.views, viewId, (pane) => ({
        ...pane,
        layerStateById: {
          ...pane.layerStateById,
          [layerId]: {
            ...pane.layerStateById[layerId],
            visible: !pane.layerStateById[layerId]?.visible,
          },
        },
      })),
    }))
  },
  setLayerOpacity: (viewId, layerId, opacity) => {
    set((state) => ({
      views: updatePane(state.views, viewId, (pane) => ({
        ...pane,
        layerStateById: {
          ...pane.layerStateById,
          [layerId]: {
            ...pane.layerStateById[layerId],
            opacity,
          },
        },
      })),
    }))
  },
  reorderLayers: (viewId, layerOrder) => {
    set((state) => ({
      views: updatePane(state.views, viewId, (pane) => ({
        ...pane,
        layerOrder,
      })),
    }))
  },
  activateExclusiveLayer: (viewId, layerIds, activeLayerId) => {
    set((state) => ({
      views: updatePane(state.views, viewId, (pane) => ({
        ...pane,
        layerStateById: Object.fromEntries(
          Object.entries(pane.layerStateById).map(([layerId, layerState]) => [
            layerId,
            layerIds.includes(layerId)
              ? {
                  ...layerState,
                  visible: layerId === activeLayerId,
                }
              : layerState,
          ]),
        ),
      })),
    }))
  },
  resetPane: (viewId) => {
    const activeItem = getActiveItem(get())

    if (!activeItem) {
      return
    }

    set((state) => ({
      views: {
        ...state.views,
        [viewId]: createPaneState(activeItem),
      },
    }))
  },
}))

export function getActiveItem(state: Pick<ViewerStore, 'items' | 'activeItemId'>): ResolvedItemManifest | null {
  return state.items.find((item) => item.id === state.activeItemId) ?? null
}
