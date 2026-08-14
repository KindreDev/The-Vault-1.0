/**
 * Rating from the keyboard.
 *
 * Every viewer already had its own star row wired to its own mutation. The
 * number keys have to work in all of them — and on the panel wall, which never
 * had a star row at all — so the write lives here once instead of being copied
 * into four components.
 *
 * Viewers keep `rating` in local state, so after the server call this pings the
 * store the same way logging cum does. Whichever viewer is showing that file
 * picks the ping up and moves its stars without a refetch.
 */
import toast from 'react-hot-toast'
import { imagesApi } from './api'
import { useVaultStore } from '../store/vault'
import queryClient from './queryClient'

const STARS = '★'

export async function rateFocusedImage(rating) {
  const s = useVaultStore.getState()
  const imageId = s.getFocusedImageId()
  if (!imageId) {
    toast('Nothing on screen to rate')
    return null
  }
  return rateImage(imageId, rating)
}

export async function rateImage(imageId, rating) {
  const s = useVaultStore.getState()
  const value = Math.max(0, Math.min(10, Math.round(rating)))

  try {
    // Not optimistic: this is a local SQLite write, back in a few ms, and
    // painting stars before the write lands means having to un-paint them from
    // a helper that has no idea what the rating was before.
    const { data } = await imagesApi.update(imageId, { rating: value })
    s.pingRating(imageId, value)
    if (data?.xp?.amount) s.addXpToast(`+${data.xp.amount} XP`)
    toast(value > 0 ? `${STARS.repeat(Math.min(value, 10))} ${value}` : 'Rating cleared', {
      id: 'rating-toast',   // one toast, replaced — not ten stacked up
    })
    for (const key of ['images-list', 'gallery-images', 'image']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
    return data
  } catch (err) {
    console.error('Rate failed:', err)
    toast.error('Could not save that rating')
    return null
  }
}
