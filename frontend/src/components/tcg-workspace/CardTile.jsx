import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'

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
  return <div className="tcgws-archived-face"><span>{card.print_rarity || card.rarity_class}</span><strong>Archived printing</strong><small>Face record incomplete</small></div>
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
  const [mediaReady, setMediaReady] = useState(false)
  useEffect(() => {
    if (!card?.id) return undefined
    setMediaReady(false)
    const fallback = window.setTimeout(() => setMediaReady(true), 1100)
    return () => window.clearTimeout(fallback)
  }, [card?.id])
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
    <article className={`tcgws-card-tile${selected ? ' selected' : ''}`} role="button" aria-selected={selected} tabIndex={0} onClick={event => onSelect ? onSelect(event) : onOpen?.()} onContextMenu={onContextMenu} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen?.() }}>
      <motion.div layoutId={disableLayoutAnimation ? undefined : `tcg-card-${card.id}`} className="tcgws-card-render" onLoadCapture={() => setMediaReady(true)} aria-busy={!mediaReady}>
        <div className="tcgws-card-loading-underlay" aria-hidden="true" />
        <TCGV2CardFace card={card} width="100%" showEffects fallback={<ArchivedFace card={card} />} />
        {!mediaReady && <div className="tcgws-card-loading-cover" aria-label="Loading card art" />}
      </motion.div>
      {selected && <span className="tcgws-selection-mark" aria-hidden="true">✓</span>}
      <div className="tcgws-card-meta">
        <div><strong>{card.display_name || card.creator_name || card.gallery_name}</strong><span>{number || card.catalog_code}</span></div>
        <div className="tcgws-card-flags">
          <b data-rarity={card.print_rarity || card.rarity_class}>{card.print_rarity || card.rarity_class}</b>
          {classification?.badge && <span>{classification.badge}</span>}
          {quantity > 1 && <i>x{quantity}</i>}
        </div>
      </div>
    </article>
  )
}
