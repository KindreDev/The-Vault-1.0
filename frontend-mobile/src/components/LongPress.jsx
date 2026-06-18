import { useRef, useCallback } from 'react'

// Wraps any element so a press-and-hold (default 450ms) fires onLongPress,
// while a normal quick tap fires onClick. Replaces desktop right-click menus.
// Movement beyond a small threshold cancels the long-press (it was a scroll).
export default function LongPress({
  onLongPress,
  onClick,
  delay = 450,
  className = '',
  children,
  ...rest
}) {
  const timer = useRef(null)
  const fired = useRef(false)
  const moved = useRef(false)
  const start = useRef({ x: 0, y: 0 })

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const onStart = useCallback((e) => {
    fired.current = false
    moved.current = false
    const t = e.touches?.[0] || e
    start.current = { x: t.clientX, y: t.clientY }
    timer.current = setTimeout(() => {
      fired.current = true
      if (navigator.vibrate) navigator.vibrate(15)
      onLongPress?.(e)
    }, delay)
  }, [delay, onLongPress])

  const onMove = useCallback((e) => {
    const t = e.touches?.[0] || e
    const dx = Math.abs(t.clientX - start.current.x)
    const dy = Math.abs(t.clientY - start.current.y)
    // A real drag/scroll cancels both the long-press AND the tap, so scrolling
    // over a card never opens it.
    if (dx > 10 || dy > 10) { moved.current = true; clear() }
  }, [clear])

  const onEnd = useCallback((e) => {
    clear()
    if (!fired.current && !moved.current) onClick?.(e)
  }, [clear, onClick])

  return (
    <div
      className={className}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onTouchCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      {children}
    </div>
  )
}
