import { LocalizedText, useT } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search, SquareStack } from 'lucide-react'
import { apiErrorMessage, imagesApi, tcgRoomApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { CARD_HOLDER_ASSETS, LED_DEFAULTS, POSTER_ASSETS, POSTER_FRAMES, displaySlotCount } from './roomLayout'
import { ACCENT_SWATCHES } from './roomLightingSettings'

import { DEFAULT_SOURCE, asList, sourceReady, usePagedSource, useSentinel, vaultThumb } from './roomMedia'
import RoomSourcePicker from './RoomSourcePicker'
import RoomDisplayArrange from './RoomDisplayArrange'

const PAGE = 48

export default function RoomDisplayManager({ context, bootstrap, instanceId = null }) {
  const t = useT()
  const qc = useQueryClient()
  const [selectedInstance, setSelectedInstance] = useState(instanceId)
  const [selectedSlot, setSelectedSlot] = useState('0')
  const [inspecting, setInspecting] = useState(null)
  const [tilt, setTilt] = useState({ x: 8, y: -12 })
  const [cardSearch, setCardSearch] = useState('')
  const [cardQuery, setCardQuery] = useState('')
  const [rarity, setRarity] = useState('')
  const posterMode = context === 'poster'
  const definitions = (bootstrap?.catalog || []).filter(item => posterMode
    ? POSTER_ASSETS.has(item.asset_id)
    : CARD_HOLDER_ASSETS.has(item.asset_id))
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
  // Photos come from a source (search, gallery, creator, playlist); the
  // picker reopens on the last source used for this poster.
  const [posterSource, setPosterSource] = useState(DEFAULT_SOURCE)
  useEffect(() => { setPosterSource(posterContent.source || DEFAULT_SOURCE) }, [selectedInstance]) // eslint-disable-line react-hooks/exhaustive-deps
  const photoLibrary = usePagedSource(posterSource, { enabled: posterMode && sourceReady(posterSource) })
  const photos = photoLibrary.items
  const loadMoreCards = useCallback(() => {
    if (cardCatalog.hasNextPage && !cardCatalog.isFetchingNextPage) cardCatalog.fetchNextPage()
  }, [cardCatalog.fetchNextPage, cardCatalog.hasNextPage, cardCatalog.isFetchingNextPage])
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
    const timer = window.setTimeout(() => setCardQuery(cardSearch.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [cardSearch])
  const assign = useMutation({
    mutationFn: copyId => tcgRoomApi.assignDisplay({ instance_id: selectedInstance, copy_id: copyId, slot_key: selectedSlot }),
    onSuccess: async () => {
      await refresh()
      toast.success(t("Card placed in the stand"))
      const filled = new Set((bootstrap?.assignments || []).filter(item => item.display_instance_id === selectedInstance).map(item => item.slot_key))
      filled.add(selectedSlot)
      const next = slots.find(slot => !filled.has(slot) && !(slot === '0' && filled.has('primary')))
      if (next) setSelectedSlot(next)
    },
    onError: error => toast.error(apiErrorMessage(error, t("Could not mount that physical copy"))),
  })
  const setPoster = useMutation({
    mutationFn: imageId => {
      const transform = {
        position: placement?.transform?.position || { x: 0, y: 1.4, z: 0 },
        rotation: placement?.transform?.rotation || { x: 0, y: 0, z: 0 },
        content: { ...posterContent, image_id: imageId, source: sourceReady(posterSource) ? posterSource : undefined },
      }
      return tcgRoomApi.moveFurniture(selectedInstance, { expected_revision: room.revision, transform, snap_anchor: 'wall' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] })
      qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })
      toast.success(t("Poster updated"))
    },
    onError: error => toast.error(apiErrorMessage(error, t("Could not update the poster"))),
  })
  // Saving any content setting keeps the others (photo, fit, light colour).
  const saveContent = changes => tcgRoomApi.moveFurniture(selectedInstance, {
    expected_revision: room.revision,
    transform: { position: placement?.transform?.position, rotation: placement?.transform?.rotation, content: { ...posterContent, ...changes } },
    snap_anchor: 'wall',
  })
  const posterFrame = POSTER_FRAMES[selectedDef?.asset_id]
  const posterFit = posterContent.fit || posterFrame?.fit || 'contain'
  const setFit = useMutation({
    mutationFn: fit => saveContent({ fit }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }),
    onError: error => toast.error(apiErrorMessage(error, t("Could not update the poster"))),
  })
  // Light colour (trophy box, lightbox).  The custom picker fires on every
  // drag step, so the choice is saved once the player stops for a moment.
  const ledDefault = LED_DEFAULTS[selectedDef?.asset_id]
  const ledColor = posterContent.led_color || ledDefault || '#ffffff'
  const [ledDraft, setLedDraft] = useState(null)
  const saveLed = useMutation({
    mutationFn: color => saveContent({ led_color: color }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] })
      qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })
    },
    onError: error => toast.error(apiErrorMessage(error, t("Could not change the light"))),
    onSettled: () => setLedDraft(null),
  })
  useEffect(() => {
    if (!ledDraft || ledDraft === ledColor) return undefined
    const timer = window.setTimeout(() => saveLed.mutate(ledDraft), 350)
    return () => window.clearTimeout(timer)
  }, [ledDraft]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownLed = ledDraft || ledColor
  const assignment = (bootstrap?.assignments || []).find(item => item.display_instance_id === selectedInstance && (item.slot_key === selectedSlot || (selectedSlot === '0' && item.slot_key === 'primary')))
  const mountedCopy = asList(allCopies).find(copy => copy.id === assignment?.physical_copy_id)
  const mountedCard = cards.get(mountedCopy?.card_id)

  const filledCount = posterMode
    ? (posterContent.image_id ? 1 : 0)
    : (bootstrap.assignments || []).filter(item => item.display_instance_id === selectedInstance).length
  return <div className="tcg-room-display-manager">
    <header><SquareStack size={24} /><div><strong>{selectedDef?.name || t(posterMode ? 'Wall poster' : 'Card stand')}</strong><span>{posterMode ? t('Search your Vault and click a photo.') : t('{current}/{total} cards · walk to another stand to manage it.', { current: filledCount, total: slotCount })}</span></div></header>
    {!selectedInstance && <div className="tcg-room-empty"><strong>{t(posterMode ? 'No poster selected' : 'No stand selected')}</strong><span><LocalizedText text={"Walk up to one and press E."} /></span></div>}
    {posterMode && selectedInstance && <>
      {posterFrame && <div className="tcg-room-display-manager__fit" role="group" aria-label={t("Photo fit")}>
        {[['cover', 'Fill frame'], ['contain', 'Show whole photo']].map(([value, label]) => (
          <button key={value} type="button" className={posterFit === value ? 'selected' : ''} disabled={setFit.isPending}
            onClick={() => posterFit !== value && setFit.mutate(value)}><LocalizedText text={label} /></button>
        ))}
      </div>}
      <RoomSourcePicker value={posterSource} onChange={setPosterSource} />
      {sourceReady(posterSource) && <div className="tcg-room-display-manager__count">{photos.length.toLocaleString()}<LocalizedText text={"of"} before={" "} after={" "} />{photoLibrary.total.toLocaleString()}<LocalizedText text={"photos"} before={" "} /></div>}
      <div className="tcg-room-display-manager__cards">{photos.map(image => (
        <button key={image.id} disabled={setPoster.isPending} onClick={() => setPoster.mutate(image.id)}>
          <img src={vaultThumb(image)} alt="" loading="lazy" />
          {image.id === posterContent.image_id && <small><LocalizedText text={"On the wall"} /></small>}
        </button>
      ))}
      <div ref={photoLibrary.sentinel} className="tcg-room-display-manager__more" />
      </div>
      {photoLibrary.loadingMore && <div className="tcg-room-display-manager__count"><LocalizedText text={"Loading more…"} /></div>}
      {sourceReady(posterSource) && !photos.length && !photoLibrary.loading && <div className="tcg-room-empty"><strong><LocalizedText text={"No photos match"} /></strong><span><LocalizedText text={"Try another search or source."} /></span></div>}
    </>}
    {selectedInstance && ledDefault && placement && <div className="tcg-room-display-manager__led">
      <span><LocalizedText text={"Light color"} /></span>
      <div className="room-settings__swatches">
        {[[ledDefault, ledDefault === '#ffffff' ? 'White' : 'Warm white'], ...ACCENT_SWATCHES.filter(([color]) => color !== ledDefault)].map(([color, name]) => <button key={color} type="button" title={t(name)} aria-label={t(name)}
          className={shownLed.toLowerCase() === color ? 'is-selected' : ''} style={{ '--swatch': color }} onClick={() => setLedDraft(color)} />)}
        <label className="room-settings__custom" title={t('Custom color')} style={{ '--swatch': shownLed }}>
          <input type="color" value={shownLed} aria-label={t('Custom color')} onChange={event => setLedDraft(event.target.value.toLowerCase())} />
        </label>
      </div>
    </div>}
    {!posterMode && selectedInstance && slotCount > 1 && <RoomDisplayArrange instanceId={selectedInstance} onDone={refresh} />}
    {!posterMode && selectedInstance && slotCount > 1 && <div className="tcg-room-display-manager__slots">{slots.map(slot => {
      const filled = (bootstrap.assignments || []).some(item => item.display_instance_id === selectedInstance && (item.slot_key === slot || (slot === '0' && item.slot_key === 'primary')))
      return <button key={slot} className={selectedSlot === slot ? 'selected' : ''} onClick={() => { setSelectedSlot(slot); setInspecting(null) }}>{Number(slot) + 1}{filled ? ' •' : ''}</button>
    })}</div>}
    {inspecting && <div className="tcg-room-display-manager__inspect" onMouseMove={event => {
      const box = event.currentTarget.getBoundingClientRect()
      setTilt({ x: ((event.clientY - box.top) / box.height - .5) * -24, y: ((event.clientX - box.left) / box.width - .5) * 28 })
    }}>
      <div style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}><TCGV2CardFace card={inspecting} width={280} showEffects videoPresentation="full" /></div>
      <button className="secondary" onClick={() => setInspecting(null)}><LocalizedText text={"Put back"} /></button>
    </div>}
    {!posterMode && selectedInstance && !inspecting && <>
      <h3>{assignment ? `Slot ${Number(selectedSlot) + 1}` : `Empty slot ${Number(selectedSlot) + 1}`}</h3>
      {mountedCard && <button className="secondary" onClick={() => setInspecting(mountedCard)}><LocalizedText text={"Hold and inspect foil"} /></button>}
      <label className="tcg-room-display-manager__search"><Search size={18} /><input value={cardSearch} onChange={event => setCardSearch(event.target.value)} placeholder={t("Search your cards")} /></label>
      <div className="tcg-room-display-manager__rarities">{['', 'C', 'R', 'SR', 'SPR', 'UR'].map(value => (
        <button key={value || 'all'} type="button" className={rarity === value ? 'selected' : ''} onClick={() => setRarity(value)}>{value || 'All'}</button>
      ))}</div>
      <div className="tcg-room-display-manager__count">{browseCards.length.toLocaleString()}<LocalizedText text={"loaded"} before={" "} />{(cardCatalog.data?.pages?.[0]?.total) ? ` · ${cardCatalog.data.pages[0].total.toLocaleString()} owned` : ''}</div>
      <div className="tcg-room-display-manager__cards">{browseCards.map(row => (
        <button key={row.copy.id} disabled={assign.isPending} onClick={() => assign.mutate(row.copy.id)}>{row.card ? <TCGV2CardFace card={row.card} width="100%" showEffects={false} /> : <span>{row.code}</span>}<small>{row.code}</small></button>
      ))}
      <div ref={cardSentinel} className="tcg-room-display-manager__more" />
      </div>
      {cardCatalog.isFetchingNextPage && <div className="tcg-room-display-manager__count"><LocalizedText text={"Loading more…"} /></div>}
      {!browseCards.length && !cardCatalog.isFetching && !cardCatalog.hasNextPage && <div className="tcg-room-empty"><strong><LocalizedText text={"No matching cards"} /></strong><span><LocalizedText text={"Open packs first, or clear the search."} /></span></div>}
      {assignment && <button className="secondary" onClick={() => tcgRoomApi.assignDisplay({ instance_id: selectedInstance, copy_id: null, slot_key: selectedSlot }).then(refresh)}><LocalizedText text={"Remove from stand"} /></button>}
    </>}
  </div>
}
