export const HOF_METAL_RARITIES = Object.freeze(['R', 'SR', 'UR', 'SPR'])

export function resolveHofMediaTreatment(mediaType = 'image', presentation = 'preview', rarity = 'C') {
  const normalizedType = mediaType === 'video' || mediaType === 'gif' ? mediaType : 'image'
  const isVideoLike = normalizedType === 'video' || normalizedType === 'gif'
  const videoPresentation = presentation === 'full' ? 'full' : 'preview'
  return Object.freeze({
    mediaType: normalizedType,
    isVideoLike,
    playFullVideo: normalizedType === 'video' && videoPresentation === 'full',
    videoPresentation,
    useVideoArtwork: isVideoLike,
    metalSignature: true,
  })
}
