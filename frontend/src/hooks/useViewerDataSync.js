import { useEffect, useRef } from 'react'

// View tracking/navigation has its own ID-only effect. Keep server fields in
// sync separately so a refetch cannot restart playback or log another view.
export function useViewerDataSync(image, setters) {
  const { setRating, setIsFavorite, setCumCount, setLocalTags, setLocalCreators,
    setHasImageCreators, setFileCreatorIds, setNotes } = setters
  const previous = useRef(null)
  useEffect(() => {
    if (!image) return
    setRating(image.rating ?? 0)
    setIsFavorite(image.is_favorite ?? false)
    setCumCount(image.cum_count ?? 0)
    setLocalTags(image.tags ?? [])
    setLocalCreators(image.creators ?? [])
    setHasImageCreators(image.has_image_creators ?? false)
    setFileCreatorIds(image.file_creator_ids ?? [])
    const old = previous.current
    const savedNotes = image.notes || ''
    // An unrelated refresh must never overwrite an unsaved textarea draft.
    if (old?.id === image.id) {
      setNotes(draft => draft === old.notes ? savedNotes : draft)
    }
    previous.current = { id: image.id, notes: savedNotes }
  }, [image, setRating, setIsFavorite, setCumCount, setLocalTags, setLocalCreators,
    setHasImageCreators, setFileCreatorIds, setNotes])
}
