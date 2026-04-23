export type ItemKind = 'stele' | 'pictorial_stone'

export type LayerKind =
  | 'photo_raw'
  | 'rubbing_paper'
  | 'rubbing_digital'
  | 'enhanced_clahe'
  | 'grayscale'
  | '3d_render'
  | 'line_drawing'
  | 'photo_raking_light_n'
  | 'photo_raking_light_e'
  | 'photo_raking_light_s'
  | 'photo_raking_light_w'
  | 'custom'

export type ViewId = 'left' | 'right'

export interface BBox {
  id?: string
  label?: string
  score?: number
  x: number
  y: number
  width: number
  height: number
}

export interface RelicLayerManifest {
  id: string
  kind: LayerKind
  label: string
  tileSource: string
  fallbackTileSource?: string
  defaultOpacity?: number
  defaultVisible?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  notes?: string
}

export interface RelicItemManifest {
  id: string
  title: string
  kind: ItemKind
  location?: string
  period?: string
  description?: string
  layers: RelicLayerManifest[]
  regions?: BBox[]
}

export interface ResolvedLayerManifest
  extends Omit<RelicLayerManifest, 'fallbackTileSource' | 'defaultOpacity' | 'defaultVisible'> {
  fallbackTileSource: string
  defaultOpacity: number
  defaultVisible: boolean
}

export interface ResolvedItemManifest extends Omit<RelicItemManifest, 'layers'> {
  layers: ResolvedLayerManifest[]
}

export interface ManifestIndex {
  items: string[]
}

export interface LayerRuntimeState {
  visible: boolean
  opacity: number
}

export interface ViewLayerModel extends ResolvedLayerManifest, LayerRuntimeState {}

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  stele: '碑刻文字',
  pictorial_stone: '汉画像石',
}

export const DEFAULT_PLACEHOLDER_TILE_SOURCE: Record<ItemKind, string> = {
  stele: 'https://openseadragon.github.io/example-images/highsmith/highsmith.dzi',
  pictorial_stone: 'https://openseadragon.github.io/example-images/duomo/duomo.dzi',
}

export function isRakingLightLayer(kind: LayerKind): boolean {
  return kind.startsWith('photo_raking_light_')
}

export function getDirectionLabel(kind: LayerKind): string | null {
  switch (kind) {
    case 'photo_raking_light_n':
      return '北向掠射光'
    case 'photo_raking_light_e':
      return '东向掠射光'
    case 'photo_raking_light_s':
      return '南向掠射光'
    case 'photo_raking_light_w':
      return '西向掠射光'
    default:
      return null
  }
}

export function resolveItemManifest(item: RelicItemManifest): ResolvedItemManifest {
  return {
    ...item,
    layers: item.layers.map((layer, index) => ({
      ...layer,
      defaultOpacity: layer.defaultOpacity ?? (index === 0 ? 1 : 0.65),
      defaultVisible: layer.defaultVisible ?? index === 0,
      fallbackTileSource:
        layer.fallbackTileSource ?? DEFAULT_PLACEHOLDER_TILE_SOURCE[item.kind],
    })),
  }
}
