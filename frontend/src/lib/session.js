/**
 * Starting and finishing a goon session — the one implementation.
 *
 * Plain functions rather than a hook so non-React callers (the global hotkey
 * dispatcher) use exactly the same path as the pages. End-session used to be
 * reimplemented per page, which is how surfaces ended up silently recording
 * nothing: the Playlists view never had it at all, and the Ctrl+S hotkey ended
 * the session locally without ever telling the server.
 */
import toast from 'react-hot-toast'
import queryClient from './queryClient'
import { sessionsApi } from './api'
import { useVaultStore } from '../store/vault'

export function startSessionNow() {
  useVaultStore.getState().startSession()
  toast('🔥 Session started')
}

/**
 * End the current session, log it, and count the orgasm.
 *
 * @param {object} opts
 *   imageId        - the file in focus, if the caller knows one
 *   galleryId      - gallery in focus, if any
 *   imageIds       - explicit list; defaults to the visible-media registry
 *   includePrevious- force/suppress crediting the previous shot per surface
 *   countOrgasm    - false for a session that shouldn't count as a finish
 */
export async function finishSessionNow(opts = {}) {
  const store = useVaultStore.getState()
  if (!store.sessionActive) return null

  const elapsed = store.endSession() || 0

  // Whatever was on screen — plus the shot before it on each surface when
  // several are open, since that is usually the one that pushed you over.
  const registry = store.getOrgasmImageIds(opts.includePrevious ?? null)
  const imageIds = opts.imageIds
    ?? (registry.length ? registry : (opts.imageId ? [opts.imageId] : []))

  try {
    const { data } = await sessionsApi.log({
      duration_sec: Math.floor(elapsed / 1000),
      image_id:   opts.imageId   ?? imageIds[0] ?? null,
      gallery_id: opts.galleryId ?? null,
      image_ids:  imageIds,
      count_orgasm: opts.countOrgasm !== false,
    })

    const credited = data?.orgasm?.images_credited ?? 0
    const mins = Math.round(elapsed / 60000)
    toast.success(
      credited > 0
        ? `💦 Session logged · ${mins}m · counted on ${credited} ${credited === 1 ? 'file' : 'files'}`
        : `Session logged · ${mins}m`
    )

    // Counts moved in several places at once.
    for (const key of ['profile', 'gallery-images', 'images-list', 'galleries', 'quests']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
    return data
  } catch (_) {
    // The session already ended locally — say so rather than failing quietly,
    // which is exactly how orgasms went missing before.
    toast.error('Session ended but could not be saved')
    return null
  }
}
