import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// The app scrolls inside <main class="vault-main">, not the window, so the
// browser's own scroll restoration never kicks in. List pages that unmount when
// you open an item (Galleries → a gallery) use this to come back where you were.
//
// Positions are remembered per URL (path + filters + page) for this session and
// only restored on Back/Forward, so opening the page from the sidebar still
// starts at the top.
const positions = new Map()

function scroller() {
  return document.querySelector('main.vault-main') || document.querySelector('main')
}

export function useMainScrollRestore(ready) {
  const location = useLocation()
  const navType = useNavigationType()
  const key = location.pathname + location.search
  const keyRef = useRef(key)
  keyRef.current = key

  // Layout effect so the listener is gone before the next page's DOM can
  // shrink <main> and fire a clamped scroll event that would overwrite us.
  useLayoutEffect(() => {
    const el = scroller()
    if (!el) return undefined
    const onScroll = () => positions.set(keyRef.current, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !ready) return undefined
    restoredRef.current = true
    const target = positions.get(key)
    if (navType !== 'POP' || !target) return undefined
    const el = scroller()
    if (!el) return undefined
    // Cards and thumbnails may still be laying out; keep trying for a moment
    // until the page is tall enough to reach the saved spot.
    let frame = 0
    let raf = 0
    const attempt = () => {
      el.scrollTop = target
      const reachable = el.scrollHeight - el.clientHeight >= target - 2
      if (!reachable && frame++ < 60) raf = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(raf)
  }, [ready, key, navType])
}
