import { LocalizedText, useT } from '../../i18n'
import ModalLayer from '../ModalLayer'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink, Star, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { cardMasksApi, tcgRoomApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { formatHofAwardDescription } from './hofProvenance'
import TCGSelect from './TCGSelect'

const BASIC_TABS = ['Overview', 'Copies', 'Sets', 'Tags']
// Classification overrides, the card editor and the mint audit are tools, not card details.
const ADVANCED_TABS = ['Overview', 'Copies', 'Sets', 'Tags', 'Classification', 'Editor', 'Rarity']
const RARITY_NAMES = { C: 'Common', R: 'Rare', SR: 'Super Rare', UR: 'Ultra Rare', SPR: 'Signature Rare' }
const COPY_LOCATIONS = {
  unorganized_pile: 'In the room pile', carried: 'Carried in the room', binder_slot: 'In a binder',
  cabinet_slot: 'In a display cabinet', display_stand: 'On a display stand', traded_away: 'Traded away',
}
const CARD_TYPE_LABELS = { image: 'Scene', scene: 'Scene', gallery: 'Gallery', creator: 'Creator', character: 'Character', cosplay: 'Cosplay', collab: 'Collab', bond: 'Bond', hof: 'Hall of Fame' }

function cardTypeLabel(value) {
  return CARD_TYPE_LABELS[value] || value || 'Card'
}

function ArchivedFace({ card }) {
  return <div className="tcgws-archived-face tcgws-archived-face--large"><span>{card.print_rarity || card.rarity_class}</span><strong><LocalizedText text={"Archived printing"} /></strong><small><LocalizedText text={"This card's artwork is not available."} /></small></div>
}

function Field({ label, value }) {
  return <div className="tcgws-field"><span>{label}</span><strong>{value ?? 'Unknown'}</strong></div>
}

// Where each value came from: your override or the AI.
function sourceLabel(source) {
  if (source === 'manual') return 'Set by you'
  if (source === 'omitted') return 'Not shown'
  if (source === 'unknown') return "AI wasn't sure"
  return 'AI'
}

function ClassificationEditor({ detail, values, advanced }) {
  const t = useT()
  const qc = useQueryClient()
  const [exposure, setExposure] = useState(detail.classification.manual.exposure || 'AI')
  const [intensity, setIntensity] = useState(detail.classification.manual.intensity || 'AI')
  const mutation = useMutation({
    mutationFn: () => tcgV2Api.classifyCard(detail.card.id, { exposure, intensity }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
      toast.success(t("Classification saved"))
    },
    onError: error => toast.error(error.response?.data?.detail || t("Could not save classification")),
  })
  const exposureOmitted = detail.classification.sources.exposure === 'omitted'
  return (
    <div className="tcgws-classification">
      <div className="tcgws-axis">
        <header><div><span><LocalizedText text={"Exposure"} /></span><strong>{detail.classification.exposure}</strong></div><i>{t(sourceLabel(detail.classification.sources?.exposure))}</i></header>
        <p><LocalizedText text={"How much of the body is exposed in the printed artwork. This does not determine sexual intensity."} /></p>
        {exposureOmitted && <p className="tcgws-identity-omission"><LocalizedText text={"Creator and Character cards intentionally omit Exposure on the card face. Sexual Intensity remains independently classified."} /></p>}
        <TCGSelect label={t('Exposure')} hideLabel value={exposure} onChange={setExposure} disabled={!advanced || exposureOmitted}
                   options={[{ value: 'AI', label: t('Use resolved AI result') }, ...values.exposure.map(value => ({ value, label: value }))]} />
        <small><LocalizedText text={"AI confidence:"} after={" "} />{detail.classification.ai.exposure_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.exposure_confidence * 100)}%`}</small>
      </div>
      <div className="tcgws-axis">
        <header><div><span><LocalizedText text={"Sexual intensity"} /></span><strong>{detail.classification.intensity}</strong></div><i>{t(sourceLabel(detail.classification.sources?.intensity))}</i></header>
        <p><LocalizedText text={"Whether the artwork is safe, sexually suggestive, or depicts explicit sexual content."} /></p>
        <TCGSelect label={t('Sexual intensity')} hideLabel value={intensity} onChange={setIntensity} disabled={!advanced}
                   options={[{ value: 'AI', label: t('Use resolved AI result') }, ...values.intensity.map(value => ({ value, label: value }))]} />
        <small><LocalizedText text={"AI confidence:"} after={" "} />{detail.classification.ai.intensity_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.intensity_confidence * 100)}%`}</small>
      </div>
      {advanced && <button className="tcgws-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}><LocalizedText text={"Save"} /></button>}
      {!advanced && <p className="tcgws-note"><LocalizedText text={"Enable Advanced Mode to override classifications. Manual values always take precedence over AI."} /></p>}
      {detail.classification.gallery_distribution?.total > 0 && <div className="tcgws-distribution">
        <h4><LocalizedText text={"Gallery-wide distribution"} /></h4>
        <p><LocalizedText text={"The card face describes its printed cover. These counts describe all classified media in the gallery."} /></p>
        <div>{Object.entries(detail.classification.gallery_distribution.exposure || {}).map(([key, count]) => <span key={key}>{key}<b>{count}</b></span>)}</div>
        <div>{Object.entries(detail.classification.gallery_distribution.intensity || {}).map(([key, count]) => <span key={key}>{key}<b>{count}</b></span>)}</div>
      </div>}
    </div>
  )
}

function Overview({ detail }) {
  const t = useT()
  const hofAward = formatHofAwardDescription(detail.hof?.provenance, t)
  const engagement = detail.engagement || {}
  const minutes = Math.round(Number(engagement.view_seconds || 0) / 60)
  return <div className="tcgws-overview">
    {hofAward && <div className="tcgws-field tcgws-hof-provenance"><span>{t('Hall of Fame award')}</span><strong>{hofAward}</strong>{detail.hof.provenance.gallery_name && detail.hof.provenance.recipient_type !== 'gallery' && <span>{t('Winning gallery: {name}', { name: detail.hof.provenance.gallery_name })}</span>}</div>}
    <section>
      <h4>{t('Your history with it')}</h4>
      <div className="tcgws-stat-row">
        <div><strong>{Number(engagement.views || 0).toLocaleString()}</strong><span>{t('Views')}</span></div>
        <div><strong>{minutes.toLocaleString()}</strong><span>{t('Minutes watched')}</span></div>
        <div><strong>{Number(engagement.cum_count || 0).toLocaleString()}</strong><span>{t('Cums')}</span></div>
        <div><strong>{Number(engagement.edge_count || 0).toLocaleString()}</strong><span>{t('Edges')}</span></div>
        <div><strong>{detail.user_rating ? `${detail.user_rating}/10` : '—'}</strong><span>{t('Your rating')}</span></div>
      </div>
    </section>
    <section>
      <h4>{t('About this card')}</h4>
      <div className="tcgws-fields">
        <Field label={t('Copies owned')} value={detail.quantity_owned} />
        <Field label={t('First acquired')} value={detail.dates.acquired?.slice(0, 10) || t('Not owned yet')} />
        <Field label={t('Photo date')} value={detail.dates.published?.slice(0, 10) || t('Unknown')} />
        <Field label={t('Card created')} value={detail.dates.card_published?.slice(0, 10) || t('Unknown')} />
        <Field label={t('Exposure')} value={detail.classification.exposure} />
        <Field label={t('Sexual intensity')} value={detail.classification.intensity} />
      </div>
    </section>
    {detail.source_links.length > 0 && <div className="tcgws-source-links">{detail.source_links.map(link => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>{t(link.label)}<ExternalLink size={15} /></a>)}</div>}
  </div>
}

function Ownership({ detail }) {
  const t = useT()
  // Each physical copy keeps its own grade and place (binder, stand, pile).
  const { data: copies = [] } = useQuery({
    queryKey: ['tcg-room-copies', 'card', detail.card.id],
    queryFn: () => tcgRoomApi.copies({ card_id: detail.card.id }).then(r => r.data),
  })
  const ownedCopies = copies.filter(copy => copy.location_kind !== 'traded_away')
  return <div className="tcgws-timeline">
    <header><h4>{detail.quantity_owned}<LocalizedText text={"copies owned"} before={" "} /></h4></header>
    {ownedCopies.length > 0 && <div className="tcgws-copy-list">
      {ownedCopies.map(copy => <div key={copy.id} className="tcgws-copy">
        <strong>{t('Copy #{number}', { number: copy.copy_ordinal })}</strong>
        <span>{t(COPY_LOCATIONS[copy.location_kind] || copy.location_kind)}</span>
        <b className={copy.grade ? 'is-graded' : ''}>{copy.grade ? t('Grade {grade}', { grade: copy.grade }) : t('Ungraded')}</b>
      </div>)}
    </div>}
    {detail.acquisitions.map(item => <article key={item.id}><i /><div><strong>{t(item.source_type.replaceAll('_', ' '))}</strong><span>{item.acquired_at?.slice(0, 10) || t('Acquisition date unknown')} · {Math.abs(item.quantity)} {t(Math.abs(item.quantity) === 1 ? 'copy' : 'copies')}{item.quantity < 0 ? ` ${t('removed')}` : ''}</span><p>{item.notes}</p></div></article>)}
  </div>
}

function Relationships({ detail }) {
  const t = useT()
  const provenance = detail.hof?.provenance
  const awardText = formatHofAwardDescription(provenance, t)
  return <div className="tcgws-relationships">
    {detail.relationships.map((item, index) => <article key={index}><span>{item.release_code}</span><strong>{item.release_name}</strong><p>{item.set_name || 'Release card'} · {String(item.collector_position).padStart(3, '0')}{item.collector_suffix}</p></article>)}
    {detail.hof && <article><span><LocalizedText text={"Hall of Fame"} /></span><strong>{detail.hof.period_type}{detail.hof.period_key ? ` · ${detail.hof.period_key}` : ''}</strong>{detail.hof.score != null && detail.hof.field_size != null && <p><LocalizedText text={"Score"} after={" "} />{detail.hof.score}<LocalizedText text={"across a field of"} before={" "} after={" "} />{detail.hof.field_size}</p>}{provenance && <><p>{awardText}</p>{provenance.gallery_name && provenance.recipient_type !== 'gallery' && <p>{t('Winning gallery: {name}', { name: provenance.gallery_name })}</p>}</>}</article>}
    {detail.bond_milestones.map(item => <article key={item.threshold}><span><LocalizedText text={"Bond milestone"} /></span><strong>{item.threshold}<LocalizedText text={"engagements"} before={" "} /></strong><p>{item.crossed_at?.slice(0, 10) || 'Historical crossing date unknown'}</p></article>)}
  </div>
}

function Tags({ detail }) {
  return <div className="tcgws-tags">{detail.tags.map(tag => <span data-source={tag.source} key={`${tag.id}-${tag.source}`}>{tag.name}<small>{tag.source}{tag.confidence != null ? ` · ${Math.round(tag.confidence * 100)}%` : ''}</small></span>)}</div>
}

function RarityExplainer({ detail }) {
  const t = useT()
  const audit = detail.mint_audit || {}
  const personal = audit.personal_value
  const published = audit.published_rarity
  const evidence = [...(detail.classification.evidence?.tags || [])].sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
  return <div className="tcgws-rarity-explainer">
    <section>
      <h4>{t('Why this rarity')}</h4>
      <p className="tcgws-rarity-explainer__lead">
        {t('Published as {rarity}.', { rarity: t(RARITY_NAMES[published] || published || 'Unknown') })}{' '}
        {personal?.base_rarity && personal.base_rarity !== published
          ? t('Its random roll was {base}; how much you enjoyed it raised it.', { base: t(RARITY_NAMES[personal.base_rarity] || personal.base_rarity) })
          : personal?.rarity_floor
            ? t('Your engagement guaranteed at least {floor}.', { floor: t(RARITY_NAMES[personal.rarity_floor] || personal.rarity_floor) })
            : t('This is its random roll; engagement did not change it.')}
      </p>
      {personal?.floor_reasons?.length > 0 && <ul>{personal.floor_reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {!personal && <p className="tcgws-note">{audit.explanation}</p>}
    </section>
    {personal?.factors?.length > 0 && <section>
      <h4>{t('What counted')} <small>{t('score {score}', { score: personal.score })}</small></h4>
      <div className="tcgws-factor-list">{personal.factors.map(factor => <div key={factor.key}>
        <strong>{factor.label}</strong><b>+{factor.points}</b><p>{factor.detail}</p>
        {Array.isArray(factor.value) && factor.value.length > 0 && <div className="tcgws-chip-row">{factor.value.map(value => <span key={String(value)}>{String(value)}</span>)}</div>}
      </div>)}</div>
    </section>}
    {evidence.length > 0 && <section>
      <h4>{t('Tags used to classify it')}</h4>
      <div className="tcgws-chip-row">{evidence.map(tag => <span key={`${tag.id}-${tag.source}`} data-source={tag.source}>{tag.name}{tag.confidence != null && <small>{Math.round(tag.confidence * 100)}%</small>}</span>)}</div>
    </section>}
  </div>
}

function PresentationEditor({ detail }) {
  const t = useT()
  const qc = useQueryClient()
  const surface = useRef(null)
  const initial = detail.presentation_override || {}
  const isScene = detail.card.card_type === 'image' || detail.card.card_type === 'scene'
  const sceneMaskEditor = detail.card.scene_mask_editor
  const hasSignature = (detail.card.print_rarity || detail.card.rarity_class) === 'SPR'
  const [values, setValues] = useState({
    signature_x: initial.signature_x ?? 700, signature_y: initial.signature_y ?? 1180,
    signature_scale: initial.signature_scale ?? 1, signature_rotation: initial.signature_rotation ?? -7,
    mask: {
      background_strength: initial.mask?.background_strength ?? 1,
      subject_strength: initial.mask?.subject_strength ?? 1,
      ...(isScene && sceneMaskEditor?.available ? { subject_coverage_tolerance: initial.mask?.subject_coverage_tolerance ?? sceneMaskEditor.default_tolerance ?? 0.72 } : {}),
    },
  })
  const [dragging, setDragging] = useState(false)
  const mutation = useMutation({
    mutationFn: () => tcgV2Api.updatePresentation(detail.card.id, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] }); qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] }); toast.success(t("Editor settings saved")) },
    onError: error => toast.error(error.response?.data?.detail || t("Could not save placement")),
  })
  const regenerateMask = useMutation({
    mutationFn: () => cardMasksApi.regenerate(detail.card.source_image_id),
    onSuccess: response => {
      qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
      const result = response.data || {}
      const metrics = result.scene_metrics || result
      const reasons = (metrics.reasons || [result.failure_reason]).filter(Boolean)
      const selectedTolerance = values.mask.subject_coverage_tolerance
        ?? sceneMaskEditor?.subject_coverage_tolerance
        ?? sceneMaskEditor?.default_tolerance
        ?? 0.72
      const passesSelectedTolerance = Boolean(
        isScene && sceneMaskEditor?.override_allowed
        && reasons.length === 1
        && reasons[0] === 'subject-dominates-frame'
        && Number.isFinite(metrics.coverage)
        && metrics.coverage <= selectedTolerance
      )
      if (result.usable) {
        toast.success(t("Mask regenerated and passed the default checks"))
        return
      }
      if (passesSelectedTolerance) {
        toast(t("Accepted at this Editor tolerance; the default check still fails. Save Editor changes to apply."), { icon: 'ℹ️' })
        return
      }
      const coverage = metrics.coverage
      const reason = reasons[0] || 'unknown rejection'
      const reasonLabels = {
        'subject-dominates-frame': t("Subject covers too much of the card"),
        'subject-too-small': t("Subject mask is too small"),
        'source-file-missing': t("Source file is missing"),
        'video-source': t("Video sources cannot use a still subject mask"),
        'animated-image-source': t("Animated images cannot use a still subject mask"),
        'generation-error': t("Mask generation failed"),
      }
      toast.error(t("Mask candidate rejected: {reason}{coverage}", {
        reason: reasonLabels[reason] || reason,
        coverage: coverage == null ? '' : ` (${Math.round(coverage * 100)}% coverage)`,
      }))
    },
    onError: error => toast.error(error.response?.data?.detail || t("Could not regenerate mask")),
  })
  const move = event => {
    if (!dragging || !surface.current) return
    const rect = surface.current.getBoundingClientRect()
    setValues(previous => ({ ...previous,
      signature_x: Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 1024),
      signature_y: Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 1536),
    }))
  }
  const savedTolerance = sceneMaskEditor?.subject_coverage_tolerance ?? sceneMaskEditor?.default_tolerance ?? 0.72
  const liveTolerance = values.mask.subject_coverage_tolerance ?? savedTolerance
  const tolerancePreviewAccepted = Boolean(
    isScene && sceneMaskEditor?.override_allowed
    && sceneMaskEditor.metrics?.reasons?.length === 1
    && sceneMaskEditor.metrics.reasons[0] === 'subject-dominates-frame'
    && sceneMaskEditor.metrics.coverage <= liveTolerance
  )
  const editorPreviewCard = sceneMaskEditor?.candidate_mask_url && detail.card.scene_visual?.recipe
    ? {
      ...detail.card,
      mask_url: sceneMaskEditor.candidate_mask_url,
      mask_visual_mode: tolerancePreviewAccepted ? 'layered' : 'flat',
      presentation_override: values,
      scene_visual: {
        ...detail.card.scene_visual,
        mask_url: sceneMaskEditor.candidate_mask_url,
        visual_mode: tolerancePreviewAccepted ? 'layered' : 'flat',
        recipe: {
          ...detail.card.scene_visual.recipe,
          visualMode: tolerancePreviewAccepted ? 'layered' : 'flat',
          maskMetrics: {
            ...detail.card.scene_visual.recipe.maskMetrics,
            ...sceneMaskEditor.metrics,
            accepted: tolerancePreviewAccepted,
            reasons: tolerancePreviewAccepted ? [] : ['subject-dominates-frame'],
          },
          extraction: {
            ...detail.card.scene_visual.recipe.extraction,
            status: tolerancePreviewAccepted ? 'usable' : 'fallback',
            failureReason: tolerancePreviewAccepted ? null : 'subject-dominates-frame',
          },
        },
      },
    }
    : { ...detail.card, presentation_override: values }
  const coveragePercent = sceneMaskEditor?.metrics?.coverage == null
    ? null : Math.round(sceneMaskEditor.metrics.coverage * 100)
  return <div className="tcgws-presentation-editor">
    <div ref={surface} className="tcgws-presentation-surface" onPointerMove={move} onPointerUp={() => setDragging(false)} onPointerLeave={() => setDragging(false)}>
      <TCGV2CardFace card={editorPreviewCard} width="100%" showEffects videoPresentation="full" />
      {hasSignature && <button style={{ left: `${values.signature_x / 10.24}%`, top: `${values.signature_y / 15.36}%` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true) }}><LocalizedText text={"Drag signature"} /></button>}
    </div>
    <section>{hasSignature && <><h3><LocalizedText text={"Signature placement"} /></h3><p><LocalizedText text={"Drag on the card or use the sliders. This only changes how the card is shown."} /></p>
      <label><span><LocalizedText text={"Horizontal"} /></span><input type="range" min="0" max="1024" value={values.signature_x} onChange={e => setValues({ ...values, signature_x: Number(e.target.value) })} /></label>
      <label><span><LocalizedText text={"Vertical"} /></span><input type="range" min="0" max="1536" value={values.signature_y} onChange={e => setValues({ ...values, signature_y: Number(e.target.value) })} /></label>
      <label><span><LocalizedText text={"Scale"} /></span><input type="range" min="0.5" max="2" step="0.05" value={values.signature_scale} onChange={e => setValues({ ...values, signature_scale: Number(e.target.value) })} /></label>
      <label><span><LocalizedText text={"Rotation"} /></span><input type="range" min="-30" max="30" value={values.signature_rotation} onChange={e => setValues({ ...values, signature_rotation: Number(e.target.value) })} /></label></>}
      <h3><LocalizedText text={"Foil mask response"} /></h3>
      <label><span><LocalizedText text={"Background"} /></span><input type="range" min="0" max="1" step="0.02" value={values.mask.background_strength} onChange={e => setValues({ ...values, mask: { ...values.mask, background_strength: Number(e.target.value) } })} /></label>
      <label><span><LocalizedText text={"Subject"} /></span><input type="range" min="0" max="1" step="0.02" value={values.mask.subject_strength} onChange={e => setValues({ ...values, mask: { ...values.mask, subject_strength: Number(e.target.value) } })} /></label>
      {sceneMaskEditor?.available && <div className="tcgws-mask-candidate">
        <h3><LocalizedText text={"Subject mask candidate"} /></h3>
        <figure style={{ '--mask-focus-x': `${(detail.card.image_focal_x ?? 0.5) * 100}%`, '--mask-focus-y': `${(detail.card.image_focal_y ?? 0.5) * 100}%` }}>
          <img src={detail.card.image_url} alt={t("Source artwork")} />
          <img className="tcgws-mask-candidate__overlay" src={sceneMaskEditor.subject_channel_url} alt={t("Detected subject area")} />
        </figure>
        <p><LocalizedText text={"Detected subject coverage"} />: <strong>{coveragePercent}%</strong></p>
        <p><LocalizedText text={"Highlighted regions may include background details or decorative elements. Tolerance changes acceptance only; it does not clean the mask."} /></p>
        <p className={tolerancePreviewAccepted ? 'tcgws-mask-candidate__status is-accepted' : 'tcgws-mask-candidate__status'}>
          <LocalizedText text={tolerancePreviewAccepted ? "This candidate passes the selected tolerance in the live preview." : "Raise tolerance to preview this candidate as a layered card."} />
        </p>
        <label><span><LocalizedText text={"Coverage tolerance"} /> <b>{Math.round(liveTolerance * 100)}%</b></span>
          <input type="range" min={sceneMaskEditor.minimum_tolerance} max={sceneMaskEditor.maximum_tolerance} step="0.01" value={liveTolerance}
            onChange={e => setValues({ ...values, mask: { ...values.mask, subject_coverage_tolerance: Number(e.target.value) } })} />
        </label>
        <p><LocalizedText text={"Tolerance only overrides subject-dominates-frame for this card. Other mask failures stay blocked."} /></p>
        <p><LocalizedText text={"Live preview only. Save Editor changes to apply this setting to the Collection card."} /></p>
      </div>}
      {detail.card.source_image_id && <button className="tcgws-secondary" onClick={() => regenerateMask.mutate()} disabled={regenerateMask.isPending}><LocalizedText text={"Regenerate subject mask"} /></button>}
      <button className="tcgws-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}><LocalizedText text={"Save Editor changes"} /></button>
    </section>
  </div>
}

export default function CardInspector({ card, onClose, advanced, classificationValues, disableLayoutAnimation = false, onPrev = null, onNext = null }) {
  const t = useT()
  const [tab, setTab] = useState('Overview')
  const tabs = advanced ? ADVANCED_TABS : BASIC_TABS
  const qc = useQueryClient()
  const favorite = useMutation({
    mutationFn: value => tcgV2Api.setFavorite(card.id, value).then(r => r.data),
    onSuccess: data => {
      qc.setQueryData(['tcg-v2-card', card.id], old => old ? { ...old, favorite: data.favorite } : old)
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
    },
    onError: error => toast.error(error.response?.data?.detail || t('Could not update favorite')),
  })
  const activeTab = tabs.includes(tab) ? tab : 'Overview'
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
  // The regular collection route lives beneath Layout's transformed Framer
  // Motion wrapper. Portal that inspector to body so fixed inset:0 is measured
  // against the usable viewport instead of the route's content box. The room
  // computer keeps its local mount so its themed screen styles still apply.
  const inspector = <motion.div className="tcgws-inspector-backdrop" style={!disableLayoutAnimation ? { '--tcg-line': 'rgba(255,255,255,.1)', '--tcg-muted': 'rgba(255,255,255,.52)' } : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.section className="tcgws-inspector" initial={{ opacity: 0, scale: 0.96, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 12 }} transition={{ type: 'spring', stiffness: 260, damping: 25 }}>
      <button className="tcgws-close" onClick={onClose} title={t("Close")}><X size={22} /></button>
      {onPrev && <button type="button" className="tcgws-inspector-step is-prev" onClick={onPrev} title={t('Previous card')} aria-label={t('Previous card')}><ChevronLeft size={20} /></button>}
      {onNext && <button type="button" className="tcgws-inspector-step is-next" onClick={onNext} title={t('Next card')} aria-label={t('Next card')}><ChevronRight size={20} /></button>}
      <motion.div layoutId={disableLayoutAnimation ? undefined : `tcg-card-${card.id}`} className="tcgws-inspector-card"><TCGV2CardFace card={detail ? { ...detail.card, presentation_override: detail.presentation_override } : card} width="min(42vw, 520px)" showEffects videoPresentation="full" fallback={<ArchivedFace card={card} />} /></motion.div>
      <div className="tcgws-inspector-info">
        <header>
          <div className="tcgws-inspector-chips">
            <b data-rarity={card.print_rarity || card.rarity_class}>{t(RARITY_NAMES[card.print_rarity || card.rarity_class] || card.print_rarity || card.rarity_class)}</b>
            <span>{t(cardTypeLabel(card.card_type))}</span>
            {detail?.classification.badge && <span>{detail.classification.badge}</span>}
          </div>
          <h2>{card.card_code || card.display_name || card.creator_name || card.gallery_name}</h2>
          <p>{[card.card_code ? (card.display_name || card.creator_name || card.gallery_name) : null, card.catalog_code].filter(Boolean).join(' · ')}</p>
          <button type="button" className={`tcgws-favorite-toggle${detail?.favorite ? ' is-on' : ''}`} disabled={!detail || favorite.isPending}
                  aria-pressed={Boolean(detail?.favorite)} onClick={() => favorite.mutate(!detail?.favorite)}>
            <Star size={17} fill={detail?.favorite ? 'currentColor' : 'none'} />{t(detail?.favorite ? 'Favorite' : 'Add to favorites')}
          </button>
        </header>
        <nav>{tabs.map(item => <button key={item} onClick={() => setTab(item)} className={activeTab === item ? 'active' : ''}>{t(item)}</button>)}</nav>
        <div className="tcgws-inspector-panel">
          {isLoading && <p><LocalizedText text={"Loading complete card record..."} /></p>}
          <AnimatePresence mode="wait" initial={false}>
            {detail && <motion.div key={activeTab} className="tcgws-inspector-panel-content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
              {activeTab === 'Overview' && <Overview detail={detail} />}
              {activeTab === 'Classification' && <ClassificationEditor detail={detail} values={classificationValues} advanced={advanced} />}
              {activeTab === 'Copies' && <Ownership detail={detail} />}
              {activeTab === 'Sets' && <Relationships detail={detail} />}
              {activeTab === 'Tags' && <Tags detail={detail} />}
              {activeTab === 'Editor' && (advanced ? <PresentationEditor detail={detail} /> : <p className="tcgws-note"><LocalizedText text={"Editor settings are available in Advanced Mode."} /></p>)}
              {activeTab === 'Rarity' && <RarityExplainer detail={detail} />}
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
