import React, { useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckSquare, Square, Images as ImagesIcon, Play, Droplets, LayoutGrid } from 'lucide-react'
import HoverVideoPreview from '../HoverVideoPreview'
import CardCreatorNames from '../CardCreatorNames'
import '../../pages/media-list-cards.css'
import { useVaultStore } from '../../store/vault'
import { useT, LocalizedText } from '../../i18n'
import { CREATOR_TYPE_TEXT } from '../../lib/entityColors'
import JustifiedGrid from './JustifiedGrid'
import DetailsTable from './DetailsTable'
import TimelineSections from './TimelineSections'
import { timelineDate, formatShortDate, formatBytes } from './viewModes'

// Photo/video tiles and the list views built from them (Squares, Masonry,
// Justified rows, Details, Timeline). Used by the Photos and Videos lists and
// by the Photos and Videos tabs of a creator's page.

const TYPE_COLORS = CREATOR_TYPE_TEXT

// Shared order with the Galleries sorts (GalleryList.jsx): common sorts
// first, page-specific ones next, Random last.
export const COMMON_SORTS = [
  { value: 'date_added',    label: 'Date added' },
  { value: 'date_modified', label: 'Date modified' },
  { value: 'filename',      label: 'Name' },
  { value: 'rating',        label: 'Rating' },
  { value: 'view_count',    label: 'Most viewed' },
  { value: 'cum_count',     label: 'Most cummed' },
  { value: 'edge_count',    label: 'Most edged' },
  { value: 'period',        label: 'Period' },
  { value: 'last_viewed',   label: 'Recently viewed' },
  { value: 'view_seconds',  label: 'Watch time' },
]
export const SIZE_SORTS = [
  { value: 'file_size',     label: 'File size' },
  { value: 'resolution',    label: 'Resolution' },
]
export const RANDOM_SORT = { value: 'random', label: 'Random' }

export const SORTS = [...COMMON_SORTS, ...SIZE_SORTS, RANDOM_SORT]
export const VIDEO_SORTS = [...COMMON_SORTS, { value: 'duration', label: 'Length' }, ...SIZE_SORTS, RANDOM_SORT]

export function formatVideoDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return '—'
  const total = Math.round(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}


// ── Thumbnail ──────────────────────────────────────────────────────────────────
export function ImageThumb({ image, onClick, bulkMode, selected, onSelect, onContextMenu, masonry = false, fill = false, hideCreators = false }) {
  const [failed, setFailed] = useState(false)
  const [hoverVideo, setHoverVideo] = useState(false)
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const queue = useVaultStore(s => s.multiViewerQueue)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const t = useT()
  const inQueue = queue.some(q => q.id === `img-${image.id}`)

  const handleSendToViewer = (e) => {
    e.stopPropagation()
    if (queue.length >= MAX) { toast.error(t('Playlists full ({max}/{max})', { max: MAX })); return }
    const ok = addToMultiViewer({ id: `img-${image.id}`, type: 'image', media: image })
    if (ok) toast.success(t('Sent to Playlists'))
    else toast(t('Already in Playlists'), { icon: '✓' })
  }

  const hoverPreviews = useVaultStore(s => s.hoverPreviewsEnabled)
  const handleMouseEnter = useCallback(() => {
    if (image.is_video && hoverPreviews) setHoverVideo(true)
  }, [image.is_video, hoverPreviews])

  const handleMouseLeave = useCallback(() => {
    if (image.is_video) setHoverVideo(false)
  }, [image.is_video])

  return (
    <div onClick={bulkMode ? (e) => onSelect(image.id, e) : onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(image, e) }}
      className="media-list-card relative rounded-[8px] overflow-hidden cursor-pointer group animate-fade-in"
      style={{
        height: fill ? '100%' : undefined,
        background: 'rgba(255,255,255,0.04)',
        border: `0.5px solid ${inQueue ? 'color-mix(in srgb, var(--c-accent) 50%, transparent)' : 'rgba(255,255,255,0.07)'}`,

      }}>
      <div className="relative overflow-hidden media-list-card-image" style={{
        // Squares, the file's own shape (masonry), or the box the justified
        // row gives it (fill).
        height: fill ? '100%' : undefined,
        aspectRatio: fill ? undefined : masonry && image.width && image.height
          ? `${image.width} / ${image.height}` : '1',
      }}>

      {bulkMode && (
        <div className="absolute top-2 left-2 z-[20]"
          onClick={e => { e.stopPropagation(); onSelect(image.id) }}>
          {selected
            ? <CheckSquare size={16} style={{ color: 'var(--c-accent)' }} />
            : <Square size={16} style={{ color: 'rgba(255,255,255,0.5)', fill: 'rgba(0,0,0,0.4)' }} />
          }
        </div>
      )}
      {selected && (
        <div className="media-selection-overlay absolute inset-0 z-10 pointer-events-none rounded-[8px]"
          style={{ border: '2px solid var(--c-accent)', background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)' }} />
      )}

      {/* Static thumbnail */}
      {!failed
        ? <img src={`/api/images/${image.id}/thumb`} alt={image.filename}
          className="w-full h-full object-cover transition-transform duration-200"
          // Video thumbs are padded to a square around the frame; in a box of
          // the video's own shape, centering shows exactly the frame.
          style={{ objectPosition: image.is_video && (fill || masonry) ? 'center' : 'center top', transform: hoverVideo ? 'scale(1)' : undefined }}
          onError={() => setFailed(true)} />
        : <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
          <ImagesIcon size={20} style={{ color: 'rgba(255,255,255,0.1)' }} />
          <div className="text-[16px] text-[rgba(255,255,255,0.2)] text-center truncate w-full">{image.filename}</div>
        </div>
      }

      {/* Video hover preview */}
      {image.is_video && <HoverVideoPreview imageId={image.id} hovered={hoverVideo} />}

      {/* Video play icon (when not hovering) */}
      {image.is_video && !hoverVideo && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', border: '0.5px solid rgba(255,255,255,0.2)' }}>
            <Play size={11} fill="white" style={{ color: 'white', marginLeft: 1 }} />
          </div>
        </div>
      )}

      {/* Funscripted badge */}
      {image.funscript_path && (
        <div className="absolute top-1 left-1 text-[16px] font-bold px-1 py-0.5 rounded"
          style={{ background: 'color-mix(in srgb, var(--c-accent) 85%, transparent)', color: '#fff', zIndex: 4, letterSpacing: '0.05em' }}><LocalizedText text={"FS"} before=" " after=" " /></div>
      )}

      {/* Scanned video duration */}
      {image.is_video && (
        <div
          className="absolute top-1 right-1 rounded-md px-2 py-1 font-semibold leading-none tabular-nums"
          title={image.duration > 0 ? 'Video duration' : 'Video duration not available'}
          style={{
            background: 'rgba(0,0,0,0.82)',
            border: '1px solid color-mix(in srgb, var(--c-accent) 65%, transparent)',
            color: 'var(--c-accent-text)',
            fontSize: 16,
            zIndex: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          {formatVideoDuration(image.duration)}
        </div>
      )}

      {(image.rating > 0 || image.cum_count > 0) && (
        <div className="absolute bottom-1 right-1 flex items-center gap-1" style={{ zIndex: 3 }}>
          {image.rating > 0 && (
            <div className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.75)', color: '#EF9F27' }}>
              <span style={{ fontSize: 9, lineHeight: 1 }}>★</span> {image.rating}
            </div>
          )}
          {image.cum_count > 0 && (
            <div className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.75)', color: 'var(--c-pink-text)' }}>
              <Droplets size={8} /> {image.cum_count}
            </div>
          )}
        </div>
      )}
      {/* Send to Playlists */}
      <button
        onMouseDown={handleSendToViewer}
        title={t('Send to Playlists')}
        className="absolute top-9 right-1 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer z-10"
        style={inQueue
          ? { background: 'color-mix(in srgb, var(--c-accent) 70%, transparent)', opacity: 1 }
          : { background: 'rgba(0,0,0,0.6)', opacity: 0, transition: 'opacity 0.15s' }
        }
        onMouseEnter={e => { if (!inQueue) e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { if (!inQueue) e.currentTarget.style.opacity = '0' }}>
        <LayoutGrid size={9} color="#fff" />
      </button>
      {!hideCreators && image.creators?.length > 0 && <div className="media-list-card-creators"
        style={{ bottom: image.rating > 0 || image.cum_count > 0 ? 32 : 6 }}>
        <CardCreatorNames creators={image.creators} colors={TYPE_COLORS} />
      </div>}
      </div>
    </div>
  )
}



// ── List views (Squares, Masonry, Justified rows, Details, Timeline) ──────────
const mediaAspect = (img) => (img.width && img.height ? img.width / img.height : img.is_video ? 16 / 9 : 1)

// hideCreators: on a creator's own page every tile would repeat their name.
export default function MediaListView({ mode, images, onlyVideos, thumbSize, bulkMode, selected, onSelect, onOpen, onContextMenu, sortBy, sortDir, onSort, onSortDir, hideCreators = false }) {
  const locale = useVaultStore(s => s.locale)
  const thumb = (img, index, extra = {}) => (
    <ImageThumb key={img.id} image={img} onClick={() => onOpen(index)} bulkMode={bulkMode}
                selected={selected.has(img.id)} onSelect={onSelect} onContextMenu={onContextMenu} hideCreators={hideCreators} {...extra} />
  )
  // Timeline sections line up under their left-aligned month header.
  const squares = (entries) => (
    <div className="vault-theme-media-grid grid gap-2 grid-stagger"
         style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${thumbSize}px, 100%), ${thumbSize}px))`, justifyContent: mode === 'timeline' ? 'start' : 'center' }}>
      {entries.map(({ item, index }) => thumb(item, index))}
    </div>
  )

  if (mode === 'masonry') {
    return (
      <div className="vault-theme-media-grid grid-stagger" style={{ columns: `${thumbSize}px`, columnGap: '8px' }}>
        {images.map((img, i) => (
          <div key={img.id} style={{ breakInside: 'avoid', marginBottom: '8px' }}>
            {thumb(img, i, { masonry: true })}
          </div>
        ))}
      </div>
    )
  }
  if (mode === 'justified') {
    return (
      <JustifiedGrid className="vault-theme-media-grid" items={images} getAspect={mediaAspect} targetHeight={thumbSize}
                     renderItem={(img, i) => thumb(img, i, { fill: true })} />
    )
  }
  if (mode === 'timeline') {
    return <TimelineSections items={images} getDate={img => timelineDate(img, sortBy, 'file_modified_at')} renderGroup={squares} />
  }
  if (mode === 'details') {
    const creatorNames = (img) => (img.creators ?? []).map(c => c.name).join(', ') || '—'
    const columns = [
      { key: 'name', label: 'Name', sort: 'filename', primary: true, render: img => <span title={img.filename}>{img.filename}</span> },
      hideCreators ? null : { key: 'creator', label: 'Creator', render: img => <span title={creatorNames(img)}>{creatorNames(img)}</span> },
      onlyVideos
        ? { key: 'length', label: 'Length', sort: 'duration', align: 'right', render: img => formatVideoDuration(img.duration) }
        : { key: 'gallery', label: 'Gallery', render: img => <span title={img.gallery_name || ''}>{img.gallery_name || '—'}</span> },
      { key: 'res', label: 'Resolution', sort: 'resolution', align: 'right', render: img => (img.width && img.height ? `${img.width}×${img.height}` : '—') },
      { key: 'size', label: 'File size', sort: 'file_size', align: 'right', render: img => formatBytes(img.file_size) },
      { key: 'rating', label: 'Rating', sort: 'rating', align: 'right', render: img => (img.rating > 0 ? <span style={{ color: '#EF9F27' }}>★ {img.rating}</span> : '—') },
      { key: 'views', label: 'Views', sort: 'view_count', align: 'right', render: img => img.view_count || 0 },
      { key: 'cums', label: 'Cums', sort: 'cum_count', align: 'right', render: img => img.cum_count || 0 },
      onlyVideos
        ? { key: 'watched', label: 'Last watched', sort: 'last_viewed', align: 'right', render: img => formatShortDate(img.last_viewed_at, locale) }
        : null,
      { key: 'added', label: 'Added', sort: 'date_added', align: 'right', render: img => formatShortDate(img.created_at, locale) },
    ].filter(Boolean)
    return (
      <DetailsTable rows={images} columns={columns}
                    thumb={img => <img src={`/api/images/${img.id}/thumb`} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    sortBy={sortBy} sortDir={sortDir} onSort={onSort} onSortDir={onSortDir}
                    onRowClick={(_, index) => onOpen(index)} onContextMenu={onContextMenu}
                    bulkMode={bulkMode} selected={selected} onSelect={onSelect} />
    )
  }
  return squares(images.map((item, index) => ({ item, index })))
}
