import React, { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Trash2, Images, Play, X, ChevronLeft, ChevronRight, Shuffle } from 'lucide-react'
import { playlistsApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import { useSession } from '../hooks/useSession'
import toast from 'react-hot-toast'
import { Heart } from 'lucide-react'

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ images, startIdx, onClose }) {
  const [idx, setIdx] = useState(startIdx)
  const img = images[idx]
  const registerVisible   = useVaultStore(s => s.registerVisible)
  const unregisterVisible = useVaultStore(s => s.unregisterVisible)
  const { sessionActive, startSession, finishSession } = useSession()

  // This view had no session handling at all — finishing here recorded nothing,
  // no session and no orgasm. Register what's on screen so it counts.
  useEffect(() => {
    if (img?.id) registerVisible('playlist', img.id)
  }, [img?.id, registerVisible])
  useEffect(() => () => unregisterVisible('playlist'), [unregisterVisible])
  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])
  const next = useCallback(() => setIdx(i => Math.min(images.length - 1, i + 1)), [images.length])
  const videoRef = useRef(null)

  // Release the media pipeline when the lightbox closes or the slide changes
  useEffect(() => {
    return () => {
      const v = videoRef.current
      if (!v) return
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  }, [idx])

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft')  prev()
    if (e.key === 'ArrowRight') next()
    if (e.key === 'Escape')     onClose()
  }, [prev, next, onClose])

  React.useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (!img) return null

  const src = img.is_video
    ? `/api/images/${img.id}/file`
    : (img.thumb_path ? `/thumbs/${img.thumb_path.replace(/\\/g, '/').split('/thumbs/').pop()}` : `/api/images/${img.id}/file`)

  return createPortal((
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#070707' }}
         onClick={onClose}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
           style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}
           onClick={e => e.stopPropagation()}>
        <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white">
          <X size={16} />
        </button>
        <span className="text-[13px] text-[rgba(255,255,255,0.4)]">{idx + 1} / {images.length}</span>
        <span className="text-[13px] text-[rgba(255,255,255,0.6)] truncate flex-1">{img.filename}</span>
        <button
          onMouseDown={() => {
            if (sessionActive) finishSession({ imageId: img.id, galleryId: img.gallery_id })
            else               startSession()
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer flex-shrink-0"
          style={{ background: sessionActive ? 'rgba(212,83,126,0.3)' : 'rgba(212,83,126,0.15)',
                   color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.35)' }}>
          <Heart size={12} /> {sessionActive ? 'Stop Session' : 'Start Session'}
        </button>
      </div>

      {/* Image stage */}
      <div className="flex-1 flex items-center justify-center relative min-h-0"
           onClick={e => e.stopPropagation()}>
        {img.is_video
          ? <video ref={videoRef} src={`/api/images/${img.id}/file`} controls autoPlay
                   style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <img src={`/api/images/${img.id}/file`} alt={img.filename}
                 style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        }

        {/* Prev / Next arrows */}
        {idx > 0 && (
          <button onMouseDown={prev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(0,0,0,0.6)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <ChevronLeft size={20} color="#fff" />
          </button>
        )}
        {idx < images.length - 1 && (
          <button onMouseDown={next}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(0,0,0,0.6)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <ChevronRight size={20} color="#fff" />
          </button>
        )}
      </div>
    </div>
  ), document.body)
}

// ── Image card ────────────────────────────────────────────────────────────────
function ImageCard({ img, onClick }) {
  const [failed, setFailed] = useState(false)
  const thumbUrl = img.thumb_path
    ? `/thumbs/${img.thumb_path.replace(/\\/g, '/').split('/thumbs/').pop()}`
    : null

  return (
    <div onClick={onClick}
         className="rounded-[8px] overflow-hidden cursor-pointer group relative"
         style={{ aspectRatio: '1', background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      {thumbUrl && !failed
        ? <img src={thumbUrl} alt={img.filename}
               className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
               onError={() => setFailed(true)} />
        : <div className="w-full h-full flex items-center justify-center">
            {img.is_video
              ? <Play size={24} style={{ color: 'rgba(255,255,255,0.15)' }} />
              : <Images size={24} style={{ color: 'rgba(255,255,255,0.1)' }} />
            }
          </div>
      }
      {img.is_video && (
        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
             style={{ background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.7)' }}>
          VID
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PlaylistView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [thumbSize, setThumbSize] = useState(160)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['playlist-detail', id],
    queryFn: () => playlistsApi.detail(id).then(r => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: () => playlistsApi.delete(id),
    onSuccess: () => {
      toast.success('Playlist deleted')
      qc.invalidateQueries({ queryKey: ['playlists'] })
      navigate('/dashboard')
    },
    onError: () => toast.error('Failed to delete playlist'),
  })

  const handleDelete = () => {
    if (window.confirm(`Delete "${data?.name}"? This cannot be undone.`)) {
      deleteMut.mutate()
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="text-[rgba(255,255,255,0.3)]">Loading playlist…</div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <div className="text-[rgba(255,255,255,0.4)]">Playlist not found.</div>
        <button onClick={() => navigate('/dashboard')} className="mt-3 text-[var(--c-accent)] cursor-pointer">
          ← Back to dashboard
        </button>
      </div>
    )
  }

  const images = data.images ?? []

  return (
    <div className="p-5 flex flex-col gap-5 w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onMouseDown={() => navigate('/dashboard')}
                className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[20px] font-semibold text-[rgba(255,255,255,0.92)] truncate">{data.name}</div>
          {data.description && (
            <div className="text-[12px] text-[rgba(255,255,255,0.35)] mt-0.5 truncate">{data.description}</div>
          )}
        </div>
        <div className="text-[13px] text-[rgba(255,255,255,0.35)] flex items-center gap-1.5 flex-shrink-0">
          <Images size={13} /> {images.length} items
        </div>
        {/* Thumb size slider */}
        <div className="flex items-center gap-2">
          <input type="range" min={100} max={280} step={10} value={thumbSize}
                 onChange={e => setThumbSize(Number(e.target.value))}
                 className="w-20 cursor-pointer accent-[var(--c-accent)]" />
        </div>
        <button onMouseDown={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] cursor-pointer"
                style={{ background: 'rgba(212,83,126,0.15)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
          <Trash2 size={12} /> Delete
        </button>
      </div>

      {/* Empty state */}
      {images.length === 0 && (
        <div className="rounded-[12px] p-10 text-center text-[rgba(255,255,255,0.25)]"
             style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
          No images in this playlist
        </div>
      )}

      {/* Grid */}
      <div className="grid gap-2"
           style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
        {images.map((img, i) => (
          <ImageCard key={img.id} img={img} onClick={() => setLightboxIdx(i)} />
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Lightbox images={images} startIdx={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
    </div>
  )
}
