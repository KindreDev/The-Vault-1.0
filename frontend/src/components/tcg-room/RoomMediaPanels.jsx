import { LocalizedText, useT } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, ChevronLeft, ChevronRight, Film, Images, Layers, Pencil, X } from 'lucide-react'
import { apiErrorMessage, tcgV2Api } from '../../lib/api'
import BinderWorkspace from '../tcg-workspace/BinderWorkspace'
import { SCREEN_FRAMES } from './roomLayout'
import { DEFAULT_SOURCE, savedSource, sourceKey, sourceReady, useFlipBinImages, useFurnitureContent, usePagedSource, vaultThumb } from './roomMedia'
import { posterImageUrl } from './RoomPosterDisplays'
import RoomSourcePicker from './RoomSourcePicker'

const POSTER_BIN_LIMIT = 24
const INTERVALS = [5, 8, 15, 30, 60]

// ── Binder lectern ─────────────────────────────────────────────────────────

/** The 2D binder, opened at the page the lectern shows; turning pages here turns them there. */
export function RoomLecternPanel({ bootstrap, instanceId }) {
  const { content, save } = useFurnitureContent(bootstrap, instanceId)
  const { data: binders = [], isLoading } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(r => r.data) })
  const pending = useRef(null)
  const saved = useRef({ binderId: content.binder_id, spread: content.spread || 0 })
  const onViewChange = useCallback(view => {
    if (view.binderId === saved.current.binderId && view.spread === saved.current.spread) return
    window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      saved.current = view
      save.mutate({ binder_id: view.binderId, spread: view.spread })
    }, 450)
  }, [save])
  useEffect(() => () => window.clearTimeout(pending.current), [])
  if (isLoading) return null
  const initialBinderId = content.binder_id || binders[0]?.id || null
  return <div className="tcg-room-lectern">
    <BinderWorkspace onOpenCard={() => {}} initialBinderId={initialBinderId} initialSpread={content.spread || 0} onViewChange={onViewChange} />
  </div>
}

// ── Wall TV / digital photo frame ──────────────────────────────────────────

export function RoomScreenManager({ bootstrap, instanceId, assetId }) {
  const t = useT()
  const { content, save } = useFurnitureContent(bootstrap, instanceId)
  const frame = SCREEN_FRAMES[assetId] || SCREEN_FRAMES.wall_tv
  const [mode, setMode] = useState(content.screen_mode || 'slideshow')
  const playingSource = savedSource(content)
  const [photoSource, setPhotoSource] = useState(playingSource)
  const [videoSource, setVideoSource] = useState(DEFAULT_SOURCE)
  const photos = usePagedSource(photoSource, { enabled: mode === 'slideshow' && sourceReady(photoSource) })
  const videos = usePagedSource(videoSource, { videos: true, enabled: mode === 'video' && sourceReady(videoSource) })
  const interval = content.interval || 8
  const fit = content.fit || frame.fit
  const update = (changes, done) => save.mutate(changes, {
    onSuccess: () => done && toast.success(t(done)),
    onError: error => toast.error(apiErrorMessage(error, t('Could not update the screen'))),
  })
  const showingThis = content.screen_mode !== 'video' && sourceKey(playingSource) === sourceKey(photoSource)
  return <div className="tcg-room-screen-manager">
    <div className="tcg-room-display-manager__fit" role="tablist" aria-label={t('Screen mode')}>
      <button type="button" role="tab" aria-selected={mode === 'slideshow'} className={mode === 'slideshow' ? 'selected' : ''} onClick={() => setMode('slideshow')}><Images size={16} /> <LocalizedText text="Slideshow" /></button>
      <button type="button" role="tab" aria-selected={mode === 'video'} className={mode === 'video' ? 'selected' : ''} onClick={() => setMode('video')}><Film size={16} /> <LocalizedText text="Video" /></button>
    </div>
    {mode === 'slideshow' && <>
      <RoomSourcePicker value={photoSource} onChange={setPhotoSource} searchPlaceholder={t('Tags or filename (empty = random photos)')} />
      <div className="tcg-room-screen-manager__row">
        <span><LocalizedText text="Change every" /></span>
        <div className="tcg-room-display-manager__rarities">{INTERVALS.map(value => <button key={value} type="button" className={interval === value ? 'selected' : ''} onClick={() => update({ interval: value })}>{value < 60 ? `${value}s` : `${value / 60} min`}</button>)}</div>
      </div>
      <div className="tcg-room-display-manager__fit">
        {[['cover', 'Fill frame'], ['contain', 'Show whole photo']].map(([value, label]) => <button key={value} type="button" className={fit === value ? 'selected' : ''} onClick={() => update({ fit: value })}><LocalizedText text={label} /></button>)}
      </div>
      <button type="button" className="primary" disabled={save.isPending || !sourceReady(photoSource) || showingThis}
        onClick={() => update({ screen_mode: 'slideshow', source: photoSource, query: photoSource.kind === 'search' ? photoSource.query || '' : '' }, 'Slideshow playing')}>
        {showingThis ? <><Check size={16} /> <LocalizedText text="Playing these photos" /></> : <LocalizedText text="Play these photos" />}
      </button>
      {sourceReady(photoSource) && photos.total > 0 && <div className="tcg-room-display-manager__count">{t('{count} photos', { count: photos.total.toLocaleString() })}</div>}
      <div className="tcg-room-display-manager__cards">{photos.items.map(image => <figure key={image.id}><img src={vaultThumb(image)} alt="" loading="lazy" /></figure>)}
        <div ref={photos.sentinel} className="tcg-room-display-manager__more" />
      </div>
    </>}
    {mode === 'video' && <>
      <RoomSourcePicker value={videoSource} onChange={setVideoSource} searchPlaceholder={t('Search video filenames')} />
      <div className="tcg-room-display-manager__cards">{videos.items.map(video => (
        <button key={video.id} type="button" disabled={save.isPending} onClick={() => update({ screen_mode: 'video', video_id: video.id }, 'Video playing')}>
          <img src={vaultThumb(video)} alt="" loading="lazy" />
          {content.screen_mode === 'video' && content.video_id === video.id && <small><LocalizedText text="On screen" /></small>}
        </button>
      ))}
        <div ref={videos.sentinel} className="tcg-room-display-manager__more" />
      </div>
      {sourceReady(videoSource) && !videos.items.length && !videos.loading && <div className="tcg-room-empty"><strong><LocalizedText text="No videos match" /></strong></div>}
    </>}
  </div>
}

// ── Poster flip bin ────────────────────────────────────────────────────────

export function RoomFlipBinPanel({ bootstrap, instanceId }) {
  const t = useT()
  const { content, save } = useFurnitureContent(bootstrap, instanceId)
  const ids = useFlipBinImages(content)
  const [editing, setEditing] = useState(!content.use_source && !(content.image_ids || []).length)
  const picked = useMemo(() => (Array.isArray(content.image_ids) ? content.image_ids : []), [content.image_ids])
  const [draft, setDraft] = useState(picked)
  const [source, setSource] = useState(savedSource(content))
  const [index, setIndex] = useState(0)
  const library = usePagedSource(source, { enabled: editing && sourceReady(source) })
  const frontTimer = useRef(null)
  useEffect(() => { setDraft(picked) }, [picked])
  useEffect(() => { setIndex(ids.length ? (content.front || 0) % ids.length : 0) }, [ids.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // Flipping moves that poster to the front of the bin in the room.
  const flip = useCallback(step => {
    if (!ids.length) return
    const next = (index + step + ids.length) % ids.length
    setIndex(next)
    window.clearTimeout(frontTimer.current)
    frontTimer.current = window.setTimeout(() => save.mutate({ front: next }), 500)
  }, [ids.length, index, save])
  useEffect(() => () => window.clearTimeout(frontTimer.current), [])
  useEffect(() => {
    if (editing) return undefined
    const keys = event => {
      if (event.key === 'ArrowRight') { event.preventDefault(); flip(1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); flip(-1) }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [editing, flip])
  const toggle = imageId => setDraft(current => current.includes(imageId)
    ? current.filter(value => value !== imageId)
    : current.length >= POSTER_BIN_LIMIT ? current : [...current, imageId])
  const finish = message => ({
    onSuccess: () => { setIndex(0); setEditing(false); toast.success(t(message)) },
    onError: error => toast.error(apiErrorMessage(error, t('Could not update the posters'))),
  })
  const savePicked = () => save.mutate({ image_ids: draft, use_source: false, front: 0, source: sourceReady(source) ? source : undefined }, finish('Posters updated'))
  const useWholeSource = () => save.mutate({ use_source: true, front: 0, source }, finish('The bin now follows this source'))
  const followingLabel = content.source?.name || content.source?.query || t('random photos')

  if (!editing) return <div className="tcg-room-flip-bin">
    <figure className="tcg-room-flip-bin__poster">
      {ids.length ? <img key={ids[index]} src={posterImageUrl(ids[index])} alt="" /> : null}
    </figure>
    <div className="tcg-room-flip-bin__controls">
      <button type="button" onClick={() => flip(-1)} aria-label={t('Previous poster')}><ChevronLeft size={22} /></button>
      <span>{ids.length ? index + 1 : 0} / {ids.length}</span>
      <button type="button" onClick={() => flip(1)} aria-label={t('Next poster')}><ChevronRight size={22} /></button>
      <button type="button" className="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> <LocalizedText text="Choose posters" /></button>
    </div>
    {content.use_source && <p className="tcg-room-flip-bin__note">{t('Following {source}', { source: followingLabel })}</p>}
  </div>

  return <div className="tcg-room-flip-bin tcg-room-flip-bin--editing">
    <RoomSourcePicker value={source} onChange={setSource} />
    {sourceReady(source) && <button type="button" className="tcg-room-flip-bin__whole" disabled={save.isPending} onClick={useWholeSource}>
      <Layers size={16} /> <LocalizedText text="Use the whole source" />
      <small>{library.total ? t('{count} photos, updates by itself', { count: library.total.toLocaleString() }) : t('Updates by itself')}</small>
    </button>}
    <div className="tcg-room-flip-bin__chosen">
      <span>{t('Or pick photos: {count} / {limit}', { count: draft.length, limit: POSTER_BIN_LIMIT })}</span>
      <div>{draft.map(imageId => <button key={imageId} type="button" title={t('Remove')} onClick={() => toggle(imageId)}><img src={`/api/images/${imageId}/thumb`} alt="" /><X size={14} /></button>)}</div>
    </div>
    <div className="tcg-room-display-manager__cards">{library.items.map(image => (
      <button key={image.id} type="button" className={draft.includes(image.id) ? 'selected' : ''} onClick={() => toggle(image.id)}>
        <img src={vaultThumb(image)} alt="" loading="lazy" />
        {draft.includes(image.id) && <small>{draft.indexOf(image.id) + 1}</small>}
      </button>
    ))}
      <div ref={library.sentinel} className="tcg-room-display-manager__more" />
    </div>
    <div className="tcg-room-flip-bin__controls">
      {(ids.length > 0 || content.use_source) && <button type="button" className="secondary" onClick={() => { setDraft(picked); setEditing(false) }}><LocalizedText text="Cancel" /></button>}
      <button type="button" className="primary" disabled={save.isPending || !draft.length} onClick={savePicked}><LocalizedText text="Put these in the bin" /></button>
    </div>
  </div>
}
