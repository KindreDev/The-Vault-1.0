import { LocalizedText, useT } from '../../i18n'
import ModalLayer from '../ModalLayer'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Image as ImageIcon, RotateCcw, Star, User, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import CardTab from './inspector/CardTab'
import ContentTab from './inspector/ContentTab'
import CollectionTab from './inspector/CollectionTab'
import EditTab from './inspector/EditTab'
import CardBack from './inspector/CardBack'
import { RARITY_NAMES, SPICE_META, cardTypeLabel } from './inspector/inspectorMeta'
import './inspector/card-inspector.css'

// The card window: the card on the left; on the right what it is, your history
// with it, what is in it and where it sits in your collection.

const TABS = ['Card', 'Content', 'Collection']
const ADVANCED_TABS = [...TABS, 'Edit']
const LINK_ICONS = { 'Source media': ImageIcon, 'Source gallery': FolderOpen, 'Creator profile': User }
const LINK_LABELS = { 'Source media': 'Open file', 'Source gallery': 'Gallery', 'Creator profile': 'Profile' }

function ArchivedFace({ card }) {
  return <div className="tcgws-archived-face tcgws-archived-face--large"><span>{card.print_rarity || card.rarity_class}</span><strong><LocalizedText text={"Archived printing"} /></strong><small><LocalizedText text={"This card's artwork is not available."} /></small></div>
}

function Links({ links, onInternal }) {
  const t = useT()
  if (!links?.length) return null
  return <div className="tcgcw-links">
    {links.map(link => {
      const internal = link.url.startsWith('/')
      const Icon = LINK_ICONS[link.label] || ExternalLink
      const label = t(LINK_LABELS[link.label] || link.label)
      return internal
        ? <button type="button" key={link.url} onClick={() => onInternal(link.url)}><Icon size={15} />{label}</button>
        : <a key={link.url} href={link.url} target="_blank" rel="noreferrer"><Icon size={15} />{label}</a>
    })}
  </div>
}

export default function CardInspector({ card, onClose, advanced, classificationValues, disableLayoutAnimation = false, onPrev = null, onNext = null }) {
  const t = useT()
  const navigate = useNavigate()
  const [tab, setTab] = useState('Card')
  const [flipped, setFlipped] = useState(false)
  useEffect(() => setFlipped(false), [card.id])
  const tabs = advanced ? ADVANCED_TABS : TABS
  const qc = useQueryClient()
  const favorite = useMutation({
    mutationFn: value => tcgV2Api.setFavorite(card.id, value).then(r => r.data),
    onSuccess: data => {
      qc.setQueryData(['tcg-v2-card', card.id], old => old ? { ...old, favorite: data.favorite } : old)
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
    },
    onError: error => toast.error(error.response?.data?.detail || t('Could not update favorite')),
  })
  const activeTab = tabs.includes(tab) ? tab : 'Card'
  // Arrow keys step through the cards of the grid the window was opened from.
  useEffect(() => {
    const onKey = event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [role="listbox"], [role="slider"]')) return
      if (event.key === 'ArrowLeft' && onPrev) { event.preventDefault(); onPrev() }
      if (event.key === 'ArrowRight' && onNext) { event.preventDefault(); onNext() }
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrev, onNext, onClose])
  const { data: detail, isLoading } = useQuery({ queryKey: ['tcg-v2-card', card.id], queryFn: () => tcgV2Api.cardDetail(card.id).then(r => r.data) })

  const face = detail?.card || card
  const rarity = face.print_rarity || face.rarity_class
  const spice = SPICE_META[detail?.profile?.spice]
  const name = face.display_name || face.creator_name || face.gallery_name || face.card_code
  const printing = detail?.relationships?.[0]
  const subtitle = [
    t(cardTypeLabel(face.card_type)),
    printing ? `${printing.release_name} #${String(printing.collector_position).padStart(3, '0')}${printing.collector_suffix}` : face.catalog_code,
    face.card_code,
  ].filter(Boolean).join(' · ')
  const openInternal = url => { onClose(); navigate(url) }

  // The regular collection route lives beneath Layout's transformed Framer
  // Motion wrapper. Portal that inspector to body so fixed inset:0 is measured
  // against the usable viewport instead of the route's content box. The room
  // computer keeps its local mount so its themed screen styles still apply.
  const inspector = <motion.div className="tcgws-inspector-backdrop" style={!disableLayoutAnimation ? { '--tcg-line': 'rgba(255,255,255,.1)', '--tcg-muted': 'rgba(255,255,255,.52)' } : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.section className="tcgws-inspector tcgcw" initial={{ opacity: 0, scale: 0.96, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 12 }} transition={{ type: 'spring', stiffness: 260, damping: 25 }}>
      <div className="tcgcw-controls">
        {onPrev && <button type="button" onClick={onPrev} title={t('Previous card')} aria-label={t('Previous card')}><ChevronLeft size={20} /></button>}
        {onNext && <button type="button" onClick={onNext} title={t('Next card')} aria-label={t('Next card')}><ChevronRight size={20} /></button>}
        <button type="button" onClick={onClose} title={t('Close')} aria-label={t('Close')}><X size={20} /></button>
      </div>
      <motion.div layoutId={disableLayoutAnimation ? undefined : `tcg-card-${card.id}`} className="tcgws-inspector-card">
        <div className={`tcgcw-flip${flipped ? ' is-flipped' : ''}`} style={{ '--tcgcw-card-width': 'min(36vw, 520px)' }}>
          <div className="tcgcw-flip__front" aria-hidden={flipped}><TCGV2CardFace card={detail ? { ...detail.card, presentation_override: detail.presentation_override } : card} width="min(36vw, 520px)" showEffects={!flipped} videoPresentation="full" fallback={<ArchivedFace card={card} />} /></div>
          <div className="tcgcw-flip__back" aria-hidden={!flipped}>{detail && <CardBack detail={detail} name={name} />}</div>
        </div>
        <button type="button" className="tcgcw-flip-button" onClick={() => setFlipped(value => !value)} disabled={!detail}>
          <RotateCcw size={16} />{t(flipped ? 'Show the front' : 'Flip card')}
        </button>
      </motion.div>
      <div className="tcgws-inspector-info">
        <header className="tcgcw-header">
          <div className="tcgcw-badges">
            <b data-rarity={rarity}>{t(RARITY_NAMES[rarity] || rarity)}</b>
            {spice && <b style={{ '--tcgcw-tone': spice.color }} className="is-toned">{t(spice.label)}</b>}
            {face.prestige && <b className="is-prestige">{t('Prestige')}</b>}
          </div>
          <h2>{name}</h2>
          <p>{subtitle}</p>
          <div className="tcgcw-actions">
            <button type="button" className={`tcgcw-favorite${detail?.favorite ? ' is-on' : ''}`} disabled={!detail || favorite.isPending}
                    aria-pressed={Boolean(detail?.favorite)} onClick={() => favorite.mutate(!detail?.favorite)}>
              <Star size={16} fill={detail?.favorite ? 'currentColor' : 'none'} />{t('Favorite')}
            </button>
            <Links links={detail?.source_links} onInternal={openInternal} />
          </div>
        </header>
        <nav>{tabs.map(item => <button key={item} onClick={() => setTab(item)} className={activeTab === item ? 'active' : ''}>{t(item)}</button>)}</nav>
        <div className="tcgws-inspector-panel">
          {isLoading && <p className="tcgcw-quiet"><LocalizedText text={"Loading card..."} /></p>}
          <AnimatePresence mode="wait" initial={false}>
            {detail && <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
              {activeTab === 'Card' && <CardTab detail={detail} />}
              {activeTab === 'Content' && <ContentTab detail={detail} />}
              {activeTab === 'Collection' && <CollectionTab detail={detail} />}
              {activeTab === 'Edit' && <EditTab detail={detail} values={classificationValues} advanced={advanced} />}
            </motion.div>}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  </motion.div>
  // The room computer keeps its local mount; everywhere else the window
  // renders through ModalLayer (portal to <body> plus scroll lock).
  return disableLayoutAnimation ? inspector : <ModalLayer>{inspector}</ModalLayer>
}
