export type ProductColorMode = 'color' | 'gray' | 'binary'

export interface ImageProcessingProduct {
  key: string
  label: string
  description: string
  colorMode: ProductColorMode
  src: string
  sizeBytes: number
  width: number
  height: number
}

export interface ImageProcessingMetadata {
  id: string
  title: string
  subtitle?: string
  source: string
  originalFile: string
  generatedAt: string
  pipelineLongEdge: number
  jpegQuality: number
  products: ImageProcessingProduct[]
}

export const PRODUCT_ORDER: string[] = [
  'original',
  'microtrace',
  'sharpen',
  'grayscale',
  'line',
  'rubbing',
]
