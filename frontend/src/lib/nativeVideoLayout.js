// Keep DOM overlays above native video by opening holes only in ancestor
// backgrounds. Backgrounds outside each video retain their theme and imagery.
const active = new Set()
const backgrounds = new Map()
const coveredMedia = new Map()
let frame = 0
let observer = null
let themeDirty = false
let previousLayout = ''

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
}

export function nativeLayout(element) {
  const rect = element.getBoundingClientRect()
  const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform === 'none'
    ? undefined : getComputedStyle(element).transform)
  const zoom = Math.max(1, Math.abs(matrix.a))
  const stage = { x: rect.x + rect.width / 2 - matrix.e - rect.width / zoom / 2,
    y: rect.y + rect.height / 2 - matrix.f - rect.height / zoom / 2,
    width: rect.width / zoom, height: rect.height / zoom }
  let clip = intersect(stage, { x: 0, y: 0, width: innerWidth, height: innerHeight })
  let visible = !document.hidden && element.isConnected
  for (let node = element; node; node = node.parentElement) {
    const css = getComputedStyle(node)
    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) visible = false
    if (node !== element && /(hidden|clip|scroll|auto)/.test(`${css.overflowX} ${css.overflowY}`)) {
      const bounds = node.getBoundingClientRect()
      clip = intersect(clip, bounds)
    }
  }
  return { viewportWidth: innerWidth, stage, clip, zoom, fit: getComputedStyle(element).objectFit,
    panX: matrix.e, panY: matrix.f,
    visible: visible && clip.width > 0 && clip.height > 0 }
}

// Subtract rectangles first: overlapping players must not fill each other's hole.
function cutout(bounds, holes) {
  let pieces = [{ x: 0, y: 0, width: bounds.width, height: bounds.height }]
  for (const hole of holes) {
    const local = { ...hole, x: hole.x - bounds.x, y: hole.y - bounds.y }
    pieces = pieces.flatMap(piece => {
      const cut = intersect(piece, local)
      if (!cut.width || !cut.height) return [piece]
      return [
        { ...piece, height: cut.y - piece.y },
        { ...piece, y: cut.y + cut.height, height: piece.y + piece.height - cut.y - cut.height },
        { x: piece.x, y: cut.y, width: cut.x - piece.x, height: cut.height },
        { x: cut.x + cut.width, y: cut.y, width: piece.x + piece.width - cut.x - cut.width, height: cut.height },
      ].filter(p => p.width > 0 && p.height > 0)
    })
  }
  return `path('${pieces.map(p => `M${p.x},${p.y}h${p.width}v${p.height}h-${p.width}Z`).join(' ') || 'M0,0h0v0Z'}')`
}

const inlineBackground = node => `${node.style.background}|${node.style.backdropFilter}`

// A style change on a hole's ancestor only matters if it touches the background.
// The viewer stage's cursor (grab/grabbing on every drag) and our own
// position: relative must not trigger a full background rebuild.
function backgroundChanged(record) {
  if (record.target === document.documentElement) return true
  const entry = backgrounds.get(record.target)
  if (!entry) return false
  if (record.attributeName !== 'style') return true
  return inlineBackground(record.target) !== entry.inline
}

const isContents = node => getComputedStyle(node).display === 'contents'
function boxParent(node) {
  let parent = node.parentElement
  while (parent && isContents(parent)) parent = parent.parentElement
  return parent
}
function* boxChildren(node) {
  for (const child of node.children) {
    if (isContents(child)) yield* boxChildren(child)
    else yield child
  }
}

function updateBackgrounds(layouts) {
  const needed = new Map()
  for (const [player, layout] of layouts) {
    if (!layout.visible) continue
    for (let node = player.element.parentElement; node; node = node.parentElement) {
      if (!needed.has(node)) needed.set(node, [])
      needed.get(node).push(layout.clip)
    }
  }
  for (const [node, entry] of backgrounds) {
    if (needed.has(node)) continue
    entry.layer.remove()
    node.removeAttribute('data-native-video-background')
    if (entry.relative) node.style.position = entry.position
    backgrounds.delete(node)
  }
  // Every style read after a DOM write recalculates the whole page (the library
  // grid behind a viewer included), so read everything first, then write.
  // Interleaving cost ~0.5–1.5 s per pass on big libraries.
  const fresh = [...needed.keys()].filter(node => !backgrounds.has(node))
  const refresh = themeDirty ? [...needed.keys()].filter(node => backgrounds.has(node)) : []
  for (const node of refresh) node.removeAttribute('data-native-video-background')
  const styles = new Map([...fresh, ...refresh].map(node => {
    const css = getComputedStyle(node)
    return [node, { background: css.background, backdropFilter: css.backdropFilter,
      borderRadius: css.borderRadius, position: css.position }]
  }))
  const measured = new Map([...needed.keys()].map(node => [node,
    { bounds: node.getBoundingClientRect(), scrollLeft: node.scrollLeft, scrollTop: node.scrollTop }]))
  for (const node of refresh) {
    const entry = backgrounds.get(node), css = styles.get(node)
    entry.layer.style.setProperty('background', css.background, 'important')
    entry.layer.style.backdropFilter = css.backdropFilter
    entry.inline = inlineBackground(node)
    node.setAttribute('data-native-video-background', '')
  }
  for (const node of fresh) {
    const css = styles.get(node)
    const layer = document.createElement('div')
    layer.className = 'vault-native-background'
    layer.setAttribute('aria-hidden', 'true')
    layer.style.setProperty('background', css.background, 'important')
    layer.style.borderRadius = css.borderRadius
    layer.style.backdropFilter = css.backdropFilter
    const entry = { layer, relative: css.position === 'static', position: node.style.position,
      inline: inlineBackground(node) }
    if (entry.relative) node.style.position = 'relative'
    node.setAttribute('data-native-video-background', '')
    node.prepend(layer)
    backgrounds.set(node, entry)
  }
  for (const [node, holes] of needed) {
    const entry = backgrounds.get(node)
    const { bounds, scrollLeft, scrollTop } = measured.get(node)
    const transform = `translate(${scrollLeft}px, ${scrollTop}px)`
    if (entry.layer.style.transform !== transform) entry.layer.style.transform = transform
    const path = cutout(bounds, holes)
    if (entry.layer.style.clipPath !== path) entry.layer.style.clipPath = path
  }
  // Native output is beneath the entire WebView. A portal viewer must also
  // cut through the sibling library page, not just its thumbnail images.
  // Walk sibling branches below the player; higher controls/dialogs stay intact.
  // `display: contents` wrappers (every ModalLayer portal) have no box, so a
  // clip-path on them does nothing. Look through them to the real boxes, or a
  // modal stacked under a viewer modal keeps covering the video.
  const neededMedia = new Map()
  for (const [player, layout] of layouts) {
    if (!layout.visible || !player.readyState) continue
    for (let branch = player.element, parent = boxParent(branch); parent; branch = parent, parent = boxParent(parent)) {
      const branchZ = Number.parseInt(getComputedStyle(branch).zIndex) || 0
      for (const sibling of boxChildren(parent)) {
        if (sibling === branch || sibling.contains(branch) || sibling.classList.contains('vault-native-background') ||
            /^(SCRIPT|STYLE|LINK|HEAD)$/.test(sibling.tagName)) continue
        const siblingZ = Number.parseInt(getComputedStyle(sibling).zIndex) || 0
        const preceding = !!(branch.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_PRECEDING)
        if (siblingZ > branchZ || (siblingZ === branchZ && !preceding)) continue
        const bounds = sibling.getBoundingClientRect()
        const overlap = intersect(bounds, layout.clip)
        if (!overlap.width || !overlap.height) continue
        if (!neededMedia.has(sibling)) neededMedia.set(sibling, { bounds, holes: [] })
        neededMedia.get(sibling).holes.push(layout.clip)
      }
    }
  }
  for (const [element, original] of coveredMedia) {
    if (neededMedia.has(element)) continue
    if (original.value) element.style.setProperty('clip-path', original.value, original.priority)
    else element.style.removeProperty('clip-path')
    coveredMedia.delete(element)
  }
  for (const [element, { bounds, holes }] of neededMedia) {
    if (!coveredMedia.has(element)) coveredMedia.set(element, {
      value: element.style.getPropertyValue('clip-path'), priority: element.style.getPropertyPriority('clip-path'),
    })
    const path = cutout(bounds, holes)
    if (element.style.clipPath !== path) element.style.setProperty('clip-path', path, 'important')
  }

}

// Measuring every player and its ancestors on every animation frame kept the
// page busy (~13% main thread, ~165 style recalcs/s) for the whole video, and
// the transparent page is re-blended over each video frame. Instead, measure
// only when something can move a video, frame by frame for a short burst so
// transitions and drags still track exactly, plus a slow safety heartbeat.
const BURST_MS = 450
const HEARTBEAT_MS = 500
let burstUntil = 0
let heartbeat = 0
let resizeObserver = null
const listeners = []

function schedule(ms = BURST_MS) {
  burstUntil = Math.max(burstUntil, performance.now() + ms)
  if (!frame && active.size) frame = requestAnimationFrame(tick)
}

function touchesPlayer(node) {
  if (!(node instanceof Element)) return false
  for (const player of active) if (node === player.element || node.contains(player.element)) return true
  return false
}

function watch() {
  const on = (target, type, handler, options) => { target.addEventListener(type, handler, options); listeners.push([target, type, handler, options]) }
  const burst = () => schedule()
  const longBurst = () => schedule(900)
  on(window, 'resize', burst)
  on(document, 'scroll', burst, { capture: true, passive: true })
  on(document, 'fullscreenchange', longBurst)
  on(document, 'visibilitychange', burst)
  on(document, 'transitionrun', longBurst, true)
  on(document, 'animationstart', longBurst, true)
  on(document, 'transitionend', burst, true)
  on(document, 'animationend', burst, true)
  resizeObserver = new ResizeObserver(burst)
  resizeObserver.observe(document.documentElement)
  for (const player of active) resizeObserver.observe(player.element)
  heartbeat = setInterval(() => schedule(0), HEARTBEAT_MS)
}

function unwatch() {
  for (const [target, type, handler, options] of listeners.splice(0)) target.removeEventListener(type, handler, options)
  resizeObserver?.disconnect(); resizeObserver = null
  clearInterval(heartbeat); heartbeat = 0
}

function tick() {
  frame = 0
  const layouts = new Map()
  for (const player of active) {
    const layout = player.layout()
    layouts.set(player, layout)
    const key = JSON.stringify(layout)
    if (key !== player.layoutKey) { player.layoutKey = key; player.updateLayout() }
  }
  // Zoom/pan changes only the native surface. Rebuild background holes when
  // their screen bounds change, so dragging does not walk the whole image grid.
  const key = JSON.stringify([...layouts].map(([player, layout]) => [player.session, player.readyState,
    layout.visible, Object.values(layout.clip).map(value => Math.round(value * 100) / 100)]))
  if (key !== previousLayout || themeDirty) {
    previousLayout = key
    updateBackgrounds(layouts)
    themeDirty = false
  }
  if (active.size && performance.now() < burstUntil) frame = requestAnimationFrame(tick)
}

export function startNativeLayout(player) {
  active.add(player)
  if (!observer) {
    observer = new MutationObserver(records => {
      if (records.some(backgroundChanged)) themeDirty = true
      // Zoom/pan (the player's transform) and any class/style change on a
      // container can move or hide a video. Unrelated updates, such as the
      // seek bar's width, do not touch a player and are ignored.
      if (themeDirty || records.some(record => touchesPlayer(record.target))) schedule()
    })
    observer.observe(document.documentElement, { subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'data-theme', 'data-theme-pack-ui', 'data-theme-pack-panel', 'data-theme-pack-button', 'data-theme-pack-sidebar'] })
    watch()
  } else {
    resizeObserver?.observe(player.element)
  }
  schedule()
  return () => {
    active.delete(player)
    resizeObserver?.unobserve(player.element)
    player.layoutKey = null
    if (!active.size) {
      cancelAnimationFrame(frame); frame = 0; previousLayout = ''; burstUntil = 0
      observer?.disconnect(); observer = null
      unwatch()
      updateBackgrounds(new Map())
    }
  }
}

// For callers that move a player programmatically (e.g. NativeMedia when the
// video's size becomes known).
export function scheduleNativeLayout() { schedule() }
