import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search, SquareStack } from 'lucide-react'
import { imagesApi, tcgRoomApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { displaySlotCount, SURFACE_ASSETS } from './roomLayout'

const PAGE = 48

function asList(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.images)) return value.images
  return []
}

function headerTotal(response) {
  return parseInt(response.headers?.['x-total-count'] ?? '0', 10) || 0
}

function vaultThumb(img) {
  if (!img) return ''
  if (img.thumb_url) return img.thumb_url
  if (img.thumb_path) return `/thumbs/${String(img.thumb_path).split(/[\\/]/).pop()}`
  return img.id ? `/api/images/${img.id}/thumb` : ''
}

function useSentinel(enabled, onHit) {
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

async function loadPosterPage(skip, query) {
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

export default function RoomDisplayManager({ context, bootstrap, instanceId = null }) {
  const qc = useQueryClient()
  const [selectedInstance, setSelectedInstance] = useState(instanceId)
  const [selectedSlot, setSelectedSlot] = useState('0')
  const [inspecting, setInspecting] = useState(null)
  const [tilt, setTilt] = useState({ x: 8, y: -12 })
  const [photoSearch, setPhotoSearch] = useState('')
  const [cardSearch, setCardSearch] = useState('')
  const [photoQuery, setPhotoQuery] = useState('')
  const [cardQuery, setCardQuery] = useState('')
  const [rarity, setRarity] = useState('')
  const posterMode = context === 'poster'
  const definitions = (bootstrap?.catalog || []).filter(item => posterMode
    ? item.asset_id === 'poster_frame'
    : SURFACE_ASSETS.has(item.asset_id))
  const definitionIds = new Set(definitions.map(item => item.id))
  const instances = (bootstrap?.owned_instances || []).filter(item => definitionIds.has(item.definition_id) && item.status === 'placed')
  const room = bootstrap?.room || { revision: 0, placements: [] }
  const { data: pile = [] } = useQuery({ queryKey: ['tcg-room-copies', 'available-display'], queryFn: () => tcgRoomApi.copies({ location_kind: 'unorganized_pile' }).then(r => r.data), enabled: !posterMode })
  const { data: allCopies = [] } = useQuery({ queryKey: ['tcg-room-copies'], queryFn: () => tcgRoomApi.copies().then(r => r.data), enabled: !posterMode })
  const cardCatalog = useInfiniteQuery({
    queryKey: ['tcg-v2-catalog', 'room-display', cardQuery, rarity],
    queryFn: ({ pageParam = 0 }) => tcgV2Api.catalog({
      ownership: 'owned', skip: pageParam, limit: PAGE, search: cardQuery || undefined, rarity: rarity || undefined,
    }).then(r => r.data),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + (page.items?.length || 0), 0)
      return loaded < (lastPage.total || 0) ? loaded : undefined
    },
    enabled: !posterMode,
  })
  const photoLibrary = useInfiniteQuery({
    queryKey: ['room-poster-library', photoQuery],
    queryFn: ({ pageParam = 0 }) => loadPosterPage(pageParam, photoQuery),
    initialPageParam: 0,
    getNextPageParam: lastPage => {
      const tagFull = (lastPage.tagCount ?? 0) >= lastPage.pageSize
      const nameFull = (lastPage.nameCount ?? 0) >= lastPage.pageSize
      const recentFull = lastPage.tagCount == null && lastPage.items.length >= lastPage.pageSize
      return (tagFull || nameFull || recentFull) ? lastPage.skip + lastPage.pageSize : undefined
    },
    enabled: posterMode,
  })
  const photos = useMemo(() => {
    const seen = new Set()
    return (photoLibrary.data?.pages || []).flatMap(page => page.items).filter(image => {
      if (seen.has(image.id)) return false
      seen.add(image.id)
      return true
    })
  }, [photoLibrary.data])
  const photoTotal = photoLibrary.data?.pages?.[0]?.total || 0
  const catalogItems = useMemo(
    () => (cardCatalog.data?.pages || []).flatMap(page => page.items || []),
    [cardCatalog.data],
  )
  const cards = useMemo(() => new Map(catalogItems.filter(item => item.card).map(item => [item.card.id, item.card])), [catalogItems])
  const pileByCard = useMemo(() => {
    const map = new Map()
    for (const copy of asList(pile)) {
      if (!map.has(copy.card_id)) map.set(copy.card_id, copy)
    }
    return map
  }, [pile])
  const browseCards = useMemo(
    () => catalogItems.filter(item => item.card && pileByCard.has(item.card.id)).map(item => ({
      copy: pileByCard.get(item.card.id),
      card: item.card,
      code: item.identity?.stable_card_id || item.card.catalog_code || item.display_number || `CARD-${String(item.card.id).padStart(6, '0')}`,
    })),
    [catalogItems, pileByCard],
  )
  const selectedDef = definitions.find(item => item.id === instances.find(value => value.id === selectedInstance)?.definition_id)
  const slotCount = displaySlotCount(selectedDef?.asset_id) || 1
  const slots = Array.from({ length: slotCount }, (_, index) => String(index))
  const placement = room.placements?.find(item => item.instance_id === selectedInstance)
  const posterContent = placement?.transform?.content || {}
  const loadMorePhotos = useCallback(() => {
    if (photoLibrary.hasNextPage && !photoLibrary.isFetchingNextPage) photoLibrary.fetchNextPage()
  }, [photoLibrary.fetchNextPage, photoLibrary.hasNextPage, photoLibrary.isFetchingNextPage])
  const loadMoreCards = useCallback(() => {
    if (cardCatalog.hasNextPage && !cardCatalog.isFetchingNextPage) cardCatalog.fetchNextPage()
  }, [cardCatalog.fetchNextPage, cardCatalog.hasNextPage, cardCatalog.isFetchingNextPage])
  const photoSentinel = useSentinel(posterMode && photoLibrary.hasNextPage && !photoLibrary.isFetchingNextPage, loadMorePhotos)
  const cardSentinel = useSentinel(!posterMode && cardCatalog.hasNextPage && !cardCatalog.isFetchingNextPage, loadMoreCards)
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }),
      qc.invalidateQueries({ queryKey: ['tcg-room-copies'] }),
      qc.invalidateQueries({ queryKey: ['tcg-room-visible-cards'] }),
      qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] }),
    ])
    await qc.refetchQueries({ queryKey: ['tcg-room-visible-cards'] })
  }
  useEffect(() => {
    if (instanceId) setSelectedInstance(instanceId)
  }, [instanceId])
  useEffect(() => {
    const timer = window.setTimeout(() => setPhotoQuery(photoSearch.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [photoSearch])
  useEffect(() => {
    const timer = window.setTimeout(() => setCardQuery(cardSearch.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [cardSearch])
  const assign = useMutation({
    mutationFn: copyId => tcgRoomApi.assignDisplay({ instance_id: selectedInstance, copy_id: copyId, slot_key: selectedSlot }),
    onSuccess: async () => {
      await refresh()
      toast.success('Card placed in the stand')
      const filled = new Set((bootstrap?.assignments || []).filter(item => item.display_instance_id === selectedInstance).map(item => item.slot_key))
      filled.add(selectedSlot)
      const next = slots.find(slot => !filled.has(slot) && !(slot === '0' && filled.has('primary')))
      if (next) setSelectedSlot(next)
    },
    onError: error => toast.error(error.response?.data?.detail || 'Could not mount that physical copy'),
  })
  const setPoster = useMutation({
    mutationFn: imageId => {
      const transform = {
        position: placement?.transform?.position || { x: 0, y: 1.4, z: 0 },
        rotation: placement?.transform?.rotation || { x: 0, y: 0, z: 0 },
        content: { image_id: imageId },
      }
      return tcgRoomApi.moveFurniture(selectedInstance, { expected_revision: room.revision, transform, snap_anchor: 'wall' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] })
      qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })
      toast.success('Poster updated')
    },
    onError: error => toast.error(error.response?.data?.detail || 'Could not update the poster'),
  })
  const assignment = (bootstrap?.assignments || []).find(item => item.display_instance_id === selectedInstance && (item.slot_key === selectedSlot || (selectedSlot === '0' && item.slot_key === 'primary')))
  const mountedCopy = asList(allCopies).find(copy => copy.id === assignment?.physical_copy_id)
  const mountedCard = cards.get(mountedCopy?.card_id)

  const filledCount = posterMode
    ? (posterContent.image_id ? 1 : 0)
    : (bootstrap.assignments || []).filter(item => item.display_instance_id === selectedInstance).length
  return <div className="tcg-room-display-manager">
    <header><SquareStack size={24} /><div><strong>{selectedDef?.name || (posterMode ? 'Wall poster' : 'Card stand')}</strong><span>{posterMode ? 'Search your Vault and click a photo.' : `${filledCount}/${slotCount} cards · walk to another stand to manage it.`}</span></div></header>
    {!selectedInstance && <div className="tcg-room-empty"><strong>{posterMode ? 'No poster selected' : 'No stand selected'}</strong><span>Walk up to one and press E.</span></div>}
    {posterMode && selectedInstance && <>
      <label className="tcg-room-display-manager__search"><Search size={18} /><input value={photoSearch} onChange={event => setPhotoSearch(event.target.value)} placeholder="Search tags or filename" /></label>
      <div className="tcg-room-display-manager__count">{photos.length.toLocaleString()} of {photoTotal.toLocaleString()} photos</div>
      <div className="tcg-room-display-manager__cards">{photos.map(image => (
        <button key={image.id} disabled={setPoster.isPending} onClick={() => setPoster.mutate(image.id)}>
          <img src={vaultThumb(image)} alt="" loading="lazy" />
          {image.id === posterContent.image_id && <small>On the wall</small>}
        </button>
      ))}
      <div ref={photoSentinel} className="tcg-room-display-manager__more" />
      </div>
      {photoLibrary.isFetchingNextPage && <div className="tcg-room-display-manager__count">Loading more…</div>}
      {!photos.length && !photoLibrary.isFetching && !photoLibrary.hasNextPage && <div className="tcg-room-empty"><strong>No photos match</strong><span>Try a tag or part of a filename.</span></div>}
    </>}
    {!posterMode && selectedInstance && slotCount > 1 && <div className="tcg-room-display-manager__slots">{slots.map(slot => {
      const filled = (bootstrap.assignments || []).some(item => item.display_instance_id === selectedInstance && (item.slot_key === slot || (slot === '0' && item.slot_key === 'primary')))
      return <button key={slot} className={selectedSlot === slot ? 'selected' : ''} onClick={() => { setSelectedSlot(slot); setInspecting(null) }}>{Number(slot) + 1}{filled ? ' •' : ''}</button>
    })}</div>}
    {inspecting && <div className="tcg-room-display-manager__inspect" onMouseMove={event => {
      const box = event.currentTarget.getBoundingClientRect()
      setTilt({ x: ((event.clientY - box.top) / box.height - .5) * -24, y: ((event.clientX - box.left) / box.width - .5) * 28 })
    }}>
      <div style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}><TCGV2CardFace card={inspecting} width={280} showEffects /></div>
      <button className="secondary" onClick={() => setInspecting(null)}>Put back</button>
    </div>}
    {!posterMode && selectedInstance && !inspecting && <>
      <h3>{assignment ? `Slot ${Number(selectedSlot) + 1}` : `Empty slot ${Number(selectedSlot) + 1}`}</h3>
      {mountedCard && <button className="secondary" onClick={() => setInspecting(mountedCard)}>Hold and inspect foil</button>}
      <label className="tcg-room-display-manager__search"><Search size={18} /><input value={cardSearch} onChange={event => setCardSearch(event.target.value)} placeholder="Search your cards" /></label>
      <div className="tcg-room-display-manager__rarities">{['', 'C', 'R', 'SR', 'SPR', 'UR'].map(value => (
        <button key={value || 'all'} type="button" className={rarity === value ? 'selected' : ''} onClick={() => setRarity(value)}>{value || 'All'}</button>
      ))}</div>
      <div className="tcg-room-display-manager__count">{browseCards.length.toLocaleString()} loaded{(cardCatalog.data?.pages?.[0]?.total) ? ` · ${cardCatalog.data.pages[0].total.toLocaleString()} owned` : ''}</div>
      <div className="tcg-room-display-manager__cards">{browseCards.map(row => (
        <button key={row.copy.id} disabled={assign.isPending} onClick={() => assign.mutate(row.copy.id)}>{row.card ? <TCGV2CardFace card={row.card} width="100%" showEffects={false} /> : <span>{row.code}</span>}<small>{row.code}</small></button>
      ))}
      <div ref={cardSentinel} className="tcg-room-display-manager__more" />
      </div>
      {cardCatalog.isFetchingNextPage && <div className="tcg-room-display-manager__count">Loading more…</div>}
      {!browseCards.length && !cardCatalog.isFetching && !cardCatalog.hasNextPage && <div className="tcg-room-empty"><strong>No matching cards</strong><span>Open packs first, or clear the search.</span></div>}
      {assignment && <button className="secondary" onClick={() => tcgRoomApi.assignDisplay({ instance_id: selectedInstance, copy_id: null, slot_key: selectedSlot }).then(refresh)}>Remove from stand</button>}
    </>}
  </div>
}
