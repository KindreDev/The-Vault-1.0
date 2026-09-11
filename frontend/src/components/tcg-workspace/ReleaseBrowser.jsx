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
    return <div role="img" className="tcgws-release-browser__preview tcgws-release-browser__preview--empty" aria-label={`${label} preview unavailable`}><span>Preview unavailable</span></div>
  }
  return <div role="img" className={`tcgws-release-browser__preview ${previews.length === 1 ? 'is-single' : `is-collage is-count-${previews.length}`}`} aria-label={`${label} preview`}>
    {previews.map(({ card, url }, index) => <img key={`${card.card_id || card.id || 'preview'}-${index}`} src={url} alt="" loading="lazy" style={{ '--preview-index': index }} />)}
  </div>
}

function LoadingState({ detail = false }) {
  return <section className="tcgws-release-browser__loading" role="status" aria-live="polite" aria-label={detail ? 'Loading set cards' : 'Loading collection destinations'}>
    <div className="tcgws-release-browser__loading-status"><LoaderCircle size={22} /><strong>{detail ? 'Opening checklist' : 'Opening collection'}</strong><span>Resolving cards and previews</span></div>
    <div className="tcgws-release-browser__skeleton-grid">{Array.from({ length: detail ? 12 : 6 }, (_, index) => <div className="tcgws-release-browser__skeleton-tile" key={index}><i /><b /><em /><span /></div>)}</div>
  </section>
}

function EmptyState({ label }) {
  return <div className="tcgws-release-browser__empty-state"><PackageOpen size={28} /><strong>No {label} are available yet</strong><span>Published manifests will appear here once they are ready.</span></div>
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

export default function ReleaseBrowser({ releases = [], sets = [], releaseId, setId, onRelease, onSet, onOpenCard, setsOnly = false, advanced = false, generationMode = 'automatic' }) {
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
    onSuccess: response => { qc.invalidateQueries({ queryKey: ['tcg-v2-releases'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); onRelease(response.data.id); toast.success(response.data.status === 'published' ? 'Release published' : `Release ${response.data.status}`) },
    onError: error => toast.error(error.response?.data?.detail || 'Release generation failed'),
  })
  const publish = useMutation({
    mutationFn: id => tcgV2Api.publishRelease(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-release', releaseId] }); qc.invalidateQueries({ queryKey: ['tcg-v2-releases'] }); toast.success('Release published atomically') },
    onError: error => toast.error(error.response?.data?.detail || 'Release publication was postponed'),
  })
  const generateCurrent = regenerate => { const now = new Date(); generate.mutate({ year: now.getFullYear(), month: now.getMonth() + 1, regenerate }) }

  if (!releaseId && indexLoading) return <LoadingState />
  if (!releaseId && !indexItems.length) return <section className="tcgws-release-browser"><EmptyState label={setsOnly ? 'sets' : 'releases'} /></section>

  if (!releaseId && setsOnly) return <section className="tcgws-release-browser tcgws-release-list tcgws-set-index">
    <header className="tcgws-release-browser__index-header"><div><span>Frozen checklists</span><h1>Sets</h1><p>Browse every numbered set directly. Missing cards remain visible in their permanent collector-number positions.</p></div><div className="tcgws-release-browser__view-count">{indexItems.length} sets</div></header>
    <div className="tcgws-release-browser__index-grid">{indexItems.map((set, index) => <motion.button className="tcgws-release-browser__index-tile" key={set.id} onClick={() => onSet(set.id, set.release_id)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.35) }}>
      <div className="tcgws-release-browser__cover"><PreviewCollage cards={set.cover_cards} fallbackUrl={set.cover_path} label={set.name || 'Set'} /><span className="tcgws-release-browser__code">{set.code}</span><strong>{set.name}</strong></div>
      <section><span className="tcgws-release-browser__eyebrow">{set.release_code}</span><h2>{set.name}</h2><p>{set.description || `${set.release_name} themed checklist`}</p><div className="tcgws-release-browser__completion"><b>{set.completion.percent}% complete</b><i><em style={{ width: `${set.completion.percent}%` }} /></i></div><small><CalendarDays size={17} />{set.published_at?.slice(0, 10) || 'Pending publication'} - {set.completion.base_total} base printings</small></section>
    </motion.button>)}</div>
  </section>

  if (!releaseId) return <section className="tcgws-release-browser tcgws-release-list">
    <header className="tcgws-release-browser__index-header"><div><span>Published collection</span><h1>Releases</h1><p>Published releases keep their checklist and numbering locked permanently.</p>{advanced && <button className="tcgws-primary tcgws-generate" onClick={() => generateCurrent(false)} disabled={generate.isPending}><RefreshCw size={17} /> {generationMode === 'manual_review' ? 'Build current release for review' : 'Build and publish current release after validation'}</button>}</div><div className="tcgws-release-browser__view-count">{indexItems.length} releases</div></header>
    <div className="tcgws-release-browser__index-grid">{indexItems.map((release, index) => <motion.button className="tcgws-release-browser__index-tile" key={release.id} onClick={() => onRelease(release.id)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.35) }}>
      <div className="tcgws-release-browser__cover"><PreviewCollage cards={release.cover_cards} fallbackUrl={release.cover_path} label={release.name || 'Release'} /><span className="tcgws-release-browser__code">{release.code}</span><strong>{release.name}</strong></div>
      <section><span className="tcgws-release-browser__eyebrow">{release.release_kind}</span><h2>{release.name}</h2><p>{release.description}</p><div className="tcgws-release-browser__completion"><b>{release.completion.percent}% complete</b><i><em style={{ width: `${release.completion.percent}%` }} /></i></div><small><CalendarDays size={17} />{release.published_at?.slice(0, 10) || 'Pending publication'} - {release.set_count} sets</small></section>
    </motion.button>)}</div>
  </section>

  if (detailQuery.isError) return <section className="tcgws-release-browser"><button className="tcgws-back" onClick={() => setId ? onSet(null) : onRelease(null)}><ArrowLeft size={19} /> Back</button><div className="tcgws-release-browser__empty-state"><strong>Could not open this release</strong><span>Try opening it again from the collection index.</span></div></section>
  if (detailQuery.isLoading || !detail) return <section className="tcgws-release-browser"><button className="tcgws-back" onClick={() => setId ? onSet(null) : onRelease(null)}><ArrowLeft size={19} /> Back</button><LoadingState detail /></section>

  const selectedCompletion = selectedSet?.completion || detail.completion
  return <section className="tcgws-release-browser tcgws-release-detail" aria-busy={entriesQuery.isFetching}>
    <button className="tcgws-back" onClick={() => setId ? onSet(null) : onRelease(null)}><ArrowLeft size={19} /> {setId ? 'Release overview' : (setsOnly ? 'All sets' : 'All releases')}</button>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={`${releaseId}-${setId || 'overview'}`} className="tcgws-release-browser__detail-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.24 }}>
        <header className="tcgws-release-browser__detail-header"><div><span>{detail.code} - {detail.release_kind}</span><h1>{setId ? selectedSet?.name || detail.name : detail.name}</h1><p>{setId ? selectedSet?.description || `A focused checklist from ${detail.name}.` : detail.description}</p></div><div className="tcgws-release-browser__detail-preview"><SetPreview set={setId ? selectedSet : detail} entries={setId ? entries : null} /></div><div className="tcgws-release-progress"><strong>{selectedCompletion.percent}%</strong><span>{selectedCompletion.base_owned.toLocaleString()} / {selectedCompletion.base_total.toLocaleString()} base printings</span>{selectedCompletion.set_complete && <b><CheckCircle2 size={17} /> Set Complete</b>}{selectedCompletion.master_set && <b><CheckCircle2 size={17} /> Master Set</b>}</div></header>
        <div className="tcgws-set-strip" aria-label="Sets in this release">{detail.sets.map(set => <button className={set.id === setId ? 'active' : ''} key={set.id} onClick={() => onSet(set.id)}><div className="tcgws-set-strip__preview"><PreviewCollage cards={set.cover_cards} label={set.name || 'Set'} /></div><div className="tcgws-set-strip__content"><span>{set.code}</span><strong>{set.name}</strong><p>{set.completion.base_owned} / {set.completion.base_total}</p><i><b style={{ width: `${set.completion.percent}%` }} /></i></div></button>)}</div>
        <div className="tcgws-rarity-completion">{Object.entries((setId ? selectedSet?.completion_by_rarity : detail.completion_by_rarity) || {}).map(([rarity, progress]) => <span key={rarity}><b>{rarity}</b><strong>{progress.owned.toLocaleString()} / {progress.total.toLocaleString()}</strong></span>)}</div>
        {advanced && detail.status !== 'published' && <section className="tcgws-release-review"><header><div><span>Manual release review</span><h3>{detail.status}</h3></div><div><button onClick={() => generateCurrent(true)}><RefreshCw size={17} /> Regenerate proposal</button><button className="tcgws-primary" disabled={!detail.validation?.valid || publish.isPending} onClick={() => publish.mutate(detail.id)}><Send size={17} /> Publish frozen manifest</button></div></header><div><article><strong>Validation</strong>{(detail.validation?.errors || []).map(error => <p key={error}>{error}</p>)}{(detail.validation?.warnings || []).map(warning => <p key={warning}>{warning}</p>)}</article><article><strong>Rarity distribution</strong><pre>{JSON.stringify(detail.rarity_distribution, null, 2)}</pre></article><article><strong>Coverage and confidence</strong><pre>{JSON.stringify(detail.generation_report, null, 2)}</pre></article></div></section>}
        <div className="tcgws-release-packs"><h3><PackageOpen size={20} /> Associated boosters</h3>{(detail.boosters || []).map(pack => <span key={pack.id}><strong>{pack.name}</strong><small>{pack.card_count} cards - {boosterAvailability(pack, detail.status)}</small></span>)}</div>
        {entriesQuery.isFetching && <div className="tcgws-release-browser__syncing" role="status"><LoaderCircle size={19} /> Resolving checklist cards</div>}
        {entriesQuery.isLoading ? <LoadingState detail /> : <div className="tcgws-card-grid">{(entries?.items || []).map(entry => <CardTile key={entry.id} card={entry.card} missing={!entry.owned} quantity={entry.quantity} number={entry.display_number} identity={entry.identity || entry} onOpen={entry.card ? () => onOpenCard(entry.card) : null} />)}</div>}
        {entries?.total > checklistPageSize && <nav className="tcgws-pagination" aria-label="Checklist pages"><button disabled={checklistPage === 0} onClick={() => setChecklistPage(page => page - 1)}><ChevronLeft size={19} /> Previous</button><span>Page {checklistPage + 1} of {Math.ceil(entries.total / checklistPageSize)}</span><button disabled={(checklistPage + 1) * checklistPageSize >= entries.total} onClick={() => setChecklistPage(page => page + 1)}>Next <ChevronRight size={19} /></button></nav>}
      </motion.div>
    </AnimatePresence>
  </section>
}
