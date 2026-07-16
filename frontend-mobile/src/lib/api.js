import axios from 'axios'
import queryClient from './queryClient.js'
import { getServerBase, abs } from './server.js'
import { useVaultStore } from '../store/vault.js'

// Absolute base URL — points at the user's PC. Rebuilt when the server changes.
const api = axios.create({ baseURL: getServerBase() + '/api', timeout: 30000 })

export function refreshApiBase() {
  api.defaults.baseURL = getServerBase() + '/api'
}

// Live XP / Credits feedback — mirrors the desktop interceptor but only drives
// the lightweight mobile toast queue.
api.interceptors.response.use(res => {
  try {
    const d = res.data
    if (!d || typeof d !== 'object') return res

    const xpEvt = (d.total_xp !== undefined && d.level_up !== undefined) ? d
                : (d.xp_event?.total_xp !== undefined)                    ? d.xp_event
                : (d.xp?.total_xp !== undefined)                          ? d.xp
                : null

    if (xpEvt) {
      queryClient.setQueryData(['profile'], old =>
        old ? { ...old, total_xp: xpEvt.total_xp, level: xpEvt.level,
                level_title: xpEvt.title || old.level_title } : old)
      if (xpEvt.amount > 0) {
        const mult = xpEvt.multiplier > 1 ? ` ×${xpEvt.multiplier.toFixed(1)}` : ''
        useVaultStore.getState().addToast(`+${xpEvt.amount} XP${mult}`, 'xp')
      }
      if (xpEvt.credits_earned > 0)
        useVaultStore.getState().addToast(`+${xpEvt.credits_earned} Credits`, 'credits')
    } else if (d.xp_earned !== undefined) {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    }
  } catch (_) {}
  return res
})

// ── Galleries ───────────────────────────────────────────────────────────────
export const galleriesApi = {
  list:    (params)        => api.get('/galleries/', { params }),
  get:     (id)            => api.get(`/galleries/${id}`),
  images:  (id, params)    => api.get(`/galleries/${id}/images`, { params }),
  recent:  (n = 12)        => api.get('/galleries/recent', { params: { limit: n } }),
  random:  ()              => api.get('/galleries/random'),
  randomPicks: (n = 12)    => api.get('/galleries/', { params: { sort_by: 'random', limit: n } }),
  stats:   ()              => api.get('/galleries/stats'),
  cum:     (id)            => api.post(`/galleries/${id}/cum`),
  view:    (id)            => api.post(`/galleries/${id}/view`),
  rate:    (id, rating)    => api.post(`/galleries/${id}/rate`, null, { params: { rating } }),
  delete:        (id, delete_files) => api.delete(`/galleries/${id}`, { params: { delete_files } }),
  addCreator:    (id, creatorId)    => api.post(`/galleries/${id}/creators/${creatorId}`),
  removeCreator: (id, creatorId)    => api.delete(`/galleries/${id}/creators/${creatorId}`),
  bulkAssign:    (galleryIds, creatorId) => api.post('/galleries/bulk-assign', { gallery_ids: galleryIds, creator_id: creatorId }),
  renameFolder:  (id, folderName)   => api.post(`/galleries/${id}/rename-folder`, { folder_name: folderName }),
  extract:       (id, imageIds, folderName) => api.post(`/galleries/${id}/extract`, { image_ids: imageIds, new_folder_name: folderName }),
}

// ── Creators ────────────────────────────────────────────────────────────────
export const creatorsApi = {
  list:      (params) => api.get('/creators/', { params }),
  update:    (id, d)  => api.patch(`/creators/${id}`, d),
  get:       (id)     => api.get(`/creators/${id}`),
  favorites: ()       => api.get('/creators/favorites'),
  franchises:()       => api.get('/creators/franchises'),
  topImages: (id, n)  => api.get(`/creators/${id}/top-images`, { params: { limit: n } }),
  giftHeart: (id)     => api.post(`/creators/${id}/gift-heart`),
  randomPicks:(n = 8) => api.get('/creators/', { params: { sort_by: 'random', limit: n } }),
}

// ── Images ──────────────────────────────────────────────────────────────────
export const imagesApi = {
  list:        (params) => api.get('/images/', { params }),
  get:         (id)     => api.get(`/images/${id}`),
  view:        (id)     => api.post(`/images/${id}/view`),
  cum:         (id, d)  => api.post(`/images/${id}/cum`, d || {}),
  rate:        (id, rating) => api.patch(`/images/${id}`, { rating }),
  favorite:    (id, v)  => api.patch(`/images/${id}`, { is_favorite: v }),
  random:      (tag)    => api.get('/images/random/pick', { params: { tag } }),
  randomPicks: (n = 8)  => api.get('/images/', { params: { sort_by: 'random', limit: n, is_video: false } }),
  randomVideos:(n = 8)  => api.get('/images/', { params: { sort_by: 'random', limit: n, is_video: true } }),
}

// ── Sessions ────────────────────────────────────────────────────────────────
export const sessionsApi = {
  log:  (d) => api.post('/sessions/', d),
  list: (p) => api.get('/sessions/', { params: p }),
  stats:()  => api.get('/sessions/stats'),
}

// ── Gamification ────────────────────────────────────────────────────────────
export const gamiApi = {
  profile:       () => api.get('/gamification/profile'),
  login:         () => api.post('/gamification/login'),
  quests:        () => api.get('/gamification/quests'),
  achievements:  () => api.get('/gamification/achievements'),
  updateProfile: (d) => api.patch('/gamification/profile', d),
  avatarUrl:     (bust) => abs(`/api/gamification/profile/avatar?v=${bust || 0}`),
  uploadAvatar:  (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/gamification/profile/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

// ── Playlists ───────────────────────────────────────────────────────────────
export const playlistsApi = {
  list:        ()       => api.get('/playlists/'),
  create:      (d)      => api.post('/playlists/', d),
  detail:      (id)     => api.get(`/playlists/${id}/detail`),
  delete:      (id)     => api.delete(`/playlists/${id}`),
  addImage:    (id, im) => api.post(`/playlists/${id}/images/${im}`),
  removeImage: (id, im) => api.delete(`/playlists/${id}/images/${im}`),
}

// ── Tags ────────────────────────────────────────────────────────────────────
export const tagsApi = {
  list:       (cat) => api.get('/tags/', { params: cat ? { category: cat } : {} }),
  categories: ()    => api.get('/tags/categories'),
}

// ── Cards (view-only on mobile) ─────────────────────────────────────────────
export const cardsApi = {
  inventory:          (params) => api.get('/cards/inventory', { params }),
  get:                (id)     => api.get(`/cards/${id}`),
  rarityDistribution: ()       => api.get('/cards/rarity-distribution'),
}

// ── Scanner (trigger scan from Settings) ────────────────────────────────────
export const scannerApi = {
  roots:  ()   => api.get('/scanner/roots'),
  scan:   (id) => api.post('/scanner/scan', null, { params: id ? { root_id: id } : {} }),
  status: ()   => api.get('/scanner/status'),
  cancel: ()   => api.post('/scanner/cancel'),
}

// ── System (restart / version / health) ─────────────────────────────────────
export const systemApi = {
  // Use the always-present /api/health (defined directly in main.py) rather than
  // the newer /api/system/health, so we also connect to older desktop builds.
  // Short timeout so a wrong/unreachable address fails fast and re-prompts.
  health:     () => api.get('/health', { timeout: 6000 }),
  restart:    () => api.post('/system/restart'),
  getVersion: () => api.get('/system/version'),
}

// ── Feed / Explore (VaultGram social) ───────────────────────────────────────
export const feedApi = {
  list:      (params) => api.get('/feed/', { params }),
  generate:  ()       => api.post('/feed/generate'),
  like:      (id)     => api.post(`/feed/${id}/like`),
  profile:   (id)     => api.get(`/feed/profile/${id}`),
  stories:   ()       => api.get('/feed/stories'),
  storySeen: (id)     => api.post(`/feed/stories/${id}/seen`),
  dmPings:   ()       => api.get('/feed/dm'),
  dmRead:    (id)     => api.post(`/feed/dm/${id}/read`),
  explore:   (seedImage, limit = 15) => api.get('/feed/explore', { params: { seed_image: seedImage || undefined, limit } }),
  exploreInteract: (imageId, strength = 1) => api.post('/feed/explore/interact', { image_id: imageId, strength }),
  search:     (q, seed, skip = 0, limit = 30) => api.get('/feed/search', { params: { q, seed: seed || undefined, skip, limit } }),
  searchSave: (imageId, tag) => api.post('/feed/search/save', { image_id: imageId, tag }),
}

// ── Companion chat (floating bubble) ────────────────────────────────────────
export const companionApi = {
  config:       ()  => api.get('/companion/config'),
  updateConfig: (d) => api.patch('/companion/config', d),
  history:      (personaId) => api.get('/companion/history', { params: { limit: 60, persona_id: personaId ?? undefined } }),
  chatUrl:      ()  => abs('/api/companion/chat'),
  avatarUrl:    ()  => abs('/api/companion/avatar'),
}

export default api
