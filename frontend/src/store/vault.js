import { create } from 'zustand'
import { gamiApi } from '../lib/api'

// ── IndexedDB helpers (no size limit — used for glass background image) ────
const IDB_DB = 'vault_ui'
const IDB_STORE = 'blobs'

function _idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE)
    req.onsuccess = e => res(e.target.result)
    req.onerror = rej
  })
}
async function idbPut(key, value) {
  const db = await _idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = res; tx.onerror = rej
  })
}
async function idbGet(key) {
  const db = await _idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror = rej
  })
}
async function idbDelete(key) {
  const db = await _idbOpen()
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = res; tx.onerror = rej
  })
}

// ── Color themes ───────────────────────────────────────────────────────────────
export const PALETTES = [
  {
    id: 'vault',    label: 'Vault',
    accent: '#7F77DD', pink: '#D4537E', amber: '#BA7517', green: '#1D9E75',
    bg: '#0e0e0e', surface: '#141414', card: '#1e1e1e',
  },
  {
    id: 'abyss',   label: 'Abyss',
    accent: '#6B6FE8', pink: '#CC55A8', amber: '#AA7012', green: '#1A8E6A',
    bg: '#080810', surface: '#0d0d1a', card: '#14142a',
  },
  {
    id: 'crimson', label: 'Crimson',
    accent: '#C45370', pink: '#E06090', amber: '#BA6A17', green: '#1DA87A',
    bg: '#0d0808', surface: '#160f0f', card: '#201516',
  },
  {
    id: 'ocean',   label: 'Ocean',
    accent: '#4A9ED9', pink: '#5B7FD4', amber: '#3D9EAA', green: '#2DA87A',
    bg: '#070c12', surface: '#0c1318', card: '#121c24',
  },
  {
    id: 'emerald', label: 'Emerald',
    accent: '#2DB87C', pink: '#CC5F88', amber: '#B88630', green: '#35D490',
    bg: '#060d09', surface: '#0a1410', card: '#111d15',
  },
  {
    id: 'sakura',  label: 'Sakura',
    accent: '#C45FD4', pink: '#E054A0', amber: '#C4703A', green: '#4AAA78',
    bg: '#0e080d', surface: '#160f15', card: '#1e141d',
  },
  {
    id: 'gold',    label: 'Gold',
    accent: '#C4A043', pink: '#D46B70', amber: '#E09D30', green: '#48BA8A',
    bg: '#0c0c0a', surface: '#141310', card: '#1e1c14',
  },
  {
    id: 'neon',    label: 'Neon',
    accent: '#00F5D4', pink: '#F72585', amber: '#F5A623', green: '#00F5D4',
    bg: '#020202', surface: '#080808', card: '#0f0f0f',
  },
  {
    id: 'sunset',  label: 'Sunset',
    accent: '#FF6B35', pink: '#F7244F', amber: '#FFAA00', green: '#06D6A0',
    bg: '#0d0805', surface: '#160e08', card: '#1e1410',
  },
  {
    id: 'rose',    label: 'Rose',
    accent: '#FF85A1', pink: '#FF4D6D', amber: '#FFAD60', green: '#52B788',
    bg: '#0d080a', surface: '#160d10', card: '#1e1318',
  },
  {
    id: 'matrix',  label: 'Matrix',
    accent: '#00FF41', pink: '#00CC33', amber: '#00FF41', green: '#00FF41',
    bg: '#000300', surface: '#020a02', card: '#041204',
  },
  {
    id: 'dracula', label: 'Dracula',
    accent: '#BD93F9', pink: '#FF79C6', amber: '#FFB86C', green: '#50FA7B',
    bg: '#0d0d14', surface: '#12121c', card: '#191928',
  },
  {
    id: 'cyberpunk', label: 'Cyberpunk',
    accent: '#FF00CC', pink: '#FF0077', amber: '#FFE000', green: '#00FF9F',
    bg: '#030005', surface: '#060010', card: '#0C0018',
  },
  {
    id: 'cyber-gold', label: 'Cyber Gold',
    accent: '#FFE600', pink: '#FF4F8B', amber: '#FFE600', green: '#00FFCC',
    bg: '#030300', surface: '#060600', card: '#0C0C00',
  },
  {
    id: 'glass', label: 'Glass',
    accent: '#A0B4D0', pink: '#C4A0B4', amber: '#C4B890', green: '#90C4B0',
    bg: '#1c1c1e', surface: 'rgba(0,0,0,0.55)', card: 'rgba(0,0,0,0.45)',
  },
]

function applyPalette(p) {
  const r = document.documentElement
  r.style.setProperty('--accent',   p.accent)
  r.style.setProperty('--c-accent', p.accent)
  r.style.setProperty('--c-pink',   p.pink)
  r.style.setProperty('--c-amber',  p.amber)
  r.style.setProperty('--c-green',  p.green)
  r.style.setProperty('--c-surface',p.surface)
  r.style.setProperty('--c-card',   p.card)
  if (p.id === 'glass') {
    r.style.setProperty('--c-bg', 'transparent')
    document.body.style.background = '#1c1c1e'  // dark gray default; overridden async by loadGlassBackground()
  } else {
    r.style.setProperty('--c-bg', p.bg)
    document.body.style.background = p.bg
  }
  document.body.setAttribute('data-theme', p.id)
}

// ── Fonts ──────────────────────────────────────────────────────────────────────
export const FONTS = [
  { id: 'system',   label: 'System',    family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: 'mono',     label: 'Terminal',  family: "'Consolas', 'Courier New', monospace" },
  { id: 'serif',    label: 'Editorial', family: "Georgia, 'Times New Roman', serif" },
  { id: 'comic',    label: 'Comic Sans',family: "'Comic Sans MS', 'Comic Sans', cursive" },
  { id: 'rounded',  label: 'Rounded',   family: "'Nunito', system-ui, sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap' },
]

function applyFont(f) {
  if (f.googleFont && !document.getElementById(`gf-${f.id}`)) {
    const link = document.createElement('link')
    link.id   = `gf-${f.id}`
    link.rel  = 'stylesheet'
    link.href = f.googleFont
    document.head.appendChild(link)
  }
  document.documentElement.style.setProperty('--vault-font', f.family)
  document.body.style.fontFamily = f.family
}

// ── Animation speed ────────────────────────────────────────────────────────────
const ANIM_STYLE_ID = 'vault-anim-override'

function applyAnimSpeed(speed) {
  let el = document.getElementById(ANIM_STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = ANIM_STYLE_ID
    document.head.appendChild(el)
  }
  if (speed === 'off') {
    el.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
  } else if (speed === 'reduced') {
    el.textContent = '*, *::before, *::after { transition-duration: 0.08s !important; animation-duration: 0.15s !important; }'
  } else {
    el.textContent = ''
  }
}

const savedPaletteId = localStorage.getItem('vault_palette') || 'vault'
const initialPalette = PALETTES.find(p => p.id === savedPaletteId) || PALETTES[0]

const savedFontId      = localStorage.getItem('vault_font') || 'system'
const initialFont      = FONTS.find(f => f.id === savedFontId) || FONTS[0]
const savedAnimSpeed   = localStorage.getItem('vault_anim_speed') || 'full'
const savedVaultName   = localStorage.getItem('vault_name') || 'The Vault'
const savedConfetti    = localStorage.getItem('vault_confetti') !== 'false'
const savedSessionGlow   = localStorage.getItem('vault_session_glow') || 'var(--c-pink)'
function applyGlassBackground(dataUrl) {
  if (dataUrl) {
    document.body.style.background = `url("${dataUrl}") center/cover no-repeat fixed`
  } else {
    document.body.style.background = '#1c1c1e'
  }
}

// Called from Layout on mount — async IDB read, no size limit
export async function loadGlassBackground() {
  const hasCustom = localStorage.getItem('vault_glass_bg') === '1'
  if (!hasCustom) return
  try {
    const dataUrl = await idbGet('glass_bg')
    if (dataUrl) applyGlassBackground(dataUrl)
  } catch (e) {
    console.warn('Could not load glass background from IDB', e)
  }
}


function applySessionGlow(color) {
  document.documentElement.style.setProperty('--session-glow', color)
}

// ── Synchronous startup application ───────────────────────────────────────────
// Apply stored theme settings immediately at module-load time so there is no
// flash of the default Inter font / default palette before the Layout useEffect
// fires.  The Layout useEffect still calls applyStoredPalette() as a safe
// secondary pass, but this handles the visible first paint.
applyPalette(initialPalette)
applyFont(initialFont)
applyAnimSpeed(savedAnimSpeed)
applySessionGlow(savedSessionGlow)

export const useVaultStore = create((set, get) => ({
  // Profile
  profile: null,
  setProfile: (p) => set({ profile: p }),

  // XP toast queue
  xpToasts: [],
  addXpToast: (msg) => {
    const id = Date.now() + Math.random()
    set(s => ({ xpToasts: [...s.xpToasts, { id, msg, type: 'xp' }] }))
    setTimeout(() => set(s => ({ xpToasts: s.xpToasts.filter(t => t.id !== id) })), 4500)
  },

  // Credits toast queue (amber)
  addCreditToast: (msg) => {
    const id = Date.now() + Math.random()
    set(s => ({ xpToasts: [...s.xpToasts, { id, msg, type: 'credits' }] }))
    setTimeout(() => set(s => ({ xpToasts: s.xpToasts.filter(t => t.id !== id) })), 4500)
  },

  // Pack reward banner — shown when daily/weekly completion bonus fires
  addPackToast: (packType, quantity) => {
    const id = Date.now() + Math.random()
    set(s => ({ xpToasts: [...s.xpToasts, { id, packType, quantity, type: 'pack' }] }))
    setTimeout(() => set(s => ({ xpToasts: s.xpToasts.filter(t => t.id !== id) })), 6000)
  },

  // Level-up cinematic overlay
  levelUpData: null,   // { level, title } or null
  triggerLevelUp: (level, title) => set({ levelUpData: { level, title } }),
  dismissLevelUp: () => set({ levelUpData: null }),

  // Active image viewer
  viewerGalleryId: null,
  viewerImageIdx: 0,
  openViewer: (galleryId, idx = 0) => set({ viewerGalleryId: galleryId, viewerImageIdx: idx }),
  closeViewer: () => set({ viewerGalleryId: null, viewerImageIdx: 0 }),

  // Multi-panel state
  panels: [
    { id: 1, sourceType: 'gallery', sourceId: null, name: 'Panel 1', interval: 8, playing: true },
    { id: 2, sourceType: 'gallery', sourceId: null, name: 'Panel 2', interval: 5, playing: true },
    { id: 3, sourceType: 'gallery', sourceId: null, name: 'Panel 3', interval: 12, playing: true },
  ],
  panelCount: 3,
  setPanelCount: (n) => set({ panelCount: n }),
  updatePanel: (id, data) => set(s => ({
    panels: s.panels.map(p => p.id === id ? { ...p, ...data } : p)
  })),

  // Multi-viewer queue — files or galleries queued for the multi-panel viewer
  // Item format: { id: string (e.g. 'img-1' or 'gal-1'), type: 'image'|'gallery', media: Object, images?: Array }
  MULTIVIEWER_MAX: 20,
  multiViewerQueue: [],
  addToMultiViewer: (item) => {
    const s = get()
    if (s.multiViewerQueue.length >= s.MULTIVIEWER_MAX) return false  // at capacity
    if (s.multiViewerQueue.some(q => q.id === item.id)) return false  // already queued
    set(st => ({ multiViewerQueue: [...st.multiViewerQueue, item] }))
    return true
  },
  removeFromMultiViewer: (id) =>
    set(s => ({ multiViewerQueue: s.multiViewerQueue.filter(q => q.id !== id) })),
  clearMultiViewer: () => set({ multiViewerQueue: [] }),
  reorderMultiViewer: (from, to) => set(s => {
    const q = [...s.multiViewerQueue]
    const [moved] = q.splice(from, 1)
    q.splice(to, 0, moved)
    return { multiViewerQueue: q }
  }),

  // Scan status
  scanRunning: false,
  setScanRunning: (v) => set({ scanRunning: v }),

  // Theme accent (legacy single-color — now palette-driven)
  accentColor: initialPalette.accent,
  setAccentColor: (c) => {
    set({ accentColor: c })
    document.documentElement.style.setProperty('--accent', c)
    document.documentElement.style.setProperty('--c-accent', c)
  },

  // UI scale — applied as CSS zoom on the whole page
  uiScale: parseFloat(localStorage.getItem('vault_ui_scale') || '1'),
  setUiScale: (v) => {
    const clamped = Math.round(Math.max(0.7, Math.min(1.4, v)) * 100) / 100
    localStorage.setItem('vault_ui_scale', String(clamped))
    document.documentElement.style.zoom = clamped
    set({ uiScale: clamped })
  },

  // Color palette
  palette: initialPalette,
  setPalette: (p) => {
    localStorage.setItem('vault_palette', p.id)
    applyPalette(p)
    set({ palette: p, accentColor: p.accent })
    gamiApi.updateProfile({ theme_accent: p.accent }).catch(() => {})
  },
  applyStoredPalette: () => {
    applyPalette(initialPalette)
    applyFont(initialFont)
    applyAnimSpeed(savedAnimSpeed)
    applySessionGlow(savedSessionGlow)
    // glass background is loaded async in Layout via loadGlassBackground()
  },

  // Font
  font: initialFont,
  setFont: (f) => {
    localStorage.setItem('vault_font', f.id)
    applyFont(f)
    set({ font: f })
  },

  // Animation speed
  animSpeed: savedAnimSpeed,
  setAnimSpeed: (s) => {
    localStorage.setItem('vault_anim_speed', s)
    applyAnimSpeed(s)
    set({ animSpeed: s })
  },

  // Custom vault name
  vaultName: savedVaultName,
  setVaultName: (n) => {
    const v = n.trim() || 'The Vault'
    localStorage.setItem('vault_name', v)
    set({ vaultName: v })
  },

  // Confetti on level-up / achievement
  confettiEnabled: savedConfetti,
  setConfettiEnabled: (v) => {
    localStorage.setItem('vault_confetti', String(v))
    set({ confettiEnabled: v })
  },

  // Session border glow color
  sessionGlowColor: savedSessionGlow,
  setSessionGlowColor: (c) => {
    localStorage.setItem('vault_session_glow', c)
    applySessionGlow(c)
    set({ sessionGlowColor: c })
  },

  // Glass theme background — true = user has a custom image stored in IDB
  glassBackground: localStorage.getItem('vault_glass_bg') === '1',
  setGlassBackground: async (dataUrl) => {
    if (dataUrl) {
      await idbPut('glass_bg', dataUrl)
      localStorage.setItem('vault_glass_bg', '1')
      applyGlassBackground(dataUrl)
      set({ glassBackground: true })
    } else {
      await idbDelete('glass_bg')
      localStorage.removeItem('vault_glass_bg')
      applyGlassBackground('')
      set({ glassBackground: false })
    }
  },

  // Global avatar cache-bust counter — increment after any avatar change
  avatarBust: 1,
  bumpAvatarBust: () => set(s => ({ avatarBust: s.avatarBust + 1 })),

  // Multi-panel fullscreen — hides the sidebar in Layout
  multiPanelFullscreen: false,
  setMultiPanelFullscreen: (v) => set({ multiPanelFullscreen: v }),

  // ── Companion (Erika AI) ─────────────────────────────────────────────────────
  companion: {
    open:    false,
    enabled: false,
    config:  null,
  },
  setCompanionOpen:    (v) => set(s => ({ companion: { ...s.companion, open: v } })),
  setCompanionEnabled: (v) => set(s => ({ companion: { ...s.companion, enabled: v } })),
  setCompanionConfig:  (v) => set(s => ({ companion: { ...s.companion, config: v, enabled: v?.enabled ?? false } })),

  // ── Goon session mode ────────────────────────────────────────────────────────
  // sessionActive + sessionStartAt are persisted so a browser switch or refresh
  // doesn't kill an in-progress session.
  sessionActive:  localStorage.getItem('vault_session_active') === 'true',
  sessionStartAt: parseInt(localStorage.getItem('vault_session_start_at') || '0', 10) || null,
  // Accumulated ms across all past sessions (persisted in localStorage)
  sessionTotalMs: parseInt(localStorage.getItem('vault_session_total_ms') || '0', 10),
  // Whether to show the neon border during a session
  showGoonBorder: localStorage.getItem('vault_goon_border') !== 'false',

  startSession: () => {
    const now = Date.now()
    localStorage.setItem('vault_session_active',   'true')
    localStorage.setItem('vault_session_start_at', String(now))
    set({ sessionActive: true, sessionStartAt: now })
  },

  endSession: () => {
    const s = get()
    if (!s.sessionActive) return
    const elapsed = s.sessionStartAt ? Date.now() - s.sessionStartAt : 0
    const newTotal = s.sessionTotalMs + elapsed
    localStorage.setItem('vault_session_total_ms', String(newTotal))
    localStorage.removeItem('vault_session_active')
    localStorage.removeItem('vault_session_start_at')
    set({ sessionActive: false, sessionStartAt: null, sessionTotalMs: newTotal })
    return elapsed
  },

  setShowGoonBorder: (v) => {
    localStorage.setItem('vault_goon_border', String(v))
    set({ showGoonBorder: v })
  },

  // ── Persistent UI preferences ─────────────────────────────────────────────
  // Thumb sizes per view — survive navigation
  thumbSizeGalleries: parseInt(localStorage.getItem('vault_thumb_galleries') || '180', 10),
  thumbSizeImages:    parseInt(localStorage.getItem('vault_thumb_images')    || '150', 10),
  thumbSizeVideos:    parseInt(localStorage.getItem('vault_thumb_videos')    || '150', 10),

  setThumbSizeGalleries: (v) => { localStorage.setItem('vault_thumb_galleries', String(v)); set({ thumbSizeGalleries: v }) },
  setThumbSizeImages:    (v) => { localStorage.setItem('vault_thumb_images',    String(v)); set({ thumbSizeImages: v }) },
  setThumbSizeVideos:    (v) => { localStorage.setItem('vault_thumb_videos',    String(v)); set({ thumbSizeVideos: v }) },

  // ── UI language (i18n) — English default, persisted across launches ─────────
  locale: localStorage.getItem('vault_locale') || 'en',
  setLocale: (v) => { localStorage.setItem('vault_locale', v); set({ locale: v }) },
}))
