import { useEffect } from 'react'

// A shared, reference-counted document lock. Several overlays can be mounted
// at once (for example a confirmation dialog over a detail view), so each
// consumer must release only its own lock and the original inline styles must
// survive until the final overlay closes.
let activeLocks = 0
let previousStyles = null
let lockedScrollers = []

// The app does not scroll <body>: the page scrolls inside <main class=
// "vault-main">. Locking only the document left that container scrolling
// behind every modal, so the scroll containers are locked as well.
const SCROLL_CONTAINERS = '.vault-main'

function lockDocument() {
  if (typeof document === 'undefined') return () => {}

  const body = document.body
  const root = document.documentElement
  if (activeLocks === 0) {
    previousStyles = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      rootScrollLocked: root.getAttribute('data-vault-scroll-locked'),
    }
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    root.setAttribute('data-vault-scroll-locked', 'true')
    // overflow:hidden keeps the current scroll position; it is restored as-is.
    lockedScrollers = [...document.querySelectorAll(SCROLL_CONTAINERS)].map(element => {
      const saved = { element, overflow: element.style.overflow, overflowY: element.style.overflowY }
      element.style.overflow = 'hidden'
      element.style.overflowY = 'hidden'
      return saved
    })
  }
  activeLocks += 1

  let released = false
  return () => {
    if (released) return
    released = true
    activeLocks = Math.max(0, activeLocks - 1)
    if (activeLocks !== 0 || !previousStyles) return
    body.style.overflow = previousStyles.bodyOverflow
    body.style.overscrollBehavior = previousStyles.bodyOverscroll
    root.style.overflow = previousStyles.rootOverflow
    root.style.overscrollBehavior = previousStyles.rootOverscroll
    if (previousStyles.rootScrollLocked === null) root.removeAttribute('data-vault-scroll-locked')
    else root.setAttribute('data-vault-scroll-locked', previousStyles.rootScrollLocked)
    for (const { element, overflow, overflowY } of lockedScrollers) {
      element.style.overflow = overflow
      element.style.overflowY = overflowY
    }
    lockedScrollers = []
    previousStyles = null
  }
}

export function useScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined
    return lockDocument()
  }, [enabled])
}

export function getScrollLockCount() {
  return activeLocks
}
