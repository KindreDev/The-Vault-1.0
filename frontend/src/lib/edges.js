/**
 * Logging an edge by hand.
 *
 * Edges were only ever recorded by Edge Mode — the device deciding it had cut
 * out. That leaves anyone not using a device, or edging on their own terms,
 * with a counter they can never move. This is the same event the device
 * reporter fires, just triggered deliberately.
 *
 * Credits every file on screen (a multi-panel wall genuinely was all being
 * looked at) and falls back to whatever single file has focus.
 */
import toast from 'react-hot-toast'
import { imagesApi } from './api'
import { useVaultStore } from '../store/vault'
import queryClient from './queryClient'

export async function logEdgeNow() {
  const s = useVaultStore.getState()

  const visible = s.getVisibleImageIds()
  const ids = visible.length ? visible : [s.getFocusedImageId()].filter(Boolean)

  try {
    const { data } = await imagesApi.logEdge(ids)
    if (data?.xp?.amount) s.addXpToast(`+${data.xp.amount} XP`)

    const n = data?.images_credited ?? 0
    toast(n > 0
      ? `🌊 Edge held · counted on ${n} ${n === 1 ? 'file' : 'files'}`
      : '🌊 Edge held')

    // The lifetime totals on the profile and stats pages just moved.
    for (const key of ['profile', 'ses-stats', 'images-list', 'gallery-images']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
    return data
  } catch (err) {
    console.error('Log edge failed:', err)
    toast.error('Could not log that edge')
    return null
  }
}
