import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { imagesApi, playlistsApi, tcgRoomApi } from '../../lib/api'

// Vault photo and video lookups shared by the room's posters, screens and
// poster flip bin.

export const PAGE = 48

export function asList(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.images)) return value.images
  return []
}

export function headerTotal(response) {
  return parseInt(response.headers?.['x-total-count'] ?? '0', 10) || 0
}

export function vaultThumb(img) {
  if (!img) return ''
  if (img.thumb_url) return img.thumb_url
  if (img.thumb_path) return `/thumbs/${String(img.thumb_path).split(/[\\/]/).pop()}`
  return img.id ? `/api/images/${img.id}/thumb` : ''
}

export function useSentinel(enabled, onHit) {
  const ref = useRef(null)
  useEffect(() => {
    if (!enabled || !ref.current) return undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onHit()
    }, { rootMargin: '480px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [enabled, onHit])
  return ref
}

export async function loadPosterPage(skip, query) {
  if (!query) {
    const recent = await imagesApi.list({ is_video: false, skip, limit: PAGE, sort_by: 'date' })
    return { items: asList(recent.data), total: headerTotal(recent), skip, pageSize: PAGE }
  }
  const [byTag, byName] = await Promise.all([
    imagesApi.list({ is_video: false, skip, limit: PAGE, tags: query, tag_mode: 'any' }),
    imagesApi.list({ is_video: false, skip, limit: PAGE, search: query }),
  ])
  const seen = new Set()
  const items = [...asList(byTag.data), ...asList(byName.data)].filter(image => {
    if (seen.has(image.id)) return false
    seen.add(image.id)
    return true
  })
  return {
    items,
    total: Math.max(headerTotal(byTag), headerTotal(byName)),
    skip,
    pageSize: PAGE,
    tagCount: asList(byTag.data).length,
    nameCount: asList(byName.data).length,
  }
}


/** A page of random Vault photos, for slideshows with no search. */
export async function loadRandomPhotos(limit = PAGE) {
  const response = await imagesApi.list({ is_video: false, limit, sort_by: 'random' })
  return asList(response.data)
}

/** A page of Vault videos matching a filename search (newest first without one). */
export async function loadVideoPage(skip, query) {
  const response = await imagesApi.list({ is_video: true, skip, limit: PAGE, ...(query ? { search: query } : { sort_by: 'date' }) })
  return { items: asList(response.data), total: headerTotal(response), skip, pageSize: PAGE }
}

/**
 * Saved settings ("content") of a placed room item, and a save that keeps
 * every other setting.  Saving goes through a furniture move to the same spot.
 */
export function useFurnitureContent(bootstrap, instanceId) {
  const qc = useQueryClient()
  const room = bootstrap?.room || { revision: 0, placements: [] }
  const placement = room.placements?.find(item => item.instance_id === instanceId)
  const content = placement?.transform?.content || {}
  const save = useMutation({
    mutationFn: changes => tcgRoomApi.moveFurniture(instanceId, {
      expected_revision: room.revision,
      transform: { position: placement?.transform?.position, rotation: placement?.transform?.rotation, content: { ...content, ...changes } },
      snap_anchor: placement?.snap_anchor || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] })
      qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })
    },
  })
  return { placement, content, save }
}

// ── Media sources ──────────────────────────────────────────────────────────
// A source says where a room piece takes its photos or videos from:
//   { kind: 'search', query }            tags / filename (empty = everything)
//   { kind: 'gallery' | 'creator' | 'playlist', id, name }

export const DEFAULT_SOURCE = Object.freeze({ kind: 'search', query: '' })

// Playlists come back whole, so keep each one for a minute and page locally.
const playlistCache = new Map()
async function playlistImages(id) {
  const cached = playlistCache.get(id)
  if (cached && Date.now() - cached.at < 60_000) return cached.images
  const response = await playlistsApi.detail(id)
  const images = response.data?.images || []
  playlistCache.set(id, { at: Date.now(), images })
  return images
}

/** One page of photos (or videos) from a source. */
export async function loadSourcePage(source = DEFAULT_SOURCE, skip = 0, { videos = false } = {}) {
  if (!source || source.kind === 'search') {
    const query = source?.query || ''
    return videos ? loadVideoPage(skip, query) : loadPosterPage(skip, query)
  }
  if (source.kind === 'playlist') {
    const all = (await playlistImages(source.id)).filter(image => Boolean(image.is_video) === videos)
    return { items: all.slice(skip, skip + PAGE), total: all.length, skip, pageSize: PAGE }
  }
  const filter = source.kind === 'gallery' ? { gallery_id: source.id } : { creator_id: source.id }
  const response = await imagesApi.list({ ...filter, is_video: videos, skip, limit: PAGE, sort_by: source.kind === 'gallery' ? 'filename' : 'date_added' })
  return { items: asList(response.data), total: headerTotal(response), skip, pageSize: PAGE }
}

/** Up to `cap` photos from a source, for pieces that follow it live. */
export async function loadSourceImages(source = DEFAULT_SOURCE, { videos = false, cap = 240 } = {}) {
  if ((!source || source.kind === 'search') && !source?.query && !videos) return loadRandomPhotos(Math.min(cap, 200))
  const items = []
  for (let skip = 0; items.length < cap; skip += PAGE) {
    const page = await loadSourcePage(source, skip, { videos })
    items.push(...page.items)
    if (page.items.length < PAGE) break
  }
  return items.slice(0, cap)
}

/** A source the picker can load: a search, or a chosen gallery/creator/playlist. */
export function sourceReady(source) {
  return Boolean(source && (source.kind === 'search' || source.id))
}

export function sourceKey(source) {
  if (!source) return 'search:'
  return source.kind === 'search' ? `search:${source.query || ''}` : `${source.kind}:${source.id}`
}

/** Infinite, de-duplicated grid of a source with a scroll sentinel. */
export function usePagedSource(source, { videos = false, enabled = true } = {}) {
  const library = useInfiniteQuery({
    queryKey: ['room-media-source', videos ? 'videos' : 'photos', sourceKey(source)],
    queryFn: ({ pageParam = 0 }) => loadSourcePage(source, pageParam, { videos }),
    initialPageParam: 0,
    getNextPageParam: last => (last.items.length >= last.pageSize ? last.skip + last.pageSize : undefined),
    enabled,
  })
  const items = useMemo(() => {
    const seen = new Set()
    return (library.data?.pages || []).flatMap(page => page.items).filter(item => !seen.has(item.id) && seen.add(item.id))
  }, [library.data])
  const total = library.data?.pages?.[0]?.total || 0
  const loadMore = useCallback(() => {
    if (library.hasNextPage && !library.isFetchingNextPage) library.fetchNextPage()
  }, [library])
  const sentinel = useSentinel(enabled && library.hasNextPage && !library.isFetchingNextPage, loadMore)
  return { items, total, sentinel, loading: library.isFetching, loadingMore: library.isFetchingNextPage }
}

/** A screen's or bin's saved source; older saves only had a search query. */
export function savedSource(content) {
  if (content?.source) return content.source
  return content?.query ? { kind: 'search', query: content.query } : DEFAULT_SOURCE
}

/** Photo ids a flip bin shows: its picked photos, or its whole source. */
export function useFlipBinImages(content) {
  const live = Boolean(content?.use_source)
  const source = savedSource(content)
  const { data: sourceImages = [] } = useQuery({
    queryKey: ['room-flip-bin-source', sourceKey(source)],
    queryFn: () => loadSourceImages(source),
    enabled: live,
    staleTime: 5 * 60_000,
  })
  return useMemo(() => (live
    ? sourceImages.map(image => image.id)
    : (Array.isArray(content?.image_ids) ? content.image_ids : [])), [content?.image_ids, live, sourceImages])
}
