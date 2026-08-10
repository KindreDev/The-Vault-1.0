/**
 * Reflect a file-level creator assignment in the query cache immediately.
 *
 * The obvious move after assigning is to invalidate the image list, but that
 * refetches the whole page — around 1.3s for 100 files, because every row is
 * re-enriched with its tags and creators server-side. The user watches a
 * spinner for something the server already confirmed.
 *
 * The assignment is additive and we know exactly what changed, so the cached
 * rows are patched in place instead. No refetch, no wait, and the grid and any
 * open viewer both show the creator straight away.
 */

/** Query keys whose cached payloads hold image rows. */
const IMAGE_LIST_KEYS = ['images-list', 'gallery-images']

/** Add `creator` to one cached image row, leaving it untouched if already there. */
function withCreator(img, creator) {
  const fileIds = img.file_creator_ids ?? []
  if (fileIds.includes(creator.id)) return img
  const creators = img.creators ?? []
  return {
    ...img,
    creators: creators.some(c => c.id === creator.id) ? creators : [...creators, creator],
    file_creator_ids: [...fileIds, creator.id],
    has_image_creators: true,
  }
}

/**
 * @param queryClient  the React Query client
 * @param imageIds     files that were just assigned
 * @param creator      { id, name, creator_type }
 */
export function patchCachedCreators(queryClient, imageIds, creator) {
  if (!creator?.id || !imageIds?.length) return
  const targets = new Set(imageIds)

  const patch = (img) => (targets.has(img.id) ? withCreator(img, creator) : img)

  for (const key of IMAGE_LIST_KEYS) {
    queryClient.setQueriesData({ queryKey: [key] }, (old) => {
      if (!old) return old
      // Two shapes in play: the paginated { items, total } used by the Photos
      // and Videos tabs, and the bare array a gallery's image list returns.
      if (Array.isArray(old)) return old.map(patch)
      if (Array.isArray(old.items)) return { ...old, items: old.items.map(patch) }
      return old
    })
  }
}
