import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Navigation memory for the mobile app: filters that survive leaving a page,
// scroll positions, the last place you were in each tab, and a back-button
// stack so Android's back closes sheets/viewers before it leaves the page.

const store = (session) => {
  try { return session ? window.sessionStorage : window.localStorage } catch { return null }
}
export function readJSON(key, fallback, session = false) {
  try { const v = store(session)?.getItem(key); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
}
export function writeJSON(key, value, session = false) {
  try { store(session)?.setItem(key, JSON.stringify(value)) } catch {}
}

// useState that remembers its value. localStorage by default (survives an app
// restart); { session: true } keeps it only until the app is closed.
export function usePersistentState(key, initial, { session = false } = {}) {
  const [value, setValue] = useState(() => readJSON(key, typeof initial === 'function' ? initial() : initial, session))
  useEffect(() => { writeJSON(key, value, session) }, [key, value, session])
  return [value, setValue]
}

// React Router keeps its own index in history.state — the reliable way to know
// whether "back" stays inside the app (window.history.length counts entries
// from before the app loaded too).
export function canGoBack() {
  return (window.history.state?.idx ?? 0) > 0
}
export function goBack(nav, fallback = '/') {
  if (canGoBack()) nav(-1)
  else nav(fallback, { replace: true })
}

// ── Back-button stack ────────────────────────────────────────────────────────
// Overlays register a close handler while open; the Android back button closes
// the newest one first and only navigates when nothing is open.
const backStack = []
export function useBackClose(open, onClose) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!open) return
    const entry = () => ref.current?.()
    backStack.push(entry)
    return () => { const i = backStack.lastIndexOf(entry); if (i >= 0) backStack.splice(i, 1) }
  }, [open])
}
export function closeTopOverlay() {
  const top = backStack[backStack.length - 1]
  if (!top) return false
  top()
  return true
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
// Each tab remembers the last page you opened from it, so switching tabs and
// coming back lands where you left off (Instagram-style).
export const TAB_ROOTS = ['/', '/galleries', '/feed', '/cards', '/creators']
const TABS_KEY = 'vault.m.tabs'
const FULLSCREEN = ['/view/', '/video/', '/photo/', '/curate']
export const isFullscreenPath = (p) => FULLSCREEN.some(f => p.startsWith(f)) || p.endsWith('/view')
// Pages that keep their own scroll/session state and are not remembered as a
// place to return to.
const SELF_MANAGED = ['/explore']

export function readTabs() {
  return readJSON(TABS_KEY, { current: '/', last: {} })
}
// What the tabs looked like when the app launched, before this session
// touched them — used to reopen where you left off.
export const launchTabs = readTabs()

// Which tab each history entry belongs to, so going back across tabs credits
// pages to the tab they were opened from. Jumping straight to a remembered
// sub-page never renders the tab root, so those navigations pass
// { state: { tab } } instead.
const ENTRY_TABS_KEY = 'vault.m.entryTabs'
const entryTabs = readJSON(ENTRY_TABS_KEY, {}, true)

export function useTabMemory() {
  const loc = useLocation()
  const [tabs, setTabs] = useState(readTabs)
  useEffect(() => {
    const p = loc.pathname
    if (isFullscreenPath(p) || SELF_MANAGED.includes(p)) return
    setTabs(prev => {
      const current = TAB_ROOTS.includes(p) ? p : (loc.state?.tab || entryTabs[loc.key] || prev.current)
      entryTabs[loc.key] = current
      writeJSON(ENTRY_TABS_KEY, entryTabs, true)
      const next = { current, last: { ...prev.last, [current]: p + loc.search } }
      writeJSON(TABS_KEY, next)
      return next
    })
  }, [loc.key])
  return tabs
}

// ── Scroll memory ────────────────────────────────────────────────────────────
const SCROLL_KEY = 'vault.m.scroll'
const MAX_SCROLL_ENTRIES = 60
const scrollMap = readJSON(SCROLL_KEY, {})
let flushTimer = null
function rememberScroll(path, y) {
  delete scrollMap[path]               // re-insert so the newest stay on trim
  scrollMap[path] = Math.round(y)
  const keys = Object.keys(scrollMap)
  if (keys.length > MAX_SCROLL_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_SCROLL_ENTRIES)) delete scrollMap[k]
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => writeJSON(SCROLL_KEY, scrollMap), 250)
}

// Saves the window scroll per page and puts it back when you return — going
// back, switching to a tab, or reopening the app. New pages start at the top.
// Content often loads in after the route mounts, so the restore keeps trying
// until the page is tall enough (or you touch the screen).
export function useScrollMemory() {
  const loc = useLocation()
  const navType = useNavigationType()
  const path = loc.pathname + loc.search
  const saving = useRef(false)
  const pathRef = useRef(path)
  const prevPath = useRef(null)

  useEffect(() => {
    try { window.history.scrollRestoration = 'manual' } catch {}
    const onScroll = () => { if (saving.current) rememberScroll(pathRef.current, window.scrollY) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    // Stop recording before the old page unmounts — the browser clamps the
    // scroll as the page shrinks and that must not overwrite the saved spot.
    saving.current = false
    pathRef.current = path
    const from = prevPath.current
    prevPath.current = path

    if (isFullscreenPath(loc.pathname) || SELF_MANAGED.includes(loc.pathname)) return

    const restore = from === null || navType === 'POP' || TAB_ROOTS.includes(loc.pathname)
    const target = restore ? (scrollMap[path] || 0) : 0
    // Pages crossfade, so wait until the new page is actually on screen (its
    // wrapper carries data-route) — scrolling earlier would move the outgoing
    // page instead. The give-up clock starts once it has mounted.
    let raf = 0, timer = 0, done = false
    let started = 0
    const stop = () => {
      done = true
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      window.removeEventListener('touchstart', finish)
      window.removeEventListener('wheel', finish)
    }
    function finish() {
      if (done) return
      stop()
      saving.current = true
    }
    const tick = () => {
      if (done) return
      const route = document.querySelector('[data-route]')?.getAttribute('data-route')
      if (route !== loc.pathname) { raf = requestAnimationFrame(tick); return }
      if (!started) started = Date.now()
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.min(target, Math.max(0, max)))
      if (max >= target || Date.now() - started > 8000) finish()
      else raf = requestAnimationFrame(tick)
    }
    window.addEventListener('touchstart', finish, { passive: true })
    window.addEventListener('wheel', finish, { passive: true })
    timer = setTimeout(tick, 0)
    return () => { stop(); saving.current = false }
  }, [path])
}

// After closing a fullscreen viewer, bring the photo you were last on into view
// in the grid you came from. The viewer records it with markViewed().
const VIEWED_KEY = 'vault.m.viewed'
export function markViewed(source, index) {
  writeJSON(VIEWED_KEY, { source, index }, true)
}
export function useRevealViewed(source, ready) {
  useEffect(() => {
    if (!ready) return
    const v = readJSON(VIEWED_KEY, null, true)
    if (!v || v.source !== source) return
    // Let the scroll memory put the grid back first, then adjust if needed.
    const t = setTimeout(() => {
      writeJSON(VIEWED_KEY, null, true)
      const el = document.querySelector(`[data-view-index="${v.index}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.top < 80 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center' })
    }, 260)
    return () => clearTimeout(t)
  }, [source, ready])
}
