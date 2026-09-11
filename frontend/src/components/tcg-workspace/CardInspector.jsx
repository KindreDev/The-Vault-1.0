import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { cardMasksApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'

const TABS = ['Overview', 'Classification', 'Ownership', 'Engagement', 'Relationships', 'Tags', 'Presentation', 'Audit']
const CARD_TYPE_LABELS = { image: 'Scene', scene: 'Scene', gallery: 'Gallery', creator: 'Creator', character: 'Character', cosplay: 'Cosplay', collab: 'Collab', bond: 'Bond', hof: 'Hall of Fame' }

function cardTypeLabel(value) {
  return CARD_TYPE_LABELS[value] || value || 'Card'
}

function ArchivedFace({ card }) {
  return <div className="tcgws-archived-face tcgws-archived-face--large"><span>{card.print_rarity || card.rarity_class}</span><strong>Archived printing</strong><small>This preserved record has no complete frozen face recipe.</small></div>
}

function Field({ label, value }) {
  return <div className="tcgws-field"><span>{label}</span><strong>{value ?? 'Unknown'}</strong></div>
}

function ClassificationEditor({ detail, values, advanced }) {
  const qc = useQueryClient()
  const [exposure, setExposure] = useState(detail.classification.manual.exposure || 'AI')
  const [intensity, setIntensity] = useState(detail.classification.manual.intensity || 'AI')
  const mutation = useMutation({
    mutationFn: () => tcgV2Api.classifyCard(detail.card.id, { exposure, intensity }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] }); toast.success('Classification saved') },
    onError: error => toast.error(error.response?.data?.detail || 'Could not save classification'),
  })
  const exposureOmitted = detail.classification.sources.exposure === 'omitted'
  return (
    <div className="tcgws-classification">
      <div className="tcgws-axis">
        <header><div><span>Exposure</span><strong>{detail.classification.exposure}</strong></div><i>{detail.classification.source}</i></header>
        <p>How much of the body is exposed in the printed artwork. This does not determine sexual intensity.</p>
        {exposureOmitted && <p className="tcgws-identity-omission">Creator and Character cards intentionally omit Exposure on the card face. Sexual Intensity remains independently classified.</p>}
        <select value={exposure} onChange={e => setExposure(e.target.value)} disabled={!advanced || exposureOmitted}>
          <option value="AI">Use resolved AI result</option>{values.exposure.map(value => <option key={value}>{value}</option>)}
        </select>
        <small>AI confidence: {detail.classification.ai.exposure_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.exposure_confidence * 100)}%`}</small>
      </div>
      <div className="tcgws-axis">
        <header><div><span>Sexual intensity</span><strong>{detail.classification.intensity}</strong></div><i>{detail.classification.source}</i></header>
        <p>Whether the artwork is safe, sexually suggestive, or depicts explicit sexual content.</p>
        <select value={intensity} onChange={e => setIntensity(e.target.value)} disabled={!advanced}>
          <option value="AI">Use resolved AI result</option>{values.intensity.map(value => <option key={value}>{value}</option>)}
        </select>
        <small>AI confidence: {detail.classification.ai.intensity_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.intensity_confidence * 100)}%`}</small>
      </div>
      {advanced && <button className="tcgws-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>Save manual override</button>}
      {!advanced && <p className="tcgws-note">Enable Advanced Mode to override classifications. Manual values always take precedence over AI.</p>}
      {detail.classification.gallery_distribution?.total > 0 && <div className="tcgws-distribution">
        <h4>Gallery-wide distribution</h4>
        <p>The card face describes its printed cover. These counts describe all classified media in the gallery.</p>
        <div>{Object.entries(detail.classification.gallery_distribution.exposure || {}).map(([key, count]) => <span key={key}>{key}<b>{count}</b></span>)}</div>
        <div>{Object.entries(detail.classification.gallery_distribution.intensity || {}).map(([key, count]) => <span key={key}>{key}<b>{count}</b></span>)}</div>
      </div>}
    </div>
  )
}

function Overview({ detail }) {
  return <div className="tcgws-fields">
    <Field label="Medium" value={detail.medium ? `${detail.medium.charAt(0).toUpperCase()}${detail.medium.slice(1)}` : 'Unknown'} /><Field label="User rating" value={detail.user_rating ? `${detail.user_rating}/10` : 'Unrated'} />
    <Field label="Quantity owned" value={detail.quantity_owned} /><Field label="Published" value={detail.dates.published?.slice(0, 10)} />
    <Field label="Acquired" value={detail.dates.acquired?.slice(0, 10)} /><Field label="Card published" value={detail.dates.card_published?.slice(0, 10)} />
    <Field label="Exposure" value={detail.classification.exposure} /><Field label="Sexual intensity" value={detail.classification.intensity} />
    {detail.source_links.length > 0 && <div className="tcgws-source-links">{detail.source_links.map(link => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>{link.label}<ExternalLink size={15} /></a>)}</div>}
  </div>
}

function Ownership({ detail }) {
  const qc = useQueryClient()
  const dismantle = useMutation({
    mutationFn: () => tcgV2Api.dismantleDuplicate(detail.card.id),
    onSuccess: response => {
      qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-workshop'] })
      toast.success(`Duplicate dismantled · ${response.data.shards_earned} Shards`)
    },
    onError: error => toast.error(error.response?.data?.detail || 'Could not dismantle duplicate'),
  })
  return <div className="tcgws-timeline"><header><h4>{detail.quantity_owned} copies owned</h4>{detail.quantity_owned > 1 && <button className="tcgws-secondary" disabled={dismantle.isPending} onClick={() => window.confirm('Dismantle one duplicate copy into Shards? The last copy is always protected.') && dismantle.mutate()}><Trash2 size={16} /> Dismantle one duplicate</button>}</header>{detail.acquisitions.map(item => <article key={item.id}><i /><div><strong>{item.source_type.replaceAll('_', ' ')}</strong><span>{item.acquired_at?.slice(0, 10) || 'Acquisition date unknown'} · {Math.abs(item.quantity)} {Math.abs(item.quantity) === 1 ? 'copy' : 'copies'}{item.quantity < 0 ? ' removed' : ''}</span><p>{item.notes}</p></div></article>)}</div>
}

function Engagement({ detail }) {
  return <div className="tcgws-fields"><Field label="Views" value={detail.engagement.views.toLocaleString()} /><Field label="Viewing time" value={`${Math.round(detail.engagement.view_seconds / 60).toLocaleString()} min`} /><Field label="Cum count" value={detail.engagement.cum_count.toLocaleString()} /><Field label="Edges" value={detail.engagement.edge_count.toLocaleString()} /><Field label="Favorite" value={detail.engagement.favorite ? 'Yes' : 'No'} /></div>
}

function Relationships({ detail }) {
  return <div className="tcgws-relationships">
    {detail.relationships.map((item, index) => <article key={index}><span>{item.release_code}</span><strong>{item.release_name}</strong><p>{item.set_name || 'Release card'} · {String(item.collector_position).padStart(3, '0')}{item.collector_suffix}</p></article>)}
    {detail.hof && <article><span>Hall of Fame</span><strong>{detail.hof.period_type} · {detail.hof.period_key}</strong><p>Score {detail.hof.score} across a field of {detail.hof.field_size}</p></article>}
    {detail.bond_milestones.map(item => <article key={item.threshold}><span>Bond milestone</span><strong>{item.threshold} engagements</strong><p>{item.crossed_at?.slice(0, 10) || 'Historical crossing date unknown'}</p></article>)}
  </div>
}

function Tags({ detail }) {
  return <div className="tcgws-tags">{detail.tags.map(tag => <span data-source={tag.source} key={`${tag.id}-${tag.source}`}>{tag.name}<small>{tag.source}{tag.confidence != null ? ` · ${Math.round(tag.confidence * 100)}%` : ''}</small></span>)}</div>
}

function Audit({ detail, advanced }) {
  if (!advanced) return <p className="tcgws-note">Mint-score and generation evidence is available in Advanced Mode.</p>
  const personal = detail.mint_audit.personal_value
  return <div className="tcgws-audit">
    <Field label="Published rarity" value={detail.mint_audit.published_rarity} />
    <Field label="Personal-value score" value={personal?.score ?? 'Not recorded'} />
    <Field label="Rarity floor" value={personal?.rarity_floor || 'None'} />
    <Field label="Catalog code" value={detail.mint_audit.catalog_code} />
    <Field label="Frozen visual recipe" value={detail.mint_audit.visual_recipe_frozen ? 'Yes' : 'No'} />
    <p>{detail.mint_audit.explanation}</p>
    {personal?.floor_reasons?.length > 0 && <section><h4>Floor reasons</h4>{personal.floor_reasons.map(reason => <p key={reason}>{reason}</p>)}</section>}
    {personal?.factors?.length > 0 && <section><h4>Personal-value evidence</h4>{personal.factors.map(factor => <div className="tcgws-field" key={factor.key}><span>{factor.label}</span><strong>+{factor.points}</strong><p>{factor.detail}</p></div>)}</section>}
    <details><summary>Classification evidence</summary><pre>{JSON.stringify(detail.classification.evidence, null, 2)}</pre></details>
  </div>
}

function PresentationEditor({ detail }) {
  const qc = useQueryClient()
  const surface = useRef(null)
  const initial = detail.presentation_override || {}
  const hasSignature = (detail.card.print_rarity || detail.card.rarity_class) === 'SPR'
  const [values, setValues] = useState({
    signature_x: initial.signature_x ?? 700, signature_y: initial.signature_y ?? 1180,
    signature_scale: initial.signature_scale ?? 1, signature_rotation: initial.signature_rotation ?? -7,
    mask: { background_strength: initial.mask?.background_strength ?? 1, subject_strength: initial.mask?.subject_strength ?? 1 },
  })
  const [dragging, setDragging] = useState(false)
  const mutation = useMutation({
    mutationFn: () => tcgV2Api.updatePresentation(detail.card.id, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] }); toast.success('Signature placement saved') },
    onError: error => toast.error(error.response?.data?.detail || 'Could not save placement'),
  })
  const regenerateMask = useMutation({
    mutationFn: () => cardMasksApi.regenerate(detail.card.source_image_id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-card', detail.card.id] }); toast.success('Subject mask regenerated') },
    onError: error => toast.error(error.response?.data?.detail || 'Could not regenerate mask'),
  })
  const move = event => {
    if (!dragging || !surface.current) return
    const rect = surface.current.getBoundingClientRect()
    setValues(previous => ({ ...previous,
      signature_x: Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 1024),
      signature_y: Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 1536),
    }))
  }
  const card = { ...detail.card, presentation_override: values }
  return <div className="tcgws-presentation-editor">
    <div ref={surface} className="tcgws-presentation-surface" onPointerMove={move} onPointerUp={() => setDragging(false)} onPointerLeave={() => setDragging(false)}>
      <TCGV2CardFace card={card} width="100%" showEffects />
      {hasSignature && <button style={{ left: `${values.signature_x / 10.24}%`, top: `${values.signature_y / 15.36}%` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true) }}>Drag signature</button>}
    </div>
    <section>{hasSignature && <><h3>Signature placement</h3><p>Drag directly over the card or use precise controls. The override is versioned and does not alter the frozen card recipe.</p>
      <label><span>Horizontal</span><input type="range" min="0" max="1024" value={values.signature_x} onChange={e => setValues({ ...values, signature_x: Number(e.target.value) })} /></label>
      <label><span>Vertical</span><input type="range" min="0" max="1536" value={values.signature_y} onChange={e => setValues({ ...values, signature_y: Number(e.target.value) })} /></label>
      <label><span>Scale</span><input type="range" min="0.5" max="2" step="0.05" value={values.signature_scale} onChange={e => setValues({ ...values, signature_scale: Number(e.target.value) })} /></label>
      <label><span>Rotation</span><input type="range" min="-30" max="30" value={values.signature_rotation} onChange={e => setValues({ ...values, signature_rotation: Number(e.target.value) })} /></label></>}
      <h3>Foil mask response</h3>
      <label><span>Background</span><input type="range" min="0" max="1" step="0.02" value={values.mask.background_strength} onChange={e => setValues({ ...values, mask: { ...values.mask, background_strength: Number(e.target.value) } })} /></label>
      <label><span>Subject</span><input type="range" min="0" max="1" step="0.02" value={values.mask.subject_strength} onChange={e => setValues({ ...values, mask: { ...values.mask, subject_strength: Number(e.target.value) } })} /></label>
      {detail.card.source_image_id && <button className="tcgws-secondary" onClick={() => regenerateMask.mutate()} disabled={regenerateMask.isPending}>Regenerate subject mask</button>}
      <button className="tcgws-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>Save placement</button>
    </section>
  </div>
}

export default function CardInspector({ card, onClose, advanced, classificationValues }) {
  const [tab, setTab] = useState('Overview')
  const { data: detail, isLoading } = useQuery({ queryKey: ['tcg-v2-card', card.id], queryFn: () => tcgV2Api.cardDetail(card.id).then(r => r.data) })
  return <motion.div className="tcgws-inspector-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <motion.section className="tcgws-inspector" initial={{ opacity: 0, scale: 0.96, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 12 }} transition={{ type: 'spring', stiffness: 260, damping: 25 }}>
      <button className="tcgws-close" onClick={onClose} title="Close"><X size={22} /></button>
      <motion.div layoutId={`tcg-card-${card.id}`} className="tcgws-inspector-card"><TCGV2CardFace card={detail ? { ...detail.card, presentation_override: detail.presentation_override } : card} width="min(42vw, 520px)" showEffects fallback={<ArchivedFace card={card} />} /></motion.div>
      <div className="tcgws-inspector-info">
        <header><div><span>{card.print_rarity || card.rarity_class} · {cardTypeLabel(card.card_type)}</span><h2>{card.display_name || card.creator_name || card.gallery_name}</h2><p>{card.catalog_code || 'Permanent printing'}</p></div>{detail?.classification.badge && <b>{detail.classification.badge}</b>}</header>
        <nav>{TABS.map(item => <button key={item} onClick={() => setTab(item)} className={tab === item ? 'active' : ''}>{item}</button>)}</nav>
        <div className="tcgws-inspector-panel">
          {isLoading && <p>Loading complete card record...</p>}
          <AnimatePresence mode="wait" initial={false}>
            {detail && <motion.div key={tab} className="tcgws-inspector-panel-content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
              {tab === 'Overview' && <Overview detail={detail} />}
              {tab === 'Classification' && <ClassificationEditor detail={detail} values={classificationValues} advanced={advanced} />}
              {tab === 'Ownership' && <Ownership detail={detail} />}
              {tab === 'Engagement' && <Engagement detail={detail} />}
              {tab === 'Relationships' && <Relationships detail={detail} />}
              {tab === 'Tags' && <Tags detail={detail} />}
              {tab === 'Presentation' && (advanced ? <PresentationEditor detail={detail} /> : <p className="tcgws-note">Signature and mask adjustment is available in Advanced Mode.</p>)}
              {tab === 'Audit' && <><button className="tcgws-back tcgws-audit-back" onClick={() => setTab('Overview')}><ArrowLeft size={18} /> Back to card details</button><Audit detail={detail} advanced={advanced} /></>}
            </motion.div>}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  </motion.div>
}
