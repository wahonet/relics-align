import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'

import type { Annotation } from '@/lib/api'
import { cn } from '@/lib/cn'

import type { BBox, Draft, Selection } from './types'

// ---------------------------------------------------------------------------
// 视口：自绘 pan / zoom / 画框
// ---------------------------------------------------------------------------

export interface AnnotationViewportProps {
  imgUrl: string
  annotations: Annotation[]
  drafts: Draft[]
  selection: Selection
  onDrawComplete: (bbox: BBox) => void
  onSelect: (sel: Selection) => void
  onCancel: () => void
}

export default function AnnotationViewport({
  imgUrl,
  annotations,
  drafts,
  selection,
  onDrawComplete,
  onSelect,
  onCancel,
}: AnnotationViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const panRef = useRef<{
    startX: number
    startY: number
    origTx: number
    origTy: number
  } | null>(null)
  const drawRef = useRef(false)
  // 记录上一次加载图的自然尺寸；相同尺寸切换底图时保留缩放/平移
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null)

  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const [imgReady, setImgReady] = useState(false)
  const [drawBox, setDrawBox] = useState<{
    x1: number
    y1: number
    x2: number
    y2: number
  } | null>(null)

  const fit = useCallback(() => {
    const c = containerRef.current
    const img = imgRef.current
    if (!c || !img || !img.naturalWidth || !img.naturalHeight) return
    const cw = c.clientWidth
    const ch = c.clientHeight
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * 0.95
    setView({
      scale,
      tx: (cw - img.naturalWidth * scale) / 2,
      ty: (ch - img.naturalHeight * scale) / 2,
    })
  }, [])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    // 容器尺寸变化：仅在尚未 fit 过时执行 fit，避免挤压窗口时把用户的缩放重置掉
    const ro = new ResizeObserver(() => {
      if (!lastSizeRef.current) fit()
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [fit])

  const handleImgLoad = () => {
    const img = imgRef.current
    const nw = img?.naturalWidth ?? 0
    const nh = img?.naturalHeight ?? 0
    const last = lastSizeRef.current
    const sizeChanged = !last || last.w !== nw || last.h !== nh
    lastSizeRef.current = { w: nw, h: nh }
    setImgReady(true)
    // 首次加载或尺寸变化（换了不同的文物/线图尺寸）才重置视图，其余情况保留缩放
    if (sizeChanged) fit()
  }

  const pointToNorm = (clientX: number, clientY: number) => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 }
    return {
      x: (clientX - r.left) / r.width,
      y: (clientY - r.top) / r.height,
    }
  }

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!imgReady) return
    const c = containerRef.current?.getBoundingClientRect()
    if (!c) return
    const cx = e.clientX - c.left
    const cy = e.clientY - c.top
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.max(0.05, Math.min(40, v.scale * factor))
      const k = next / v.scale
      return {
        scale: next,
        tx: cx - k * (cx - v.tx),
        ty: cy - k * (cy - v.ty),
      }
    })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!imgReady) return
    if (e.button === 1) {
      e.preventDefault()
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origTx: view.tx,
        origTy: view.ty,
      }
      containerRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 0) {
      const p = pointToNorm(e.clientX, e.clientY)
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return
      drawRef.current = true
      setDrawBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
      containerRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 2) {
      e.preventDefault()
      if (drawRef.current) {
        drawRef.current = false
        setDrawBox(null)
        containerRef.current?.releasePointerCapture(e.pointerId)
      } else {
        onCancel()
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan) {
      setView((v) => ({
        ...v,
        tx: pan.origTx + (e.clientX - pan.startX),
        ty: pan.origTy + (e.clientY - pan.startY),
      }))
      return
    }
    if (drawRef.current) {
      const p = pointToNorm(e.clientX, e.clientY)
      setDrawBox((d) =>
        d
          ? {
              ...d,
              x2: Math.max(0, Math.min(1, p.x)),
              y2: Math.max(0, Math.min(1, p.y)),
            }
          : null,
      )
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null
      containerRef.current?.releasePointerCapture(e.pointerId)
    }
    if (drawRef.current) {
      drawRef.current = false
      containerRef.current?.releasePointerCapture(e.pointerId)
      const db = drawBox
      setDrawBox(null)
      if (db) {
        const x = Math.min(db.x1, db.x2)
        const y = Math.min(db.y1, db.y2)
        const w = Math.abs(db.x2 - db.x1)
        const h = Math.abs(db.y2 - db.y1)
        if (w * h >= 0.00004) {
          onDrawComplete({ x, y, w, h })
        }
      }
    }
  }

  const preview = useMemo(() => {
    if (!drawBox) return null
    return {
      x: Math.min(drawBox.x1, drawBox.x2),
      y: Math.min(drawBox.y1, drawBox.y2),
      w: Math.abs(drawBox.x2 - drawBox.x1),
      h: Math.abs(drawBox.y2 - drawBox.y1),
    }
  }, [drawBox])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 cursor-crosshair select-none touch-none"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: 'top left',
          visibility: imgReady ? 'visible' : 'hidden',
        }}
      >
        <img
          ref={imgRef}
          src={imgUrl}
          alt=""
          draggable={false}
          onLoad={handleImgLoad}
          className="block"
          style={{ maxWidth: 'none' }}
        />
        <div className="pointer-events-none absolute inset-0">
          {annotations.map((a) => (
            <BoxOverlay
              key={`s_${a.id}`}
              color="saved"
              selected={selection?.kind === 'saved' && selection.id === a.id}
              bbox={{ x: a.bboxX, y: a.bboxY, w: a.bboxW, h: a.bboxH }}
              scale={view.scale}
              caption={a.glyph || a.label || `#${a.id}`}
              onSelect={() => onSelect({ kind: 'saved', id: a.id })}
            />
          ))}
          {drafts.map((d) => (
            <BoxOverlay
              key={d.tempId}
              color="draft"
              selected={
                selection?.kind === 'draft' && selection.tempId === d.tempId
              }
              bbox={d.bbox}
              scale={view.scale}
              caption={d.glyph || d.label || '草稿'}
              onSelect={() => onSelect({ kind: 'draft', tempId: d.tempId })}
            />
          ))}
          {preview ? (
            <div
              className="absolute border-2 border-dashed border-ochre-500 bg-ochre-400/10"
              style={{
                left: `${preview.x * 100}%`,
                top: `${preview.y * 100}%`,
                width: `${preview.w * 100}%`,
                height: `${preview.h * 100}%`,
                borderWidth: `${2 / view.scale}px`,
              }}
            />
          ) : null}
        </div>
      </div>

      {!imgReady ? (
        <div className="flex h-full items-center justify-center text-[12px] text-paper-300">
          加载底图…
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 图上标注框
// ---------------------------------------------------------------------------

interface BoxOverlayProps {
  bbox: BBox
  color: 'saved' | 'draft'
  selected: boolean
  scale: number
  caption: string
  onSelect: () => void
}

function BoxOverlay({
  bbox,
  color,
  selected,
  scale,
  caption,
  onSelect,
}: BoxOverlayProps) {
  const palette =
    color === 'saved'
      ? selected
        ? 'border-seal-500 bg-seal-500/20'
        : 'border-seal-500 bg-seal-500/10'
      : selected
        ? 'border-ochre-500 bg-ochre-400/25'
        : 'border-ochre-500 bg-ochre-400/15'
  const captionPalette =
    color === 'saved' ? 'bg-seal-500 text-paper-50' : 'bg-ochre-500 text-paper-50'

  return (
    <div
      className={cn('pointer-events-auto absolute cursor-pointer border-2', palette)}
      style={{
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.w * 100}%`,
        height: `${bbox.h * 100}%`,
        borderWidth: `${(selected ? 3 : 2) / scale}px`,
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.button === 0) onSelect()
      }}
    >
      <span
        className={cn(
          'absolute left-0 top-0 -translate-y-full whitespace-nowrap font-display leading-none',
          captionPalette,
        )}
        style={{
          fontSize: `${11 / scale}px`,
          padding: `${2 / scale}px ${4 / scale}px`,
          borderRadius: `${2 / scale}px`,
        }}
      >
        {caption}
      </span>
    </div>
  )
}
