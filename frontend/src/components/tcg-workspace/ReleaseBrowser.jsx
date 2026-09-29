import { LocalizedText, useT } from '../../i18n'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, PackageOpen, RefreshCw, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import CardTile from './CardTile'
import './release-browser-premium.css'

const PREVIEW_FIELDS = ['art_url', 'image_url', 'source_url', 'thumbnail_url', 'thumb_url']

function previewUrl(card) {
  if (!card) return null
  return PREVIEW_FIELDS.map(field => card[field]).find(Boolean) || null
}

function uniquePreviewCards(cards = [], fallbackUrl = null, limit = 4) {
  const seen = new Set()
  const realCards = cards
    .map(card => ({ card, url: previewUrl(card) }))
    .filter(({ url }) => url && !seen.has(url) && seen.add(url))
    .slice(0, limit)
  if (realCards.length || !fallbackUrl || seen.has(fallbackUrl)) return realCards
  return [{ card: { card_id: 'manifest-cover' }, url: fallbackUrl }]
}

function PreviewCollage({ cards, fallbackUrl, label, limit = 4 }) {
  const previews = uniquePreviewCards(cards, fallbackUrl, limit)
  if (!previews.length) {
    return <div role="img" className="tcgws-release-browser__preview tcgws-release-browser__preview--empty" aria-label={`${label} preview unavailable`}><span><LocalizedText text={"Preview unavailable"} /></span></div>
  }
  return <div role="img" className={`tcgws-release-browser__preview ${previews.length === 1 ? 'is-single' : `is-collage is-count-${previews.length}`}`} aria-label={`${label} preview`}>
    {previews.map(({ card, url }, index) => <img key={`${card.card_id || card.id || 'preview'}-${index}`} src={url} alt="" loading="lazy" style={{ '--preview-index': index }} />)}
  </div>
}

function LoadingState({ detail = false }) {
  return <section className="tcgws-release-browser__loading" role="status" aria-live="polite" aria-label={detail ? 'Loading set cards' : 'Loading collection destinations'}>
    <div className="tcgws-release-browser__loading-status"><LoaderCircle size={22} /><strong>{detail ? 'Opening checklist' : 'Opening collection'}</strong><span><LocalizedText text={"Resolving cards and previews"} /></span></div>
    <div className="tcgws-release-browser__skeleton-grid">{Array.from({ length: detail ? 12 : 6 }, (_, index) => <div className="tcgws-release-browser__skeleton-tile" key={index}><i /><b /><em /><span /></div>)}</div>
  </section>
}

function EmptyState({ label }) {
  return <div className="tcgws-release-browser__empty-state"><PackageOpen size={28} /><strong><LocalizedText text={"No"} after={" "} />{label}<LocalizedText text={"are available yet"} before={" "} /></strong><span><LocalizedText text={"Published manifests will appear here once they are ready."} /></span></div>
}

function boosterAvailability(pack, releaseStatus) {
  if (pack.active) return pack.price ? `${Number(pack.price).toLocaleString()} credits` : 'Available now'
  if (releaseStatus !== 'published') return 'Available when this release is published'
  if (pack.purchasable) return 'Preparing this release pack'
  return 'Not available yet'
}

function SetPreview({ set, entries }) {
  const entryCards = (entries?.items || []).map(entry => entry.card).filter(Boolean)
  const cards = [...(set?.cover_cards || []), ...entryCards]
  return <PreviewCollage cards={cards} fallbackUrl={set?.cover_path} label={set?.name || 'Set'} limit={6} />
}

const RARITY_ORDER = ['C', 'R', 'SR', 'UR', 'SPR']

function RaritySummary({ item }) {
  const t = useT()
  const completion = item?.completion_by_rarity || {}
  const rarities = RARITY_ORDER
    .map(rarity => [rarity, completion[rarity]])
    .filter(([, progress]) => progress)
  if (!rarities.length) return null
  return <div className="tcgws-release-rarity-summary" aria-label={t("Rarity completion")}>
    {rarities.map(([rarity, progress]) => <span key={rarity} data-rarity={rarity}>
      <b>{rarity}</b>
      <strong>{Number(progress.owned || 0).toLocaleString()} / {Number(progress.total || 0).toLocaleString()}</strong>
    </span>)}
  </div>
}

function CompletionSummary({ completion }) {
  if (!completion) return null
  return <div className="tcgws-release-browser__completion">
    <div className="tcgws-release-browser__completion-copy">
      <b>{completion.percent}<LocalizedText text={"% complete"} /></b>
      <span>{Number(completion.base_owned || 0).toLocaleString()} / {Number(completion.base_total || 0).toLocaleString()}<LocalizedText text={"base cards"} before={" "} /></span>
    </div>
    <i><em style={{ width: `${Math.min(100, Math.max(0, Number(completion.percent) || 0))}%` }} /></i>
  </div>
}

function ReleaseEconomySummary({ detail }) {
  const t = useT()
  const report = detail?.generation_report || {}
  if (!report.formula_version) return null
  const modifier = Number(report.economy_modifier || 0)
  return <section className="tcgws-release-economy" aria-label={t("Dynamic release economy")}>
    <div><span><LocalizedText text={"Dynamic release size"} /></span><strong>{Number(report.target || 0).toLocaleString()}<LocalizedText text={"base cards"} before={" "} /></strong></div>
    <div><span><LocalizedText text={"Collection basis"} /></span><strong>{Number(report.collection_size || 0).toLocaleString()}<LocalizedText text={"base cards"} before={" "} /></strong><small>{report.collection_size_source === 'foundation_base_cards' ? 'Published Foundation' : 'Unique candidate pool fallback'}</small></div>
    <div><span><LocalizedText text={"Economy modifier"} /></span><strong>{modifier.toFixed(2)}×</strong><small>{report.formula_version}</small></div>
    <div><span><LocalizedText text={"Size curve"} /></span><strong>{(report.formula_anchors || []).map(anchor => `${Number(anchor.collection_size).toLocaleString()}→${Number(anchor.target).toLocaleString()}`).join(' · ')}</strong><small><LocalizedText text={"Candidate pool capped; small-library floor"} after={" "} />{report.small_library_floor}</small></div>
  </section>
}

export default function ReleaseBrowser({ releases = [], sets = [], releaseId, setId, onRelease, onSet, onOpenCard, setsOnly = false, advanced = false, generationMode = 'automatic' }) {
  const t = useT()
  const qc = useQueryClient()
  const [checklistPage, setChecklistPage] = useState(0)
  const checklistPageSize = 100
  useEffect(() => setChecklistPage(0), [releaseId, setId])

  const releaseIndexQuery = useQuery({
    queryKey: ['tcg-v2-releases'],
    queryFn: () => tcgV2Api.releases().then(response => response.data),
    enabled: !releaseId && !setsOnly,
  })
  const setIndexQuery = useQuery({
    queryKey: ['tcg-v2-sets'],
    queryFn: () => tcgV2Api.sets().then(response => response.data),
    enabled: !releaseId && setsOnly,
  })
  const detailQuery = useQuery({
    queryKey: ['tcg-v2-release', releaseId],
    queryFn: () => tcgV2Api.release(releaseId).then(response => response.data),
    enabled: Boolean(releaseId),
  })
  const entriesQuery = useQuery({
    queryKey: ['tcg-v2-checklist', releaseId, setId, checklistPage],
    queryFn: () => tcgV2Api.checklist({ release_id: releaseId, set_id: setId || undefined, skip: checklistPage * checklistPageSize, limit: checklistPageSize }).then(response => response.data),
    enabled: Boolean(releaseId),
  })
  const detail = detailQuery.data
  const entries = entriesQuery.data
  const indexItems = setsOnly ? (setIndexQuery.data ?? sets) : (releaseIndexQuery.data ?? releases)
  const indexLoading = setsOnly ? setIndexQuery.isLoading && !setIndexQuery.data : releaseIndexQuery.isLoading && !releaseIndexQuery.data
  const selectedSet = useMemo(() => detail?.sets?.find(item => item.id === setId), [detail, setId])

  const generate = useMutation({
    mutationFn: data => tcgV2Api.generateRelease(data),
    onSuccess: response => { qc.invalidateQueries({ queryKey: ['tcg-v2-releases'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); onRelease(response.data.id); toast.success(response.data.status === 'published' ? t("Release published") : t('Release {status}', { status: response.data.status })) },
    onError: error => toast.error(error.response?.data?.detail || t("Release generation failed")),
  })
  const publish = useMutation({
    mutationFn: id => tcgV2Api.publishRelease(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-release', releaseId] }); qc.invalidateQueries({ queryKey: ['tcg-v2-releases'] }); toast.success(t("Release published atomically")) },
    onError: error => toast.error(error.response?.data?.detail || t("Release publication was postponed")),
  })
  const generateCurrent = regenerate => { const now = new Date(); generate.mutate({ year: now.getFullYear(), month: now.getMonth() + 1, regenerate }) }

  if (!releaseId && indexLoading) return <LoadingState />
  if (!releaseId && !indexItems.length) return <section className="tcgws-release-browser"><EmptyState label={setsOnly ? 'sets' : 'releases'} /></section>

  if (!releaseId && setsOnly) return <section className="tcgws-release-browser tcgws-release-list tcgws-set-index">
    <header className="tcgws-release-browser__index-header"><div><span><LocalizedText text={"Frozen checklists"} /></span><h1><LocalizedText text={"Sets"} /></h1><p><LocalizedText text={"Browse every numbered set directly. Missing cards remain visible in their permanent collector-number positions."} /></p></div><div className="tcgws-release-browser__index-actions"><div className="tcgws-release-browser__view-count"><strong>{indexItems.length}</strong><span><LocalizedText text={"sets"} /></span></div></div></header>
    <div className="tcgws-release-browser__index-grid">{indexItems.map((set, index) => <motion.button className="tcgws-release-browser__index-tile" key={set.id} onClick={() => onSet(set.id, set.release_id)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.35) }}>
      <div className="tcgws-release-browser__cover"><PreviewCollage cards={set.cover_cards} fallbackUrl={set.cover_path} label={set.name || 'Set'} /><span className="tcgws-release-browser__code">{set.code}</span><strong>{set.name}</strong></div>
      <section><span className="tcgws-release-browser__eyebrow">{set.release_code}</span><h2>{set.name}</h2><p>{set.description || `${set.release_name} themed checklist`}</p><CompletionSummary completion={set.completion} /><RaritySummary item={set} /><div className="tcgws-release-browser__meta"><small><CalendarDays size={17} />{set.published_at?.slice(0, 10) || 'Pending publication'}</small><small>{Number(set.completion?.base_total || 0).toLocaleString()}<LocalizedText text={"base printings"} before={" "} /></small></div></section>
    </motion.button>)}</div>
  </section>

  if (!releaseId) return <section className="tcgws-release-browser tcgws-release-list">
    <header className="tcgws-release-browser__index-header"><div><span><LocalizedText text={"Published collection"} /></span><h1><LocalizedText text={"Releases"} /></h1><p><LocalizedText text={"Monthly releases stay frozen; Foundation can append personal milestone SPRs without rewriting its base cards."} /></p></div><div className="tcgws-release-browser__index-actions"><div className="tcgws-release-browser__view-count"><strong>{indexItems.length}</strong><span><LocalizedText text={"releases"} /></span></div>{advanced && <button className="tcgws-primary tcgws-generate" onClick={() => generateCurrent(false)} disabled={generate.isPending}><RefreshCw size={17} /> {generationMode === 'manual_review' ? 'Build current release for review' : 'Build and publish current release after validation'}</button>}</div></header>
    <div className="tcgws-release-browser__index-grid">{indexItems.map((release, index) => <motion.button className="tcgws-release-browser__index-tile" key={release.id} onClick={() => onRelease(release.id)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.35) }}>
      <div className="tcgws-release-browser__cover"><PreviewCollage cards={release.cover_cards} fallbackUrl={release.cover_path} label={release.name || 'Release'} /><span className="tcgws-release-browser__code">{release.code}</span><strong>{release.name}</strong></div>
      <section><div className="tcgws-release-browser__card-heading"><span className="tcgws-release-browser__eyebrow">{release.release_kind}</span><h2>{release.name}</h2><p>{release.description}</p></div><CompletionSummary completion={release.completion} /><RaritySummary item={release} /><div className="tcgws-release-browser__meta"><small><CalendarDays size={17} />{release.published_at?.slice(0, 10) || 'Pending publication'}</small><small>{release.set_count}<LocalizedText text={"sets"} before={" "} /></small></div></section>
    </motion.button>)}</div>
  </section>

  if (detailQuery.isError) return <section className="tcgws-release-browser"><button className="tcgws-back" onClick={() => setId ? onSet(null) : onRelease(null)}><ArrowLeft size={19} /><LocalizedText text={"Back"} before={" "} /></button><div className="tcgws-release-browser__empty-state"><strong><LocalizedText text={"Could not open this release"} /></strong><span><LocalizedText text={"Try opening it again from the collection index."} /></span></div></section>
  if (detailQuery.isLoading || !detail) return <section className="tcgws-release-browser"><button className="tcgws-back" onClick={() => setId ? onSet(null) : onRelease(null)}><ArrowLeft size={19} /><LocalizedText text={"Back"} before={" "} /></button><LoadingState detail /></section>

  const selectedCompletion = selectedSet?.completion || detail.completion
  return <section className="tcgws-release-browser tcgws-release-detail" aria-busy={entriesQuery.isFetching}>
    <button className="tcgws-back" onClick={() => setId ? onSet(null) : onRelease(null)}><ArrowLeft size={19} /> {setId ? 'Release overview' : (setsOnly ? 'All sets' : 'All releases')}</button>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={`${releaseId}-${setId || 'overview'}`} className="tcgws-release-browser__detail-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.24 }}>
        <header className="tcgws-release-browser__detail-header"><div><span>{detail.code} - {detail.release_kind}</span><h1>{setId ? selectedSet?.name || detail.name : detail.name}</h1><p>{setId ? selectedSet?.description || `A focused checklist from ${detail.name}.` : detail.description}</p></div><div className="tcgws-release-browser__detail-preview"><SetPreview set={setId ? selectedSet : detail} entries={setId ? entries : null} /></div><div className="tcgws-release-progress"><strong>{selectedCompletion.percent}%</strong><span>{selectedCompletion.base_owned.toLocaleString()} / {selectedCompletion.base_total.toLocaleString()}<LocalizedText text={"base printings"} before={" "} /></span>{selectedCompletion.set_complete && <b><CheckCircle2 size={17} /><LocalizedText text={"Set Complete"} before={" "} /></b>}{selectedCompletion.master_set && <b><CheckCircle2 size={17} /><LocalizedText text={"Master Set"} before={" "} /></b>}</div></header>
        {!setId && <ReleaseEconomySummary detail={detail} />}
        <div className="tcgws-set-strip" aria-label={t("Sets in this release")}>{detail.sets.map(set => <button className={set.id === setId ? 'active' : ''} key={set.id} onClick={() => onSet(set.id)}><div className="tcgws-set-strip__preview"><PreviewCollage cards={set.cover_cards} label={set.name || 'Set'} /></div><div className="tcgws-set-strip__content"><span>{set.code}</span><strong>{set.name}</strong><p>{set.completion.base_owned} / {set.completion.base_total}</p><i><b style={{ width: `${set.completion.percent}%` }} /></i></div></button>)}</div>
        <div className="tcgws-rarity-completion">{Object.entries((setId ? selectedSet?.completion_by_rarity : detail.completion_by_rarity) || {}).map(([rarity, progress]) => <span key={rarity}><b>{rarity}</b><strong>{progress.owned.toLocaleString()} / {progress.total.toLocaleString()}</strong></span>)}</div>
        {advanced && detail.status !== 'published' && <section className="tcgws-release-review"><header><div><span><LocalizedText text={"Manual release review"} /></span><h3>{detail.status}</h3></div><div><button onClick={() => generateCurrent(true)}><RefreshCw size={17} /><LocalizedText text={"Regenerate proposal"} before={" "} /></button><button className="tcgws-primary" disabled={!detail.validation?.valid || publish.isPending} onClick={() => publish.mutate(detail.id)}><Send size={17} /><LocalizedText text={"Publish frozen manifest"} before={" "} /></button></div></header><div><article><strong><LocalizedText text={"Validation"} /></strong>{(detail.validation?.errors || []).map(error => <p key={error}>{error}</p>)}{(detail.validation?.warnings || []).map(warning => <p key={warning}>{warning}</p>)}</article><article><strong><LocalizedText text={"Rarity distribution"} /></strong><pre>{JSON.stringify(detail.rarity_distribution, null, 2)}</pre></article><article><strong><LocalizedText text={"Coverage and confidence"} /></strong><pre>{JSON.stringify(detail.generation_report, null, 2)}</pre></article></div></section>}
        <div className="tcgws-release-packs"><h3><PackageOpen size={20} /><LocalizedText text={"Associated boosters"} before={" "} /></h3>{(detail.boosters || []).map(pack => <span key={pack.id}><strong>{pack.name}</strong><small>{pack.card_count}<LocalizedText text={"cards -"} before={" "} after={" "} />{boosterAvailability(pack, detail.status)}</small></span>)}</div>
        {entriesQuery.isFetching && <div className="tcgws-release-browser__syncing" role="status"><LoaderCircle size={19} /><LocalizedText text={"Resolving checklist cards"} before={" "} /></div>}
        {entriesQuery.isLoading ? <LoadingState detail /> : <div className="tcgws-card-grid">{(entries?.items || []).map(entry => <CardTile key={entry.id} card={entry.card} missing={!entry.owned} quantity={entry.quantity} number={entry.display_number} identity={entry.identity || entry} onOpen={entry.card ? () => onOpenCard(entry.card) : null} />)}</div>}
        {entries?.total > checklistPageSize && <nav className="tcgws-pagination" aria-label={t("Checklist pages")}><button disabled={checklistPage === 0} onClick={() => setChecklistPage(page => page - 1)}><ChevronLeft size={19} /><LocalizedText text={"Previous"} before={" "} /></button><span><LocalizedText text={"Page"} after={" "} />{checklistPage + 1}<LocalizedText text={"of"} before={" "} after={" "} />{Math.ceil(entries.total / checklistPageSize)}</span><button disabled={(checklistPage + 1) * checklistPageSize >= entries.total} onClick={() => setChecklistPage(page => page + 1)}><LocalizedText text={"Next"} after={" "} /><ChevronRight size={19} /></button></nav>}
      </motion.div>
    </AnimatePresence>
  </section>
}
