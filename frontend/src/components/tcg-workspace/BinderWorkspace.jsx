import { LocalizedText, useT } from '../../i18n'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Image, Library, Pencil, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import './binder-workspace-premium.css'

const MATERIALS = [
  ['obsidian', 'Obsidian leather', '/binder-obsidian-leather.png'],
  ['canvas-violet', 'Violet canvas', '/binder-canvas-violet.png'],
  ['opaline', 'Opaline vinyl', '/binder-opaline.png'],
  ['rose-metal', 'Rose metal', '/binder-rose-metal.png'],
]

function materialUrl(style) {
  return MATERIALS.find(([id]) => id === style)?.[2] || MATERIALS[0][2]
}

function CoverImage({ binder, className = '' }) {
  return <div className={`tcgws-binder-cover-photo ${className}`}>
    {binder.cover_image_url
      ? <img src={binder.cover_image_url} alt="" style={{ objectPosition: `${binder.cover_x * 100}% ${binder.cover_y * 100}%`, transform: `scale(${binder.cover_scale})` }} />
      : <Library size={44} />}
  </div>
}

function BinderCover({ binder, onOpen, onCustomize }) {
  return <motion.article layoutId={`binder-${binder.id}`} className="tcgws-binder-cover" style={{ '--binder-material': `url(${materialUrl(binder.cover_style)})` }} whileHover={{ y: -10, rotateY: -4 }}>
    <div className="tcgws-binder-visual" aria-hidden="true">
      <span className="tcgws-binder-spine" />
      <CoverImage binder={binder} />
      <div className="tcgws-binder-label"><strong>{binder.name}</strong><span>{binder.card_count}<LocalizedText text={"cards"} before={" "} /></span></div>
    </div>
    <button type="button" className="tcgws-binder-open" onClick={onOpen} aria-label={`Open ${binder.name}`} />
    <button type="button" className="tcgws-binder-edit" onClick={onCustomize} title={`Customize ${binder.name}`} aria-label={`Customize ${binder.name}`}><Pencil size={17} /></button>
  </motion.article>
}

function Pocket({ slot, placed, onPlace, onOpen }) {
  return <button className={`tcgws-physical-pocket ${placed?.card ? 'filled' : ''}`} onClick={() => placed?.card ? onOpen(placed.card) : onPlace(slot)}>
    {placed?.card
      ? <motion.div layoutId={`tcg-card-${placed.card.id}`} className="tcgws-pocket-card"><TCGV2CardFace card={placed.card} width="100%" showEffects={false} /></motion.div>
      : <><Plus size={22} /><span><LocalizedText text={"Slot"} after={" "} />{slot}</span></>}
    <i aria-hidden="true" />
  </button>
}

function BinderPage({ pageNumber, slots, onPlace, onOpen, side, className = '' }) {
  const map = new Map(slots.filter(slot => slot.page_number === pageNumber).map(slot => [slot.slot_number, slot]))
  return <div className={`tcgws-physical-page ${side} ${className}`}>
    <div className="tcgws-pocket-grid">
      {Array.from({ length: 9 }, (_, index) => <Pocket key={index + 1} slot={index + 1} placed={map.get(index + 1)} onPlace={slot => onPlace(pageNumber, slot)} onOpen={onOpen} />)}
    </div>
    <span className="tcgws-page-number">{pageNumber}</span>
  </div>
}

function coverPhotoFromCard(card) {
  const match = String(card?.image_url || '').match(/\/api\/images\/(\d+)\/file(?:$|\?)/)
  const id = Number(card?.source_image_id || match?.[1])
  const url = card?.thumb_url || card?.image_url
  if (!id || !url) return null
  return {
    id,
    image_url: url,
    label: card.display_name || card.gallery_name || card.creator_name || card.catalog_code || 'Vault photo',
    search: `${card.display_name || ''} ${card.gallery_name || ''} ${card.creator_name || ''} ${card.catalog_code || ''}`.toLowerCase(),
  }
}

function CoverPicker({ photos, selectedId, loading, loadingMore, hasMore, total, query, onQuery, onLoadMore, onPick }) {
  const t = useT()
  return <div className="tcgws-cover-picker">
    <header><div><strong><LocalizedText text={"Choose a Vault photo"} /></strong><span>{photos.length}<LocalizedText text={"photos loaded"} before={" "} />{total ? ` from ${total} matching cards` : ''}</span></div></header>
    <input autoFocus value={query} onChange={event => onQuery(event.target.value)} placeholder={t("Search your owned cards")} />
    {loading ? <div className="tcgws-cover-picker-empty"><LocalizedText text={"Loading owned cards..."} /></div> : photos.length ? <>
      <div>{photos.map(photo => <button type="button" key={photo.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-vault-image-id', String(photo.id)) }} className={photo.id === selectedId ? 'selected' : ''} onClick={() => onPick(photo)} title={photo.label}>
        <img src={photo.image_url} alt={photo.label} loading="lazy" />
      </button>)}</div>
      {hasMore && <button type="button" className="tcgws-cover-picker__more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Loading more...' : 'Load more owned cards'}</button>}
    </> : <div className="tcgws-cover-picker-empty"><LocalizedText text={"No owned cards match that search."} /></div>}
  </div>
}

function CardPicker({ inventory, onPick, onClose }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const cards = inventory.filter(card => `${card.display_name || ''} ${card.creator_name || ''} ${card.gallery_name || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <motion.div className="tcgws-binder-picker" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}>
    <header><div><strong><LocalizedText text={"Choose a card"} /></strong><span>{cards.length}<LocalizedText text={"owned printings"} before={" "} /></span></div><button onClick={onClose} title={t("Close")}><X size={20} /></button></header>
    <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search your collection")} />
    <div>{cards.slice(0, 80).map(card => <button key={card.id} onClick={() => onPick(card.id)} title={card.display_name || card.creator_name}>
      <TCGV2CardFace card={card} width="100%" showEffects={false} />
    </button>)}</div>
  </motion.div>
}

function BinderCustomizer({ binder, inventory, coverPhotos, coverPhotosLoading, coverPhotosLoadingMore, coverPhotosHasMore, coverPhotosTotal, coverSearch, onCoverSearch, onLoadMoreCovers, onSave, onClose, busy }) {
  const t = useT()
  const [name, setName] = useState(binder.name || '')
  const [material, setMaterial] = useState(binder.cover_style || 'obsidian')
  const [cover, setCover] = useState(binder.cover_image_id ? { id: binder.cover_image_id, image_url: binder.cover_image_url, label: 'Selected Vault photo' } : null)
  const [coverX, setCoverX] = useState(Number(binder.cover_x || 0.5) * 100)
  const [coverY, setCoverY] = useState(Number(binder.cover_y || 0.5) * 100)
  const [coverScale, setCoverScale] = useState(Number(binder.cover_scale || 1))
  const [showCovers, setShowCovers] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const photos = useMemo(() => (Array.isArray(coverPhotos) ? coverPhotos : inventory.map(coverPhotoFromCard).filter(Boolean)), [coverPhotos, inventory])
  const chooseCover = photo => { setCover(photo); setShowCovers(false); setIsDragOver(false) }
  const dropCover = event => {
    event.preventDefault()
    const id = Number(event.dataTransfer.getData('application/x-vault-image-id'))
    const photo = photos.find(item => item.id === id)
    if (photo) chooseCover(photo)
    else setIsDragOver(false)
  }
  return <motion.div className="tcgws-binder-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.section className="tcgws-binder-modal" initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .97 }} role="dialog" aria-modal="true" aria-labelledby="binder-customizer-title">
      <header><div><span><LocalizedText text={"Binder details"} /></span><h2 id="binder-customizer-title"><LocalizedText text={"Customize"} after={" "} />{binder.name}</h2></div><button onClick={onClose} title={t("Close")}><X size={20} /></button></header>
      <label><span><LocalizedText text={"Binder name"} /></span><input value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="tcgws-material-picker"><span className="tcgws-field-label"><LocalizedText text={"Material"} /></span>{MATERIALS.map(([id, label, url]) => <button key={id} className={material === id ? 'active' : ''} onClick={() => setMaterial(id)} title={label} style={{ backgroundImage: `url(${url})` }}><span>{label}</span>{material === id && <Check size={17} />}</button>)}</div>
      <button type="button" className="tcgws-cover-choice" onClick={() => setShowCovers(value => !value)}><Image size={18} />{cover ? 'Change Vault photo' : 'Choose a Vault photo'}</button>
      {showCovers && <CoverPicker photos={photos} selectedId={cover?.id} loading={coverPhotosLoading} loadingMore={coverPhotosLoadingMore} hasMore={coverPhotosHasMore} total={coverPhotosTotal} query={coverSearch} onQuery={onCoverSearch} onLoadMore={onLoadMoreCovers} onPick={chooseCover} />}
      {cover && <div className="tcgws-cover-editor"><div className={`tcgws-selected-cover${isDragOver ? ' is-drag-over' : ''}`} aria-label={t("Selected Vault cover photo. Drop a Vault photo here to replace it.")} onDragOver={event => { event.preventDefault(); setIsDragOver(true) }} onDragLeave={() => setIsDragOver(false)} onDrop={dropCover}><div><img src={cover.image_url} alt={cover.label || ''} style={{ objectPosition: `${coverX}% ${coverY}%`, transform: `scale(${coverScale})` }} /></div></div><label><span><LocalizedText text={"Horizontal crop"} /></span><input type="range" min="0" max="100" value={coverX} onChange={event => setCoverX(Number(event.target.value))} /></label><label><span><LocalizedText text={"Vertical crop"} /></span><input type="range" min="0" max="100" value={coverY} onChange={event => setCoverY(Number(event.target.value))} /></label><label><span><LocalizedText text={"Cover zoom"} /></span><input type="range" min="1" max="3" step="0.05" value={coverScale} onChange={event => setCoverScale(Number(event.target.value))} /></label></div>}
      <footer><button className="tcgws-secondary" onClick={onClose}><LocalizedText text={"Cancel"} /></button><button className="tcgws-primary" disabled={!name.trim() || busy} onClick={() => onSave({ name, cover_style: material, cover_image_id: cover?.id || null, cover_x: coverX / 100, cover_y: coverY / 100, cover_scale: coverScale })}>{busy ? 'Saving...' : 'Save binder'}</button></footer>
    </motion.section>
  </motion.div>
}

export default function BinderWorkspace({ inventory, onOpenCard }) {
  const t = useT()
  const qc = useQueryClient()
  const room = useRef(null)
  const [selected, setSelected] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const [customizing, setCustomizing] = useState(null)
  const [spread, setSpread] = useState(0)
  const [direction, setDirection] = useState(1)
  const [isTurning, setIsTurning] = useState(false)
  const [target, setTarget] = useState(null)
  const [shelfPage, setShelfPage] = useState(0)
  const [coverSearch, setCoverSearch] = useState('')
  const deferredCoverSearch = useDeferredValue(coverSearch.trim())
  const turnTimer = useRef(null)
  const { data: binders = [], isLoading } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(r => r.data) })
  const {
    data: coverCatalog,
    isLoading: coverPhotosLoading,
    isFetchingNextPage: coverPhotosLoadingMore,
    hasNextPage: coverPhotosHasMore,
    fetchNextPage: loadMoreCovers,
  } = useInfiniteQuery({
    queryKey: ['tcg-v2-binder-cover-photos', deferredCoverSearch],
    queryFn: ({ pageParam = 0 }) => tcgV2Api.catalog({ ownership: 'owned', search: deferredCoverSearch || undefined, skip: pageParam, limit: 250 }).then(r => r.data),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + (page.items?.length || 0), 0)
      return loaded < (lastPage.total || 0) ? loaded : undefined
    },
    enabled: Boolean(customizing),
  })
  const { data: binder } = useQuery({ queryKey: ['tcg-v2-binder', selected], queryFn: () => tcgV2Api.binder(selected).then(r => r.data), enabled: Boolean(selected) })
  const coverPhotos = useMemo(() => {
    const byImage = new Map()
    for (const page of coverCatalog?.pages || []) {
      for (const item of page.items || []) {
        const photo = coverPhotoFromCard(item.card)
        if (photo && !byImage.has(photo.id)) byImage.set(photo.id, photo)
      }
    }
    return [...byImage.values()]
  }, [coverCatalog])
  const coverPhotosTotal = coverCatalog?.pages?.[0]?.total || 0
  const shelfPageCount = Math.max(1, Math.ceil(binders.length / 9))
  const visibleBinders = binders.slice(shelfPage * 9, shelfPage * 9 + 9)
  const shelfBays = useMemo(() => {
    return visibleBinders.map(item => [item])
  }, [visibleBinders])
  const update = useMutation({
    mutationFn: values => tcgV2Api.updateBinder(customizing.id, values),
    onSuccess: () => { setCustomizing(null); qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-binder', customizing.id] }); toast.success(t('Binder updated')) },
    onError: error => toast.error(error.response?.data?.detail || t("Could not update binder")),
  })
  const place = useMutation({
    mutationFn: cardId => tcgV2Api.setBinderSlot(selected, { page_number: target.page, slot_number: target.slot, card_id: cardId }),
    onSuccess: () => { setTarget(null); qc.invalidateQueries({ queryKey: ['tcg-v2-binder', selected] }); qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] }) },
    onError: error => toast.error(error.response?.data?.detail || t("Could not place card")),
  })
  const pages = useMemo(() => [spread * 2 + 1, spread * 2 + 2], [spread])
  const turn = amount => {
    if (isTurning) return
    const nextSpread = Math.max(0, spread + amount)
    if (nextSpread === spread) return
    setDirection(amount)
    setIsTurning(true)
    turnTimer.current = window.setTimeout(() => { setSpread(nextSpread); setIsTurning(false); turnTimer.current = null }, 430)
  }
  const closeBinder = () => {
    if (turnTimer.current) window.clearTimeout(turnTimer.current)
    turnTimer.current = null
    setIsTurning(false)
    setTarget(null)
    setSpread(0)
    setIsClosing(true)
  }
  useEffect(() => { if (selected) room.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [selected])
  useEffect(() => { setShelfPage(page => Math.min(page, shelfPageCount - 1)) }, [shelfPageCount])
  useEffect(() => () => { if (turnTimer.current) window.clearTimeout(turnTimer.current) }, [])

  if (isLoading) return <div className="tcgws-binder-loading"><i /><span><LocalizedText text={"Opening the binder cabinet..."} /></span></div>
  return <section ref={room} className="tcgws-binder-room">
      {(!selected || isClosing) && <motion.div key="shelf" className="tcgws-binder-shelf" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="tcgws-shelf-toolbar"><div><span><LocalizedText text={"Binder shelf"} /></span><strong>{binders.length}<LocalizedText text={"binders"} before={" "} /></strong></div>{shelfPageCount > 1 && <nav aria-label={t("Binder shelf pages")}><button type="button" disabled={shelfPage === 0} onClick={() => setShelfPage(page => page - 1)}><ChevronLeft size={18} /><LocalizedText text={"Previous"} before={" "} /></button><span><LocalizedText text={"Page"} after={" "} />{shelfPage + 1}<LocalizedText text={"of"} before={" "} after={" "} />{shelfPageCount}</span><button type="button" disabled={shelfPage === shelfPageCount - 1} onClick={() => setShelfPage(page => page + 1)}><LocalizedText text={"Next"} after={" "} /><ChevronRight size={18} /></button></nav>}</div>
        <div className="tcgws-shelf-grid">{shelfBays.map((bay, bayIndex) => <div key={bayIndex} className={`tcgws-shelf-bay${bay.length > 1 ? ' is-double' : ''}`}>
          {bay.map(item => <BinderCover key={item.id} binder={item} onOpen={() => { setSpread(0); setIsClosing(false); setSelected(item.id) }} onCustomize={() => { setCoverSearch(''); setCustomizing(item) }} />)}
        </div>)}</div>
        {!binders.length && <div className="tcgws-empty-shelf"><Library size={28} /><strong><LocalizedText text={"Your shelf is empty"} /></strong><span><LocalizedText text={"Visit Shop to claim your first binder."} /></span><a href="?view=workshop"><LocalizedText text={"Open Shop"} /></a></div>}
      </motion.div>}
      {selected && <motion.div key="open" className={`tcgws-open-binder${isClosing ? ' is-closing' : ''}`} initial={{ opacity: 0, scale: .9 }} animate={isClosing ? { opacity: 0, scale: .93 } : { opacity: 1, scale: 1 }} onAnimationComplete={() => { if (isClosing) { setSelected(null); setIsClosing(false) } }}>
        <header><button onClick={closeBinder}><ArrowLeft size={19} /><LocalizedText text={"Close binder"} before={" "} /></button><div><span>{binder?.cover_style || 'Loading cover'}</span><h1>{binder?.name || 'Opening...'}</h1></div><div><button onClick={() => turn(-1)} disabled={spread === 0 || isTurning} title={t("Previous spread")}><ChevronLeft size={22} /></button><strong>{pages[0]}-{pages[1]}</strong><button onClick={() => turn(1)} disabled={isTurning} title={t("Next spread")}><ChevronRight size={22} /></button></div></header>
        <div className="tcgws-binder-desk" style={{ '--binder-material': `url(${materialUrl(binder?.cover_style)})` }}>
          <div className="tcgws-binder-spread">
            <BinderPage pageNumber={pages[0]} slots={binder?.slots || []} side="left" className={isTurning && direction < 0 ? 'is-under-turn' : ''} onPlace={(page, slot) => setTarget({ page, slot })} onOpen={onOpenCard} />
            <div className="tcgws-binder-rings">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
            <BinderPage pageNumber={pages[1]} slots={binder?.slots || []} side="right" className={isTurning && direction > 0 ? 'is-under-turn' : ''} onPlace={(page, slot) => setTarget({ page, slot })} onOpen={onOpenCard} />
          </div>
          <AnimatePresence initial={false}>{isTurning && <motion.div key={`${spread}-${direction}`} className={`tcgws-page-turn ${direction > 0 ? 'turn-right-page' : 'turn-left-page'}`} initial={{ rotateY: 0 }} animate={{ rotateY: direction > 0 ? -180 : 180 }} exit={{ opacity: 0 }} transition={{ duration: .43, ease: [0.22, 1, 0.36, 1] }}><BinderPage pageNumber={direction > 0 ? pages[1] : pages[0]} slots={binder?.slots || []} side={direction > 0 ? 'right' : 'left'} onPlace={() => {}} onOpen={onOpenCard} /></motion.div>}</AnimatePresence>
        </div>
        <AnimatePresence>{target && <CardPicker inventory={inventory} onPick={id => place.mutate(id)} onClose={() => setTarget(null)} />}</AnimatePresence>
      </motion.div>}
    <AnimatePresence>{customizing && <BinderCustomizer binder={customizing} inventory={inventory} coverPhotos={coverPhotos} coverPhotosLoading={coverPhotosLoading} coverPhotosLoadingMore={coverPhotosLoadingMore} coverPhotosHasMore={coverPhotosHasMore} coverPhotosTotal={coverPhotosTotal} coverSearch={coverSearch} onCoverSearch={setCoverSearch} onLoadMoreCovers={() => loadMoreCovers()} onSave={values => update.mutate(values)} onClose={() => setCustomizing(null)} busy={update.isPending} />}</AnimatePresence>
  </section>
}
