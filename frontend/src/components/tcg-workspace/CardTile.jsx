import { LocalizedText, useT } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
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
    stableId: source.stable_card_id || source.stable_id || source.catalog_code || source.card_id || source.id,
  }
}

export default function CardTile({ card, quantity = 0, number, missing = false, identity, classification, onOpen, selected = false, onSelect, onContextMenu, disableLayoutAnimation = false }) {
  const t = useT()
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
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        cancelMount = queueFaceMount(() => setShouldRenderFace(true))
      }
    }, { rootMargin: '160px 0px' })
    observer.observe(tile)
    return () => { observer.disconnect(); cancelMount?.() }
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
        <strong>{missingCard.name}</strong>
        <small>{missingCard.stableId ? `ID ${missingCard.stableId}` : 'Missing printing'}</small>
      </button>
    )
  }
  return (
    <article ref={tileRef} className={`tcgws-card-tile${selected ? ' selected' : ''}`} role="button" aria-selected={selected} tabIndex={0} onClick={event => onSelect ? onSelect(event) : onOpen?.()} onContextMenu={onContextMenu} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen?.() }}>
      <motion.div layoutId={disableLayoutAnimation ? undefined : `tcg-card-${card.id}`} className="tcgws-card-render" aria-busy={!mediaReady}>
        <div className="tcgws-card-loading-underlay" aria-hidden="true" />
        {shouldRenderFace && <TCGV2CardFace card={card} width="100%" showEffects fallback={<ArchivedFace card={card} />} />}
        {!mediaReady && <div className="tcgws-card-loading-cover" aria-label={t("Loading card art")} />}
      </motion.div>
      {selected && <span className="tcgws-selection-mark" aria-hidden="true">✓</span>}
      <div className="tcgws-card-meta">
        <div><strong>{card.display_name || card.creator_name || card.gallery_name}</strong><span>{number || card.catalog_code}</span></div>
        <div className="tcgws-card-flags">
          <b data-rarity={card.print_rarity || card.rarity_class}>{card.print_rarity || card.rarity_class}</b>
          {classification?.badge && <span>{classification.badge}</span>}
          {quantity > 1 && <i><LocalizedText text={"x"} />{quantity}</i>}
        </div>
      </div>
    </article>
  )
}
