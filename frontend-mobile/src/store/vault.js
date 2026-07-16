import { create } from 'zustand'

// ── Color palettes (mirrors the desktop set) ─────────────────────────────────
export const PALETTES = [
  { id: 'vault',     label: 'Vault',     accent: '#7F77DD', pink: '#D4537E', amber: '#BA7517', green: '#1D9E75', bg: '#0e0e0e', surface: '#141414', card: '#1e1e1e' },
  { id: 'abyss',     label: 'Abyss',     accent: '#6B6FE8', pink: '#CC55A8', amber: '#AA7012', green: '#1A8E6A', bg: '#080810', surface: '#0d0d1a', card: '#14142a' },
  { id: 'crimson',   label: 'Crimson',   accent: '#C45370', pink: '#E06090', amber: '#BA6A17', green: '#1DA87A', bg: '#0d0808', surface: '#160f0f', card: '#201516' },
  { id: 'ocean',     label: 'Ocean',     accent: '#4A9ED9', pink: '#5B7FD4', amber: '#3D9EAA', green: '#2DA87A', bg: '#070c12', surface: '#0c1318', card: '#121c24' },
  { id: 'emerald',   label: 'Emerald',   accent: '#2DB87C', pink: '#CC5F88', amber: '#B88630', green: '#35D490', bg: '#060d09', surface: '#0a1410', card: '#111d15' },
  { id: 'sakura',    label: 'Sakura',    accent: '#C45FD4', pink: '#E054A0', amber: '#C4703A', green: '#4AAA78', bg: '#0e080d', surface: '#160f15', card: '#1e141d' },
  { id: 'gold',      label: 'Gold',      accent: '#C4A043', pink: '#D46B70', amber: '#E09D30', green: '#48BA8A', bg: '#0c0c0a', surface: '#141310', card: '#1e1c14' },
  { id: 'neon',      label: 'Neon',      accent: '#00F5D4', pink: '#F72585', amber: '#F5A623', green: '#00F5D4', bg: '#020202', surface: '#080808', card: '#0f0f0f' },
  { id: 'sunset',    label: 'Sunset',    accent: '#FF6B35', pink: '#F7244F', amber: '#FFAA00', green: '#06D6A0', bg: '#0d0805', surface: '#160e08', card: '#1e1410' },
  { id: 'rose',      label: 'Rose',      accent: '#FF85A1', pink: '#FF4D6D', amber: '#FFAD60', green: '#52B788', bg: '#0d080a', surface: '#160d10', card: '#1e1318' },
  { id: 'matrix',    label: 'Matrix',    accent: '#00FF41', pink: '#00CC33', amber: '#00FF41', green: '#00FF41', bg: '#000300', surface: '#020a02', card: '#041204' },
  { id: 'dracula',   label: 'Dracula',   accent: '#BD93F9', pink: '#FF79C6', amber: '#FFB86C', green: '#50FA7B', bg: '#0d0d14', surface: '#12121c', card: '#191928' },
  { id: 'cyberpunk', label: 'Cyberpunk', accent: '#FF00CC', pink: '#FF0077', amber: '#FFE000', green: '#00FF9F', bg: '#030005', surface: '#060010', card: '#0C0018' },
]

export function applyPalette(p) {
  const r = document.documentElement
  r.style.setProperty('--accent',    p.accent)
  r.style.setProperty('--c-pink',    p.pink)
  r.style.setProperty('--c-amber',   p.amber)
  r.style.setProperty('--c-green',   p.green)
  r.style.setProperty('--c-bg',      p.bg)
  r.style.setProperty('--c-surface', p.surface)
  r.style.setProperty('--c-card',    p.card)
  document.body.style.background = p.bg
}

const savedPaletteId = localStorage.getItem('vault_m_palette') || 'vault'
const initialPalette = PALETTES.find(p => p.id === savedPaletteId) || PALETTES[0]
applyPalette(initialPalette)

export const useVaultStore = create((set, get) => ({
  profile: null,
  setProfile: (p) => set({ profile: p }),

  // Toast queue (XP / credits / info)
  toasts: [],
  addToast: (msg, type = 'info') => {
    const id = Date.now() + Math.random()
    set(s => ({ toasts: [...s.toasts, { id, msg, type }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3500)
  },

  palette: initialPalette,
  setPalette: (p) => {
    localStorage.setItem('vault_m_palette', p.id)
    applyPalette(p)
    set({ palette: p })
  },

  // Global "add to playlist" picker. Any long-press hands a list of image ids
  // here; <PlaylistPicker/> mounted in App reads it and shows the sheet.
  playlistTarget: null, // null | number[]
  openPlaylistPicker: (imageIds) => set({ playlistTarget: imageIds }),
  closePlaylistPicker: () => set({ playlistTarget: null }),

  // Floating companion chat bubble
  chatOpen: false,
  setChatOpen: (v) => set({ chatOpen: v }),
  chatConfigBust: 0,
  bumpChatConfig: () => set(s => ({ chatConfigBust: s.chatConfigBust + 1 })),
}))
