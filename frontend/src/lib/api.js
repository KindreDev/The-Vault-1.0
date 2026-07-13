import axios from 'axios'
import queryClient from './queryClient.js'
import { xpEvents } from './xpEvents.js'
import { useVaultStore } from '../store/vault.js'

const api = axios.create({ baseURL: '/api', timeout: 30000 })

// Live XP + Credits feedback — fires on every API response that carries XP data.
// Patterns supported:
//   d.total_xp + d.level_up  → XPEventOut at top level
//   d.xp_event               → spin / login (nested under "xp_event")
//   d.xp                     → cum, rate, tag (nested under "xp")
//   d.xp_earned              → sessions list (legacy, amount only)
api.interceptors.response.use(res => {
  try {
    const d = res.data
    if (!d || typeof d !== 'object') return res

    const xpEvt = (d.total_xp !== undefined && d.level_up !== undefined) ? d
                : (d.xp_event?.total_xp !== undefined)                    ? d.xp_event
                : (d.xp?.total_xp !== undefined)                          ? d.xp
                : null

    if (xpEvt) {
      // Instant cache write — no network round-trip needed
      queryClient.setQueryData(['profile'], old =>
        old ? { ...old, total_xp: xpEvt.total_xp, level: xpEvt.level,
                level_title: xpEvt.title || old.level_title } : old
      )
      // XP toast
      if (xpEvt.amount > 0) {
        const mult = xpEvt.multiplier > 1 ? ` ×${xpEvt.multiplier.toFixed(1)}` : ''
        useVaultStore.getState().addXpToast(`+${xpEvt.amount} XP${mult}`)
      }
      // Credits toast (only when credits were awarded alongside XP)
      if (xpEvt.credits_earned > 0) {
        useVaultStore.getState().addCreditToast(`+${xpEvt.credits_earned} Credits`)
      }
      // Pack reward banner (daily/weekly completion bonus)
      if (xpEvt.packs_awarded) {
        const { type, quantity } = xpEvt.packs_awarded
        useVaultStore.getState().addPackToast(type, quantity)
      }
      // Level-up overlay
      if (xpEvt.level_up) xpEvents.emit({ xpEvt })

    } else if (d.xp_earned !== undefined) {
      queryClient.setQueryData(['profile'], old =>
        old ? { ...old, total_xp: (old.total_xp || 0) + d.xp_earned } : old
      )
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    }

    // Standalone credits (pack open, shard exchange, etc.)
    if (!xpEvt && d.credits_earned !== undefined && d.credits_earned > 0) {
      useVaultStore.getState().addCreditToast(`+${d.credits_earned} Credits`)
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    }
  } catch (_) {}
  return res
})

// ── Galleries ─────────────────────────────────────────────────────────────────
export const galleriesApi = {
  list:          (params)          => api.get('/galleries/', { params }),
  get:           (id)              => api.get(`/galleries/${id}`),
  create:        (d)               => api.post('/galleries/', d),
  update:        (id, d)           => api.patch(`/galleries/${id}`, d),
  delete:        (id, delete_files)=> api.delete(`/galleries/${id}`, { params: { delete_files } }),
  recent:        (n = 8)           => api.get('/galleries/recent', { params: { limit: n } }),
  random:        ()                => api.get('/galleries/random'),
  hof:           (n = 10)          => api.get('/galleries/hall-of-fame', { params: { limit: n } }),
  galleryHof:    (n = 5)           => api.get('/galleries/gallery-hof', { params: { limit: n } }),
  stats:         ()                => api.get('/galleries/stats'),
  periods:       (params)          => api.get('/galleries/periods', { params }),
  images:        (id, params)      => api.get(`/galleries/${id}/images`, { params }),
  cum:           (id)              => api.post(`/galleries/${id}/cum`),
  addCreator:    (id, creatorId)   => api.post(`/galleries/${id}/creators/${creatorId}`),
  removeCreator: (id, creatorId)   => api.delete(`/galleries/${id}/creators/${creatorId}`),
  bulkAssign:    (galleryIds, creatorId) => api.post('/galleries/bulk-assign', { gallery_ids: galleryIds, creator_id: creatorId }),
  setCover:      (galleryId, imageId)   => api.post(`/galleries/${galleryId}/set-cover/${imageId}`),
  randomPicks:   (n = 8)           => api.get('/galleries/', { params: { sort_by: 'random', limit: n } }),
  view:          (id)              => api.post(`/galleries/${id}/view`),
  rate:          (id, rating)     => api.post(`/galleries/${id}/rate`, null, { params: { rating } }),
  similar:       (id, limit = 6)  => api.get(`/galleries/${id}/similar`, { params: { limit } }),
  merge:         (targetId, body) => api.post(`/galleries/${targetId}/merge`, body),
  renameFolder:  (id, folderName) => api.post(`/galleries/${id}/rename-folder`, { folder_name: folderName }),
  extract:       (id, imageIds, folderName) => api.post(`/galleries/${id}/extract`, { image_ids: imageIds, new_folder_name: folderName }),
  randomMix:     (d)              => api.post('/galleries/random-mix', d),
  pickFolder:    ()               => api.post('/galleries/pick-folder'),
  exportZip:     (galleryIds, outputPath) => api.post('/galleries/export-zip', { gallery_ids: galleryIds, output_path: outputPath }, { timeout: 300000 }),
}

// ── Creators ──────────────────────────────────────────────────────────────────
export const creatorsApi = {
  list:              (params) => api.get('/creators/', { params }),
  get:               (id)     => api.get(`/creators/${id}`),
  create:            (d)      => api.post('/creators/', d),
  update:            (id, d)  => api.patch(`/creators/${id}`, d),
  delete:            (id)     => api.delete(`/creators/${id}`),
  favorites:         ()       => api.get('/creators/favorites'),
  franchises:        ()       => api.get('/creators/franchises'),
  hof:               (n = 5) => api.get('/creators/hall-of-fame', { params: { limit: n } }),
  distribution:      ()      => api.get('/creators/distribution'),
  topImages:         (id, n)  => api.get(`/creators/${id}/top-images`, { params: { limit: n } }),
  setAvatarRandom:   (id, excludePath) => api.post(`/creators/${id}/set-avatar-random`, excludePath ? { exclude_path: excludePath } : {}),
  setBannerRandom:   (id, excludeId)   => api.post(`/creators/${id}/set-banner-random`,  excludeId   ? { exclude_id:   excludeId   } : {}),
  uploadBanner:      (id, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post(`/creators/${id}/banner-upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  uploadAvatar:      (id, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post(`/creators/${id}/avatar-upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  setAvatarFromImage:(id, imageId) => api.post(`/creators/${id}/set-avatar-image/${imageId}`),
  setAvatarFromVideo:(id, imageId, timestamp, clip = false) =>
    api.post(`/creators/${id}/avatar-from-video/${imageId}`, { timestamp, clip }, { timeout: 120000 }),
  setBannerFromVideo:(id, imageId, timestamp, clip = false) =>
    api.post(`/creators/${id}/banner-from-video/${imageId}`, { timestamp, clip }, { timeout: 120000 }),
  setBannerFromImage:(id, imageId) => api.post(`/creators/${id}/set-banner-image/${imageId}`),
  setAvatarFromUrl:  (id, url)     => api.post(`/creators/${id}/avatar-from-url`, { url }),
  randomPicks:       (n = 8) => api.get('/creators/', { params: { sort_by: 'random', limit: n } }),
  byCountry:         ()      => api.get('/creators/by-country'),
  topByValue:        (n = 5) => api.get('/creators/top-by-value', { params: { limit: n } }),
  jikanSearch:       (q)     => api.get('/creators/jikan-search', { params: { q, limit: 8 } }),
  jikanCharacter:    (malId) => api.get(`/creators/jikan-character/${malId}`),
  assignFolder:      (id, folderPath) => api.post(`/creators/${id}/assign-folder`, { folder_path: folderPath }),
  syncSourceFolders: ()              => api.post('/creators/sync-source-folders'),
  giftHeart:         (id)            => api.post(`/creators/${id}/gift-heart`),
  avatarUrl:         (id) => `/api/creators/${id}/avatar`,
  avatarThumbUrl:    (id, size = 480) => `/api/creators/${id}/avatar-thumb?size=${size}`,
}

// ── Images ────────────────────────────────────────────────────────────────────
export const imagesApi = {
  list:          (params)  => api.get('/images/', { params }),
  periods:       (params)  => api.get('/images/periods', { params }),
  get:           (id)      => api.get(`/images/${id}`),
  update:        (id, d)   => api.patch(`/images/${id}`, d),
  delete:        (id, keepFile = false) => api.delete(`/images/${id}`, { params: { keep_file: keepFile } }),
  bulkDelete:    (ids, keepFile = false) => api.post('/images/bulk-delete', { ids }, { params: { keep_file: keepFile } }),
  view:          (id)      => api.post(`/images/${id}/view`),
  logDuration:   (id, s)  => api.post(`/images/${id}/duration`, { seconds: s }),
  cum:           (id, d)   => api.post(`/images/${id}/cum`, d),
  addTag:        (id, tag) => api.post(`/images/${id}/tags/${tag}`),
  removeTag:     (id, tag) => api.delete(`/images/${id}/tags/${tag}`),
  random:        (tag)     => api.get('/images/random/pick', { params: { tag } }),
  randomPicks:   (n = 8)   => api.get('/images/', { params: { sort_by: 'random', limit: n, is_video: false } }),
  randomVideos:  (n = 8)   => api.get('/images/', { params: { sort_by: 'random', limit: n, is_video: true } }),
  transfer:           (id, galleryId) => api.patch(`/images/${id}`, { gallery_id: galleryId }),
  focalPoint:         (id, x, y) => api.patch(`/images/${id}/focal-point`, { focal_x: x, focal_y: y }),
  addCreator:         (id, creatorId) => api.post(`/images/${id}/creators/${creatorId}`),
  removeCreator:      (id, creatorId) => api.delete(`/images/${id}/creators/${creatorId}`),
  clearCreators:      (id)            => api.delete(`/images/${id}/creators`),
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export const sessionsApi = {
  log:   (d)  => api.post('/sessions/', d),
  list:  (p)  => api.get('/sessions/', { params: p }),
  stats: ()   => api.get('/sessions/stats'),
}

// ── Gamification ──────────────────────────────────────────────────────────────
export const gamiApi = {
  profile:          ()  => api.get('/gamification/profile'),
  login:            ()  => api.post('/gamification/login'),
  spin:             ()  => api.post('/gamification/spin'),
  quests:           ()  => api.get('/gamification/quests'),
  achievements:     ()  => api.get('/gamification/achievements'),
  xpHistory:        ()  => api.get('/gamification/xp-history'),
  updateProfile:    (d) => api.patch('/gamification/profile', d),
  taggingMission:       ()     => api.get('/gamification/tagging-mission'),
  completeMission:      ()     => api.post('/gamification/tagging-mission/complete'),
  claimCompletionBonus: (type) => api.post('/gamification/claim-completion-bonus', { type }),
  uploadAvatar:     (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/gamification/profile/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  avatarUrl:        (bust) => `/api/gamification/profile/avatar?v=${bust}`,
}

// ── Scanner ───────────────────────────────────────────────────────────────────
export const scannerApi = {
  roots:           ()     => api.get('/scanner/roots'),
  addRoot:         (d)    => api.post('/scanner/roots', d),
  delRoot:         (id)   => api.delete(`/scanner/roots/${id}`),
  scan:            (id)   => api.post('/scanner/scan', null, { params: id ? { root_id: id } : {} }),
  scanFolder:      (path) => api.post('/scanner/scan-folder', { path }),
  status:          ()     => api.get('/scanner/status'),
  cancel:          ()     => api.post('/scanner/cancel'),
  log:             ()     => api.get('/scanner/log'),
  browseFolder:    ()     => api.get('/scanner/browse-folder'),
  regenThumbs:     (type = null) => api.post('/scanner/regen-thumbs', type ? { type } : {}),
  purgeThumbs:     (type = null) => api.post('/scanner/purge-thumbs', type ? { type } : {}),
  matchFunscripts: (path) => api.post('/scanner/match-funscripts', path ? { path } : {}),
  gpuStatus:       ()     => api.get('/scanner/gpu-status'),
  gpuDownload:     ()     => api.post('/scanner/gpu-download'),
}

// ── Playlists ─────────────────────────────────────────────────────────────────
export const playlistsApi = {
  list:        ()       => api.get('/playlists/'),
  create:      (d)      => api.post('/playlists/', d),
  get:         (id)     => api.get(`/playlists/${id}`),
  detail:      (id)     => api.get(`/playlists/${id}/detail`),
  delete:      (id)     => api.delete(`/playlists/${id}`),
  addImage:    (id, im) => api.post(`/playlists/${id}/images/${im}`),
  removeImage: (id, im) => api.delete(`/playlists/${id}/images/${im}`),
  randomMix:   (d)      => api.post('/playlists/random-mix', d),
}

// ── Tags ──────────────────────────────────────────────────────────────────────
export const tagsApi = {
  list:       (cat) => api.get('/tags/', { params: cat ? { category: cat } : {} }),
  create:     (d)   => api.post('/tags/', d),
  categories: ()    => api.get('/tags/categories'),
  stats:      ()    => api.get('/tags/stats'),
  get:        (id)  => api.get(`/tags/${id}`),
  update:     (id, d) => api.patch(`/tags/${id}`, d),
  delete:     (id)  => api.delete(`/tags/${id}`),
  merge:           (sourceId, targetId) => api.post('/tags/merge', { source_id: sourceId, target_id: targetId }),
  recalculate:     ()                   => api.post('/tags/recalculate-counts'),
  images:          (id, params)        => api.get(`/tags/${id}/images`, { params }),
  categorySamples: ()                  => api.get('/tags/category-samples'),
  trending:        (limit = 8, days = 30) => api.get('/tags/trending', { params: { limit, days } }),
  coOccurring:     (limit = 10)           => api.get('/tags/co-occurring', { params: { limit } }),
}

// ── AI Tagger ─────────────────────────────────────────────────────────────────
export const taggerApi = {
  modelStatus:    ()      => api.get('/scanner/ai-tag-models'),
  downloadModels: (body)  => api.post('/scanner/ai-tag-download', body),
  start:          (body)  => api.post('/scanner/ai-tag', body),
  status:         ()      => api.get('/scanner/ai-tag-status'),
  cancel:         ()      => api.post('/scanner/ai-tag-cancel'),
}

// ── TCG: Cards ────────────────────────────────────────────────────────────────
export const cardsApi = {
  inventory:           (params)   => api.get('/cards/inventory', { params }),
  get:                 (id)       => api.get(`/cards/${id}`),
  openPack:            (data)     => api.post('/cards/packs/open', data),
  openPackFromInventory: (data)   => api.post('/cards/packs/open-from-inventory', data),
  dismantle:           (invId)    => api.post(`/cards/${invId}/dismantle`),
  dismantleBatch:      (ids)      => api.post('/cards/forge/dismantle-batch', { inventory_ids: ids }),
  applyCatalyst:       (invId)    => api.post(`/cards/${invId}/apply-catalyst`),
  feedDuplicate:       (invId)    => api.post(`/cards/${invId}/feed-duplicate`),
  feedCards:           (invId, sourceIds) => api.post(`/cards/${invId}/feed-cards`, { source_ids: sourceIds }),
  evolveCxp:           (invId)    => api.post(`/cards/${invId}/evolve-cxp`),
  getFuseable:         (invId)    => api.get(`/cards/${invId}/fuseable`),
  fuseAll:             (invId)    => api.post(`/cards/${invId}/fuse-all`),
  dismantleDuplicates: ()         => api.post('/cards/forge/dismantle-duplicates'),
  materials:           ()         => api.get('/cards/forge/materials'),
  craftCatalyst:       ()         => api.post('/cards/forge/craft-catalyst'),
  shardsToCredits:     (amount)   => api.post('/cards/forge/shards-to-credits', null, { params: { amount } }),
  rarityDistribution:  ()         => api.get('/cards/rarity-distribution'),
  variantPairs:        ()         => api.get('/cards/forge/variant-pairs'),
  forgeVariant:        (creator_id, character_id) => api.post('/cards/forge/craft-variant', { creator_id, character_id }),
}

// ── TCG: Economy ──────────────────────────────────────────────────────────────
export const economyApi = {
  balance: () => api.get('/economy/balance'),
}

// ── System / maintenance ──────────────────────────────────────────────────────
export const systemApi = {
  health:    () => api.get('/system/health'),
  backup:    () => window.open('/api/system/backup', '_blank'),   // triggers browser download
  restart:   () => api.post('/system/restart'),
  getConfig:  () => api.get('/system/config'),
  setConfig:  (data_dir) => api.post('/system/config', { data_dir }),
  setGpuMode:   (use_gpu) => api.post('/system/config/gpu-mode', { use_gpu }),
  setFunscriptLibrary: (funscript_library_path) => api.post('/system/config/funscript-library', { funscript_library_path }),
  getStartup:   ()        => api.get('/system/startup'),
  setStartup:   (enabled) => api.post('/system/startup', { enabled }),
  reset:        ()        => api.post('/system/reset'),
  consoleEntries: (last = 500) => api.get('/system/console', { params: { last } }),
  restore: (file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/system/restore', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
  },
  getVersion:    () => api.get('/system/version'),
  mobileLink:    () => api.get('/system/mobile-link'),
  checkUpdate:   () => api.get('/system/update/check'),
  installUpdate: (download_url) => api.post('/system/update/install', { download_url }),
  updateStatus:  () => api.get('/system/update/status'),
}

export const tasksApi = {
  queue:         ()        => api.get('/tasks'),
  cancelCurrent: ()        => api.delete('/tasks/current'),
  removeQueued:  (id)      => api.delete(`/tasks/queued/${id}`),
}

export const dedupApi = {
  computeHashes:        ()               => api.post('/dedup/compute-hashes'),
  cancel:               ()               => api.post('/dedup/cancel'),
  status:               ()               => api.get('/dedup/status'),
  groups:               (threshold = 10) => api.get('/dedup/groups', { params: { threshold } }),
  galleryOverlaps:      (threshold = 10) => api.get('/dedup/gallery-overlaps', { params: { threshold } }),
  imageMatches:         (id, threshold)  => api.get(`/dedup/image/${id}`, { params: { threshold } }),
  stats:                ()               => api.get('/dedup/stats'),
  ignorePermanent:      (imageIds)       => api.post('/dedup/ignore-permanent', { image_ids: imageIds }),
  clearIgnoredPermanent:()               => api.delete('/dedup/ignore-permanent'),
  ignoredCount:         ()               => api.get('/dedup/ignored-count'),
}

// ── Companion (Erika AI) ──────────────────────────────────────────────────────
export const companionApi = {
  getConfig:    ()      => api.get('/companion/config').catch(() => null),
  updateConfig: (d)     => api.patch('/companion/config', d),
  history:      (n=50, personaId=undefined) => api.get('/companion/history', { params: { limit: n, ...(personaId !== undefined ? { persona_id: personaId } : {}) } }),
  clearHistory: (personaId = undefined) => api.delete('/companion/history', {
    params: personaId !== undefined ? { persona_id: personaId } : {}
  }),
  sessionBreak: (personaId = undefined) => api.post('/companion/session-break', null, {
    params: personaId !== undefined ? { persona_id: personaId } : {}
  }),
  suggest:      ()      => fetch('/api/companion/suggest', { method: 'POST' }),
  ollamaStatus: ()      => api.get('/companion/ollama/status'),
  ollamaUnload: ()      => api.post('/companion/ollama/unload'),
  bond:         ()      => api.get('/companion/bond'),
  resetBond:    ()      => api.post('/companion/bond/reset'),
  avatarUrl:    ()      => '/api/companion/avatar',
  uploadAvatar: (file)  => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/companion/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

export default api
