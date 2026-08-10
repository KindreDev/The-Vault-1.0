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
import { useVaultStore, SESSION_HEARTBEAT_MS } from '../store/vault'

// ── Heartbeat ────────────────────────────────────────────────────────────────
// Stamps the clock while a session runs so the next launch can tell a session
// that is genuinely still going from one the app was closed on top of. Without
// it, closing the app mid-session and reopening days later logged the whole gap
// as gooning. See readSessionBoot in store/vault.js.
let _heartbeatTimer = null

function beat() {
  useVaultStore.getState().touchSession()
}

export function startSessionHeartbeat() {
  stopSessionHeartbeat()
  beat()
  _heartbeatTimer = setInterval(beat, SESSION_HEARTBEAT_MS)
  // A timer in a backgrounded tab gets throttled, and the last interval before
  // the window dies never fires — both would age the stamp for no reason.
  document.addEventListener('visibilitychange', beat)
  window.addEventListener('beforeunload', beat)
}

export function stopSessionHeartbeat() {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer)
  _heartbeatTimer = null
  document.removeEventListener('visibilitychange', beat)
  window.removeEventListener('beforeunload', beat)
}

export function startSessionNow() {
  useVaultStore.getState().startSession()
  startSessionHeartbeat()
  toast('🔥 Session started')
}

/**
 * Timestamps go to the API as naive UTC ("…T22:14:00.000", no trailing Z).
 * Every datetime column in the DB is naive UTC — logged_at defaults to
 * utcnow() — and the session list re-appends the Z when reading. Sending an
 * offset-aware string here would land a row that displays hours out.
 */
export function toNaiveUtc(ms) {
  if (!ms) return undefined
  return new Date(ms).toISOString().replace('Z', '')
}

/**
 * Log a session the app lost track of — the user confirmed it in the recovery
 * prompt and may have corrected the duration.
 *
 * Deliberately does NOT count an orgasm: nobody can say whether one happened
 * while the app was closed, and inventing one would corrupt a lifetime counter.
 * The time itself is real, so it is logged and earns its XP normally.
 */
export async function logRecoveredSession(durationSec, startedAt) {
  try {
    const { data } = await sessionsApi.log({
      duration_sec: Math.max(0, Math.floor(durationSec)),
      count_orgasm: false,
      logged_at: toNaiveUtc(startedAt),
    })
    const mins = Math.round(durationSec / 60)
    toast.success(`Session recovered · ${mins}m logged`)
    for (const key of ['profile', 'quests', 'all-sessions', 'recent-sessions', 'ses-stats']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
    return data
  } catch (_) {
    toast.error('Could not save the recovered session')
    return null
  }
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
/**
 * The "did you finish?" prompt used by the `ask` end-session setting.
 *
 * The resolver is kept here rather than in the store: it is a one-shot
 * continuation belonging to an in-flight finish, not application state.
 */
let _climaxResolver = null

function askClimax() {
  return new Promise(resolve => {
    _climaxResolver = resolve
    useVaultStore.getState().setClimaxPromptOpen(true)
  })
}

/** Called by SessionEndPrompt. `answer` is 'yes' | 'no' | 'cancel'. */
export function answerClimaxPrompt(answer) {
  useVaultStore.getState().setClimaxPromptOpen(false)
  const resolve = _climaxResolver
  _climaxResolver = null
  if (resolve) resolve(answer)
}

export async function finishSessionNow(opts = {}) {
  const store = useVaultStore.getState()
  if (!store.sessionActive) return null

  // Apply the user's end-session preference, unless the caller was explicit
  // (the "End without climax" button passes countOrgasm directly).
  if (opts.countOrgasm === undefined) {
    const mode = store.sessionEndClimax
    if (mode === 'never') {
      opts = { ...opts, countOrgasm: false }
    } else if (mode === 'ask') {
      // Asked before anything is torn down, so backing out leaves the session
      // running exactly as it was rather than silently ending it.
      const answer = await askClimax()
      if (answer === 'cancel') return null
      // The prompt is modal but not instantaneous — a hotkey could still have
      // ended the session while it was open.
      if (!useVaultStore.getState().sessionActive) return null
      opts = { ...opts, countOrgasm: answer === 'yes' }
    }
  }

  stopSessionHeartbeat()
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
