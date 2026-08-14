/**
 * Handler builders shared by every viewer.
 *
 * The gallery viewer and the photos/videos viewer were already near-identical
 * copies of each other, and their keyboard blocks had quietly drifted apart.
 * Rating and video-transport keys have to behave the same in all of them, so
 * they are built here once and spread into each viewer's handler map.
 *
 * Anything genuinely per-viewer — navigation, zoom, its own slideshow — stays
 * in the viewer, because that part really is different in each one.
 */
import toast from 'react-hot-toast'
import { rateFocusedImage } from './rating'

// 1–9, 0 for ten, backtick to wipe. Always targets the focused surface, which
// on the panel wall means the pinned panel.
export function ratingHandlers() {
  const out = {}
  for (let n = 1; n <= 9; n++) out[`rate_${n}`] = () => rateFocusedImage(n)
  out.rate_10    = () => rateFocusedImage(10)
  out.rate_clear = () => rateFocusedImage(0)
  return out
}

/**
 * Video transport keys.
 *
 * @param getPlayer  () => the InlineVideoPlayer imperative handle, or null
 * @param isVideo    () => whether the focused file is actually a video
 *
 * Every handler no-ops on a photo rather than throwing a toast at you — the
 * keys are harmless there, and nagging about it on every stray press would be
 * worse than silence.
 */
export function videoHandlers(getPlayer, isVideo) {
  const withPlayer = (fn) => () => {
    if (!isVideo()) return
    const p = getPlayer()
    if (!p) return
    fn(p)
  }

  return {
    video_rate_up:    withPlayer(p => toast(`⏩ ${fmtRate(p.adjustRate(+0.25))}×`, { id: 'video-rate' })),
    video_rate_down:  withPlayer(p => toast(`⏪ ${fmtRate(p.adjustRate(-0.25))}×`, { id: 'video-rate' })),
    video_rate_reset: withPlayer(p => toast(`${fmtRate(p.setRate(1))}× — normal speed`, { id: 'video-rate' })),
    video_restart:    withPlayer(p => { p.restart(); toast('↺ From the top', { id: 'video-restart' }) }),
    video_mute:       withPlayer(p => toast(p.toggleMute() ? '🔇 Muted' : '🔊 Sound on', { id: 'video-mute' })),
    video_loop:       withPlayer(p => toast(p.toggleLoop() ? '🔁 Loop on' : 'Loop off', { id: 'video-loop' })),
    video_volume_up:  withPlayer(p => toast(`🔊 ${Math.round(p.adjustVolume(+0.05) * 100)}%`, { id: 'video-volume' })),
    video_volume_down: withPlayer(p => toast(`🔉 ${Math.round(p.adjustVolume(-0.05) * 100)}%`, { id: 'video-volume' })),
    video_funscript_sync: withPlayer(p => {
      const state = p.toggleScriptSync()
      if (state === null) { toast('No funscript on this video'); return }
      toast(state ? '🔗 Device following the script' : 'Device released', { id: 'video-sync' })
    }),
  }
}

// 1.5 not 1.50, 2 not 2.00 — the toast is glanced at, not read.
function fmtRate(r) {
  return String(Math.round(r * 100) / 100)
}
