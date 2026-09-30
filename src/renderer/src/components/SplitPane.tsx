import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode | null
  /** Width of the right pane in px. */
  initialSize?: number
  minSize?: number
  maxRatio?: number
  storageKey?: string
}

const readStored = (key: string | undefined, fallback: number): number => {
  if (!key) return fallback
  try {
    const value = Number(localStorage.getItem(`split:${key}`))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/** Horizontal split with a draggable divider; the right pane is optional. */
export function SplitPane({
  left,
  right,
  initialSize = 460,
  minSize = 280,
  maxRatio = 0.75,
  storageKey
}: SplitPaneProps) {
  const [size, setSize] = useState(() => readStored(storageKey, initialSize))
  const [dragging, setDragging] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  const onMove = useCallback(
    (e: MouseEvent) => {
      const rect = container.current?.getBoundingClientRect()
      if (!rect) return
      const next = Math.min(rect.width * maxRatio, Math.max(minSize, rect.right - e.clientX))
      setSize(next)
    },
    [maxRatio, minSize]
  )

  useEffect(() => {
    if (!dragging) return
    const stop = (): void => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      document.body.style.cursor = ''
    }
  }, [dragging, onMove])

  useEffect(() => {
    if (dragging || !storageKey) return
    try {
      localStorage.setItem(`split:${storageKey}`, String(Math.round(size)))
    } catch {
      // Persisting the pane width is a convenience only.
    }
  }, [dragging, size, storageKey])

  return (
    <div className="split" ref={container}>
      <div className="pane fill">{left}</div>
      {right && (
        <>
          <div className={`split-handle${dragging ? ' dragging' : ''}`} onMouseDown={() => setDragging(true)} />
          <div className="pane" style={{ width: size }}>
            {right}
          </div>
        </>
      )}
    </div>
  )
}
