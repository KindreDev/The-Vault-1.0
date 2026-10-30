import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'

// Rows of equal height that fill the full width, like Google Photos. Each
// item keeps its own shape; the row height flexes so the row ends flush.
// The last row keeps the target height instead of stretching.
export function layoutJustified(aspects, width, targetHeight, gap) {
  const rows = []
  let row = []
  let sum = 0
  aspects.forEach((aspect, index) => {
    row.push({ index, aspect })
    sum += aspect
    const fullWidth = sum * targetHeight + gap * (row.length - 1)
    if (fullWidth >= width) {
      const height = (width - gap * (row.length - 1)) / sum
      rows.push({ height, items: row })
      row = []
      sum = 0
    }
  })
  if (row.length) rows.push({ height: targetHeight, items: row, last: true })
  return rows
}

export default function JustifiedGrid({ items, getAspect, targetHeight, gap = 8, renderItem, className = '' }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(() => {
    if (!width) return []
    // Clamp extreme shapes so one panorama or sliver can't wreck a row.
    const aspects = items.map(item => Math.min(3, Math.max(0.4, getAspect(item) || 1)))
    return layoutJustified(aspects, width, targetHeight, gap)
  }, [items, getAspect, width, targetHeight, gap])

  return (
    <div ref={ref} className={className} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex', gap, height: Math.round(row.height) }}>
          {row.items.map(({ index, aspect }) => (
            // Full rows share the width by aspect (exact, no rounding gaps);
            // the last row keeps natural widths and stays left-aligned.
            <div key={items[index].id ?? index}
                 style={row.last
                   ? { width: row.height * aspect, flexShrink: 0, height: '100%' }
                   : { flex: `${aspect} 1 0%`, minWidth: 0, height: '100%' }}>
              {renderItem(items[index], index)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
