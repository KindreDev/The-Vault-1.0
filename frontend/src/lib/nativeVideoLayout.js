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
  for (const [node, holes] of needed) {
    let entry = backgrounds.get(node)
    if (!entry) {
      const css = getComputedStyle(node)
      const layer = document.createElement('div')
      layer.className = 'vault-native-background'
      layer.setAttribute('aria-hidden', 'true')
      layer.style.setProperty('background', css.background, 'important')
      layer.style.borderRadius = css.borderRadius
      layer.style.backdropFilter = css.backdropFilter
      entry = { layer, relative: css.position === 'static', position: node.style.position }
      if (entry.relative) node.style.position = 'relative'
      node.setAttribute('data-native-video-background', '')
      node.prepend(layer)
      backgrounds.set(node, entry)
    }
    const bounds = node.getBoundingClientRect()
    const transform = `translate(${node.scrollLeft}px, ${node.scrollTop}px)`
    if (entry.layer.style.transform !== transform) entry.layer.style.transform = transform
    if (themeDirty) {
      node.removeAttribute('data-native-video-background')
      const css = getComputedStyle(node)
      entry.layer.style.setProperty('background', css.background, 'important')
      entry.layer.style.backdropFilter = css.backdropFilter
      node.setAttribute('data-native-video-background', '')
    }
    const path = cutout(bounds, holes)
    if (entry.layer.style.clipPath !== path) entry.layer.style.clipPath = path
  }
  // Native output is beneath the entire WebView. A portal viewer must also
  // cut through the sibling library page, not just its thumbnail images.
  // Walk sibling branches below the player; higher controls/dialogs stay intact.
  const neededMedia = new Map()
  for (const [player, layout] of layouts) {
    if (!layout.visible || !player.readyState) continue
    for (let branch = player.element; branch.parentElement; branch = branch.parentElement) {
      const branchZ = Number.parseInt(getComputedStyle(branch).zIndex) || 0
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || sibling.classList.contains('vault-native-background') ||
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
  if (active.size) frame = requestAnimationFrame(tick)
}

export function startNativeLayout(player) {
  active.add(player)
  if (!observer) {
    observer = new MutationObserver(records => {
      if (records.some(record => backgrounds.has(record.target) || record.target === document.documentElement)) themeDirty = true
    })
    observer.observe(document.documentElement, { subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'data-theme', 'data-theme-pack-ui', 'data-theme-pack-panel', 'data-theme-pack-button', 'data-theme-pack-sidebar'] })
  }
  if (!frame) frame = requestAnimationFrame(tick)
  return () => {
    active.delete(player)
    player.layoutKey = null
    if (!active.size) {
      cancelAnimationFrame(frame); frame = 0; previousLayout = ''
      observer?.disconnect(); observer = null
      updateBackgrounds(new Map())
    }
  }
}
