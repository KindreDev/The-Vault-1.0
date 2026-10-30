import { LocalizedText, useT } from '../../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { resolveTCGV2CardFace } from '../tcg-v2/cardFaceResolver'

const pendingFaceMounts = []
let faceMountFrame = 0

function flushNextFaceMount() {
  faceMountFrame = 0
  while (pendingFaceMounts.length) {
    const next = pendingFaceMounts.shift()
    if (!next.cancelled) {
      next.mount()
      break
    }
  }
  if (pendingFaceMounts.length) faceMountFrame = window.requestAnimationFrame(flushNextFaceMount)
}

function queueFaceMount(mount) {
  const task = { mount, cancelled: false }
  pendingFaceMounts.push(task)
  if (!faceMountFrame) faceMountFrame = window.requestAnimationFrame(flushNextFaceMount)
  return () => { task.cancelled = true }
}

// One observer shared by every tile instead of one per tile.
const visibilityCallbacks = new Map()
let tileObserver = null

function observeTileOnce(element, onVisible) {
  if (!tileObserver) {
    tileObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = visibilityCallbacks.get(entry.target)
        visibilityCallbacks.delete(entry.target)
        tileObserver.unobserve(entry.target)
        callback?.()
      }
    }, { rootMargin: '160px 0px' })
  }
  visibilityCallbacks.set(element, onVisible)
  tileObserver.observe(element)
  return () => {
    visibilityCallbacks.delete(element)
    tileObserver?.unobserve(element)
  }
}

// Grid tiles are about 200px wide, so they use the server's cached 720px
// preview instead of the full original (often several MB and megapixels).
// The inspector and the room still receive the untouched card.
const FULL_IMAGE_URL = /^\/api\/images\/(\d+)\/file(?:\?.*)?$/

function tileArtUrl(url) {
  const match = typeof url === 'string' ? url.match(FULL_IMAGE_URL) : null
  return match ? `/api/images/${match[1]}/preview?w=720` : url
}

function tileCardFor(card) {
  // Hall of Fame art can be a video; leave it exactly as minted.
  if (!card || card.card_type === 'hof' || card.card_type === 'hall-of-fame') return card
  const next = { ...card, image_url: tileArtUrl(card.image_url), art_url: tileArtUrl(card.art_url) }
  for (const [key, value] of Object.entries(card)) {
    if (!key.endsWith('_visual') || key === 'hof_visual' || !value || typeof value !== 'object') continue
    next[key] = {
      ...value,
      ...(value.art_url ? { art_url: tileArtUrl(value.art_url) } : {}),
      ...(Array.isArray(value.stack_art_urls) ? { stack_art_urls: value.stack_art_urls.map(tileArtUrl) } : {}),
    }
  }
  return next
}

function cardArtworkUrls(card) {
  const face = resolveTCGV2CardFace(card)
  if (!face) return []
  const primaryArt = face.mediaType === 'video'
    ? (face.previewUrl || face.posterUrl || face.artUrl)
    : face.artUrl
  return [...new Set([primaryArt, ...(face.type === 'gallery' ? face.stackArtUrls : [])].filter(Boolean))]
}

function waitForImage(url) {
  return new Promise(resolve => {
    const image = new window.Image()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      image.onload = null
      image.onerror = null
      if (image.naturalWidth && typeof image.decode === 'function') image.decode().catch(() => {}).finally(resolve)
      else resolve()
    }
    image.onload = finish
    image.onerror = finish
    image.src = url
    if (image.complete) finish()
  })
}

const CARD_TYPE_LABELS = {
  image: 'Scene',
  scene: 'Scene',
  gallery: 'Gallery',
  creator: 'Creator',
  character: 'Character',
  cosplay: 'Cosplay',
  collab: 'Collab',
  bond: 'Bond',
  hof: 'Hall of Fame',
}

function ArchivedFace({ card }) {
  return <div className="tcgws-archived-face"><span>{card.print_rarity || card.rarity_class}</span><strong><LocalizedText text={"Archived printing"} /></strong><small><LocalizedText text={"Face record incomplete"} /></small></div>
}

function getMissingIdentity(identity, number) {
  const source = identity || {}
  return {
    number: number || source.display_number || source.collector_number || source.catalog_code || source.card_id || 'Unowned',
    type: CARD_TYPE_LABELS[source.card_type] || CARD_TYPE_LABELS[source.type] || source.card_type || source.type || 'Card',
    name: source.display_name || source.name || source.creator_name || source.character_name || source.gallery_name || 'Unknown card',
    code: source.card_code || null,
    stableId: source.stable_card_id || source.stable_id || source.catalog_code || source.card_id || source.id,
  }
}

export default function CardTile({ card: sourceCard, favorite = false, quantity = 0, number, missing = false, identity, classification, onOpen, selected = false, onSelect, onContextMenu, disableLayoutAnimation = false }) {
  const t = useT()
  const card = useMemo(() => tileCardFor(sourceCard), [sourceCard])
  const tileRef = useRef(null)
  const [shouldRenderFace, setShouldRenderFace] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  useEffect(() => {
    const tile = tileRef.current
    if (!tile) return undefined
    setShouldRenderFace(false)
    let cancelMount = null
    if (!('IntersectionObserver' in window)) {
      setShouldRenderFace(true)
      return undefined
    }
    const stopObserving = observeTileOnce(tile, () => {
      cancelMount = queueFaceMount(() => setShouldRenderFace(true))
    })
    return () => { stopObserving(); cancelMount?.() }
  }, [card?.id])
  useEffect(() => {
    if (!card?.id || !shouldRenderFace) return undefined
    setMediaReady(false)
    let active = true
    const fallback = window.setTimeout(() => { if (active) setMediaReady(true) }, 10000)
    Promise.all(cardArtworkUrls(card).map(waitForImage)).then(() => {
      if (active) setMediaReady(true)
    })
    return () => { active = false; window.clearTimeout(fallback) }
  }, [card, card?.id, shouldRenderFace])
  if (missing || !card) {
    const missingCard = getMissingIdentity(identity, number)
    return (
      <button className="tcgws-card-tile tcgws-missing-card" onClick={onOpen} disabled={!onOpen}>
        <div className="tcgws-card-silhouette"><span>{missingCard.number}</span><small>{missingCard.type}</small></div>
        <strong>{missingCard.code || missingCard.name}</strong>
        <small>{missingCard.code ? missingCard.name : (missingCard.stableId ? `ID ${missingCard.stableId}` : t('Missing printing'))}</small>
      </button>
    )
  }
  return (
    <article ref={tileRef} className={`tcgws-card-tile${selected ? ' selected' : ''}`} role="button" aria-selected={selected} tabIndex={0} onClick={event => onSelect ? onSelect(event) : onOpen?.()} onContextMenu={onContextMenu} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.() } }}>
      <motion.div layoutId={disableLayoutAnimation ? undefined : `tcg-card-${card.id}`} className="tcgws-card-render" aria-busy={!mediaReady}>
        <div className="tcgws-card-loading-underlay" aria-hidden="true" />
        {shouldRenderFace && <TCGV2CardFace card={card} width="100%" showEffects fallback={<ArchivedFace card={card} />} />}
        {!mediaReady && <div className="tcgws-card-loading-cover" aria-label={t("Loading card art")} />}
      </motion.div>
      {selected && <span className="tcgws-selection-mark" aria-hidden="true">✓</span>}
      {favorite && <span className="tcgws-favorite-mark" title={t('Favorite')}><Star size={16} fill="currentColor" /></span>}
      <div className="tcgws-card-meta">
        <div><strong>{card.card_code || card.display_name || card.creator_name || card.gallery_name}</strong><span>{[card.card_code ? (card.display_name || card.creator_name || card.gallery_name) : null, number || card.catalog_code].filter(Boolean).join(' · ')}</span></div>
        <div className="tcgws-card-flags">
          <b data-rarity={card.print_rarity || card.rarity_class}>{card.print_rarity || card.rarity_class}</b>
          {classification?.badge && <span>{classification.badge}</span>}
          {quantity > 1 && <i><LocalizedText text={"x"} />{quantity}</i>}
        </div>
      </div>
    </article>
  )
}
