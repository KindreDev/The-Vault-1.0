import { LocalizedText, useT } from '../../i18n'
import { createPortal } from 'react-dom'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { cardMasksApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatHofAwardDescription } from './hofProvenance'

const TABS = ['Overview', 'Classification', 'Ownership', 'Engagement', 'Relationships', 'Tags', 'Editor', 'Audit']
const CARD_TYPE_LABELS = { image: 'Scene', scene: 'Scene', gallery: 'Gallery', creator: 'Creator', character: 'Character', cosplay: 'Cosplay', collab: 'Collab', bond: 'Bond', hof: 'Hall of Fame' }

function cardTypeLabel(value) {
  return CARD_TYPE_LABELS[value] || value || 'Card'
}

function ArchivedFace({ card }) {
  return <div className="tcgws-archived-face tcgws-archived-face--large"><span>{card.print_rarity || card.rarity_class}</span><strong><LocalizedText text={"Archived printing"} /></strong><small><LocalizedText text={"This preserved record has no complete frozen face recipe."} /></small></div>
}

function Field({ label, value }) {
  return <div className="tcgws-field"><span>{label}</span><strong>{value ?? 'Unknown'}</strong></div>
}

function ClassificationEditor({ detail, values, advanced }) {
  const t = useT()
  const qc = useQueryClient()
  const [exposure, setExposure] = useState(detail.classification.manual.exposure || 'AI')
  const [intensity, setIntensity] = useState(detail.classification.manual.intensity || 'AI')
  const mutation = useMutation({
    mutationFn: () => tcgV2Api.classifyCard(detail.card.id, { exposure, intensity }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] }); toast.success(t("Classification saved")) },
    onError: error => toast.error(error.response?.data?.detail || t("Could not save classification")),
  })
  const exposureOmitted = detail.classification.sources.exposure === 'omitted'
  return (
    <div className="tcgws-classification">
      <div className="tcgws-axis">
        <header><div><span><LocalizedText text={"Exposure"} /></span><strong>{detail.classification.exposure}</strong></div><i>{detail.classification.source}</i></header>
        <p><LocalizedText text={"How much of the body is exposed in the printed artwork. This does not determine sexual intensity."} /></p>
        {exposureOmitted && <p className="tcgws-identity-omission"><LocalizedText text={"Creator and Character cards intentionally omit Exposure on the card face. Sexual Intensity remains independently classified."} /></p>}
        <select value={exposure} onChange={e => setExposure(e.target.value)} disabled={!advanced || exposureOmitted}>
          <option value="AI"><LocalizedText text={"Use resolved AI result"} /></option>{values.exposure.map(value => <option key={value}>{value}</option>)}
        </select>
        <small><LocalizedText text={"AI confidence:"} after={" "} />{detail.classification.ai.exposure_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.exposure_confidence * 100)}%`}</small>
      </div>
      <div className="tcgws-axis">
        <header><div><span><LocalizedText text={"Sexual intensity"} /></span><strong>{detail.classification.intensity}</strong></div><i>{detail.classification.source}</i></header>
        <p><LocalizedText text={"Whether the artwork is safe, sexually suggestive, or depicts explicit sexual content."} /></p>
        <select value={intensity} onChange={e => setIntensity(e.target.value)} disabled={!advanced}>
          <option value="AI"><LocalizedText text={"Use resolved AI result"} /></option>{values.intensity.map(value => <option key={value}>{value}</option>)}
        </select>
        <small><LocalizedText text={"AI confidence:"} after={" "} />{detail.classification.ai.intensity_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.intensity_confidence * 100)}%`}</small>
      </div>
      {advanced && <button className="tcgws-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}><LocalizedText text={"Save manual override"} /></button>}
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
  return <div className="tcgws-fields">
    {hofAward && <div className="tcgws-field tcgws-hof-provenance" style={{ gridColumn: '1 / -1' }}><span>{t('Hall of Fame award')}</span><strong>{hofAward}</strong>{detail.hof.provenance.gallery_name && detail.hof.provenance.recipient_type !== 'gallery' && <span>{t('Winning gallery: {name}', { name: detail.hof.provenance.gallery_name })}</span>}</div>}
    <Field label={t("Medium")} value={detail.medium ? `${detail.medium.charAt(0).toUpperCase()}${detail.medium.slice(1)}` : 'Unknown'} /><Field label={t("User rating")} value={detail.user_rating ? `${detail.user_rating}/10` : 'Unrated'} />
    <Field label={t("Quantity owned")} value={detail.quantity_owned} /><Field label={t("Published")} value={detail.dates.published?.slice(0, 10)} />
    <Field label={t("Acquired")} value={detail.dates.acquired?.slice(0, 10)} /><Field label={t("Card published")} value={detail.dates.card_published?.slice(0, 10)} />
    <Field label={t("Exposure")} value={detail.classification.exposure} /><Field label={t("Sexual intensity")} value={detail.classification.intensity} />
    {detail.source_links.length > 0 && <div className="tcgws-source-links">{detail.source_links.map(link => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>{link.label}<ExternalLink size={15} /></a>)}</div>}
  </div>
}

function Ownership({ detail }) {
  const t = useT()
  const qc = useQueryClient()
  const dismantle = useMutation({
    mutationFn: () => tcgV2Api.dismantleDuplicate(detail.card.id),
    onSuccess: response => {
      qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-workshop'] })
      toast.success(t('Duplicate dismantled · {shards} Shards', { shards: response.data.shards_earned }))
    },
    onError: error => toast.error(error.response?.data?.detail || t("Could not dismantle duplicate")),
  })
  return <div className="tcgws-timeline"><header><h4>{detail.quantity_owned}<LocalizedText text={"copies owned"} before={" "} /></h4>{detail.quantity_owned > 1 && <button className="tcgws-secondary" disabled={dismantle.isPending} onClick={() => window.confirm(t("Dismantle one duplicate copy into Shards? The last copy is always protected.")) && dismantle.mutate()}><Trash2 size={16} /><LocalizedText text={"Dismantle one duplicate"} before={" "} /></button>}</header>{detail.acquisitions.map(item => <article key={item.id}><i /><div><strong>{t(item.source_type.replaceAll('_', ' '))}</strong><span>{item.acquired_at?.slice(0, 10) || t('Acquisition date unknown')} · {Math.abs(item.quantity)} {t(Math.abs(item.quantity) === 1 ? 'copy' : 'copies')}{item.quantity < 0 ? ` ${t('removed')}` : ''}</span><p>{item.notes}</p></div></article>)}</div>
}

function Engagement({ detail }) {
  const t = useT()
  return <div className="tcgws-fields"><Field label={t("Views")} value={detail.engagement.views.toLocaleString()} /><Field label={t("Viewing time")} value={t('{count} min', { count: Math.round(detail.engagement.view_seconds / 60).toLocaleString() })} /><Field label={t("Cum count")} value={detail.engagement.cum_count.toLocaleString()} /><Field label={t("Edges")} value={detail.engagement.edge_count.toLocaleString()} /><Field label={t("Favorite")} value={t(detail.engagement.favorite ? 'Yes' : 'No')} /></div>
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

function Audit({ detail, advanced }) {
  const t = useT()
  if (!advanced) return <p className="tcgws-note"><LocalizedText text={"Mint-score and generation evidence is available in Advanced Mode."} /></p>
  const personal = detail.mint_audit.personal_value
  return <div className="tcgws-audit">
    <Field label={t("Published rarity")} value={detail.mint_audit.published_rarity} />
    <Field label={t("Personal-value score")} value={personal?.score ?? 'Not recorded'} />
    <Field label={t("Rarity floor")} value={personal?.rarity_floor || 'None'} />
    <Field label={t("Catalog code")} value={detail.mint_audit.catalog_code} />
    <Field label={t("Frozen visual recipe")} value={detail.mint_audit.visual_recipe_frozen ? 'Yes' : 'No'} />
    <p>{detail.mint_audit.explanation}</p>
    {personal?.floor_reasons?.length > 0 && <section><h4><LocalizedText text={"Floor reasons"} /></h4>{personal.floor_reasons.map(reason => <p key={reason}>{reason}</p>)}</section>}
    {personal?.factors?.length > 0 && <section><h4><LocalizedText text={"Personal-value evidence"} /></h4>{personal.factors.map(factor => <div className="tcgws-field" key={factor.key}><span>{factor.label}</span><strong>+{factor.points}</strong><p>{factor.detail}</p></div>)}</section>}
    <details><summary><LocalizedText text={"Classification evidence"} /></summary><pre>{JSON.stringify(detail.classification.evidence, null, 2)}</pre></details>
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
    <section>{hasSignature && <><h3><LocalizedText text={"Signature placement"} /></h3><p><LocalizedText text={"Drag directly over the card or use precise controls. The override is versioned and does not alter the frozen card recipe."} /></p>
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

export default function CardInspector({ card, onClose, advanced, classificationValues, disableLayoutAnimation = false }) {
  const t = useT()
  const [tab, setTab] = useState('Overview')
  useScrollLock()
  const { data: detail, isLoading } = useQuery({ queryKey: ['tcg-v2-card', card.id], queryFn: () => tcgV2Api.cardDetail(card.id).then(r => r.data) })
  // The regular collection route lives beneath Layout's transformed Framer
  // Motion wrapper. Portal that inspector to body so fixed inset:0 is measured
  // against the usable viewport instead of the route's content box. The room
  // computer keeps its local mount so its themed screen styles still apply.
  const inspector = <motion.div className="tcgws-inspector-backdrop" style={!disableLayoutAnimation ? { '--tcg-line': 'rgba(255,255,255,.1)', '--tcg-muted': 'rgba(255,255,255,.52)' } : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.section className="tcgws-inspector" initial={{ opacity: 0, scale: 0.96, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 12 }} transition={{ type: 'spring', stiffness: 260, damping: 25 }}>
      <button className="tcgws-close" onClick={onClose} title={t("Close")}><X size={22} /></button>
      <motion.div layoutId={disableLayoutAnimation ? undefined : `tcg-card-${card.id}`} className="tcgws-inspector-card"><TCGV2CardFace card={detail ? { ...detail.card, presentation_override: detail.presentation_override } : card} width="min(42vw, 520px)" showEffects videoPresentation="full" fallback={<ArchivedFace card={card} />} /></motion.div>
      <div className="tcgws-inspector-info">
        <header><div><span>{card.print_rarity || card.rarity_class} · {cardTypeLabel(card.card_type)}</span><h2>{card.display_name || card.creator_name || card.gallery_name}</h2><p>{card.catalog_code || 'Permanent printing'}</p></div>{detail?.classification.badge && <b>{detail.classification.badge}</b>}</header>
        <nav>{TABS.map(item => <button key={item} onClick={() => setTab(item)} className={tab === item ? 'active' : ''}>{item}</button>)}</nav>
        <div className="tcgws-inspector-panel">
          {isLoading && <p><LocalizedText text={"Loading complete card record..."} /></p>}
          <AnimatePresence mode="wait" initial={false}>
            {detail && <motion.div key={tab} className="tcgws-inspector-panel-content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
              {tab === 'Overview' && <Overview detail={detail} />}
              {tab === 'Classification' && <ClassificationEditor detail={detail} values={classificationValues} advanced={advanced} />}
              {tab === 'Ownership' && <Ownership detail={detail} />}
              {tab === 'Engagement' && <Engagement detail={detail} />}
              {tab === 'Relationships' && <Relationships detail={detail} />}
              {tab === 'Tags' && <Tags detail={detail} />}
              {tab === 'Editor' && (advanced ? <PresentationEditor detail={detail} /> : <p className="tcgws-note"><LocalizedText text={"Editor settings are available in Advanced Mode."} /></p>)}
              {tab === 'Audit' && <><button className="tcgws-back tcgws-audit-back" onClick={() => setTab('Overview')}><ArrowLeft size={18} /><LocalizedText text={"Back to card details"} before={" "} /></button><Audit detail={detail} advanced={advanced} /></>}
            </motion.div>}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  </motion.div>
  return disableLayoutAnimation ? inspector : createPortal(inspector, document.body)
}
