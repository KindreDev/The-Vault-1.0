import { LocalizedText, useT } from '../../../i18n'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cardMasksApi, tcgV2Api } from '../../../lib/api'
import TCGV2CardFace from '../../tcg-v2/TCGV2CardFace'
import TCGSelect from '../TCGSelect'

// Advanced Mode tools: Spice/Exposure overrides and the card face editor.

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
  const dirty = exposure !== (detail.classification.manual.exposure || 'AI') || intensity !== (detail.classification.manual.intensity || 'AI')
  return (
    <div className="tcgws-classification">
      <div className="tcgws-axis">
        <header><div><span><LocalizedText text={"Exposure"} /></span><strong>{detail.classification.exposure}</strong></div><i>{t(sourceLabel(detail.classification.sources?.exposure))}</i></header>
        <p><LocalizedText text={"How much of the body is exposed in the printed artwork. This does not determine sexual intensity."} /></p>
        {exposureOmitted && <p className="tcgws-identity-omission"><LocalizedText text={"Creator and Character cards intentionally omit Exposure on the card face. Spice remains independently classified."} /></p>}
        <TCGSelect label={t('Exposure')} hideLabel value={exposure} onChange={setExposure} disabled={!advanced || exposureOmitted}
                   options={[{ value: 'AI', label: t('Use resolved AI result') }, ...values.exposure.map(value => ({ value, label: value }))]} />
        <small><LocalizedText text={"AI confidence:"} after={" "} />{detail.classification.ai.exposure_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.exposure_confidence * 100)}%`}</small>
      </div>
      <div className="tcgws-axis">
        <header><div><span><LocalizedText text={"Spice"} /></span><strong>{detail.classification.intensity}</strong></div><i>{t(sourceLabel(detail.classification.sources?.intensity))}</i></header>
        <p><LocalizedText text={"Safe, Suggestive, Explicit or Hardcore. Taken from the source file's Spice."} /></p>
        <TCGSelect label={t('Spice')} hideLabel value={intensity} onChange={setIntensity} disabled={!advanced}
                   options={[{ value: 'AI', label: t('Use resolved AI result') }, ...values.intensity.map(value => ({ value, label: value }))]} />
        <small><LocalizedText text={"AI confidence:"} after={" "} />{detail.classification.ai.intensity_confidence == null ? 'Unknown' : `${Math.round(detail.classification.ai.intensity_confidence * 100)}%`}</small>
      </div>
      {advanced && dirty && <button className="tcgws-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}><LocalizedText text={"Save"} /></button>}
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


export default function EditTab({ detail, values, advanced }) {
  if (!advanced) return <p className="tcgws-note"><LocalizedText text={"Editing is available in Advanced Mode."} /></p>
  return <div className="tcgcw-stack">
    <ClassificationEditor detail={detail} values={values} advanced={advanced} />
    <PresentationEditor detail={detail} />
  </div>
}
