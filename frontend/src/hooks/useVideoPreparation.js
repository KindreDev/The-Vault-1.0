import { useEffect, useMemo, useId } from 'react'
import { clearPreparedVideo, prepareVideo } from '../lib/nativeVideo'

// Plan shuffle once so preparation and automatic advancement choose the same
// file from the current filtered list. Each viewer owns one preparation slot.
export default function useVideoPreparation(images, index, shuffle = false, wrap = true) {
  const owner = `viewer-${useId()}`
  useEffect(() => () => { clearPreparedVideo(owner).catch(() => {}) }, [owner])
  const selection = images.map(image => image.id).join('|')
  const nextIndex = useMemo(() => {
    if (images.length < 2) return null
    if (shuffle) {
      const draw = Math.floor(Math.random() * (images.length - 1))
      return draw >= index ? draw + 1 : draw
    }
    return index + 1 < images.length ? index + 1 : wrap ? 0 : null
  }, [selection, index, shuffle, wrap])
  const next = images[nextIndex]
  const nextSrc = next?.is_video ? `/api/images/${next.id}/file` : null
  useEffect(() => {
    if (!images[index]?.is_video) prepareVideo(owner, nextSrc)
  }, [owner, selection, index, nextSrc])
  return { preloadKey: owner, nextIndex, nextSrc }
}
