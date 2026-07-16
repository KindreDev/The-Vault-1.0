// VaultGram building blocks for the mobile app — post cards, stories rail,
// fullscreen story viewer. All media URLs go through abs() so they resolve
// against the configured PC server.
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, FolderOpen, CalendarHeart, History, Flame, Sparkles, Camera, Volume2, VolumeX, X, Bookmark, Link2 } from 'lucide-react'
import { useVaultStore } from '../store/vault.js'
import { feedApi } from '../lib/api.js'
import { abs } from '../lib/server.js'

export const TYPE_META = {
  on_this_day: { icon: CalendarHeart, label: 'On this day', color: '#ED93B1' },
  throwback:   { icon: History,       label: 'Throwback',   color: '#A79FF0' },
  theme_day:   { icon: Sparkles,      label: 'Theme day',   color: '#FAC775' },
  fresh_drop:  { icon: Flame,         label: 'New drop',    color: '#9FE1CB' },
  daily:       { icon: Camera,        label: 'Daily',       color: '#CECBF6' },
  saved:       { icon: Bookmark,      label: 'Saved',       color: '#8AB4F8' },
}

export function timeAgo(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const d = Math.floor(s / 86400)
  return d === 1 ? '1d' : `${d}d`
}

export const creatorAvatar = (c, size = 96) =>
  c?.has_avatar ? abs(`/api/creators/${c.id}/avatar-thumb?size=${size}`) : null

function Ava({ creator, size = 40, ring = 'rgba(127,119,221,0.55)', onClick }) {
  const src = creatorAvatar(creator)
  return src ? (
    <img src={src} alt="" onClick={onClick}
         onError={e => { e.target.style.visibility = 'hidden' }}
         style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${ring}`, flexShrink: 0 }} />
  ) : (
    <div onClick={onClick} style={{ width: size, height: size, borderRadius: '50%', background: 'var(--c-card)', border: `2px solid ${ring}`, flexShrink: 0 }} />
  )
}

// ── Media slides ─────────────────────────────────────────────────────────────
// scrollSnapStop 'always' = one slide per swipe no matter how hard you fling (IG behavior)
const SLIDE_STYLE = { scrollSnapStop: 'always' }

// Instagram-style transient pinch zoom: two fingers scale + pan, springs back on release
function usePinchZoom() {
  const ref = useRef(null)
  const state = useRef(null)
  const onTouchStart = (e) => {
    if (e.touches.length !== 2) return
    const [a, b] = e.touches
    state.current = {
      dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2,
    }
    if (ref.current) ref.current.style.transition = 'none'
  }
  const onTouchMove = (e) => {
    if (!state.current || e.touches.length !== 2) return
    e.preventDefault()
    const [a, b] = e.touches
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    const scale = Math.min(3.5, Math.max(1, dist / state.current.dist))
    const dx = (a.clientX + b.clientX) / 2 - state.current.cx
    const dy = (a.clientY + b.clientY) / 2 - state.current.cy
    if (ref.current) {
      ref.current.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
      ref.current.style.zIndex = 30
    }
  }
  const onTouchEnd = () => {
    if (!state.current) return
    state.current = null
    if (ref.current) {
      ref.current.style.transition = 'transform 0.25s cubic-bezier(0.16,1,0.3,1)'
      ref.current.style.transform = 'none'
      setTimeout(() => { if (ref.current) ref.current.style.zIndex = '' }, 260)
    }
  }
  return { ref, handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}

function PhotoSlide({ image, onClick }) {
  const pinch = usePinchZoom()
  return (
    <div className="relative shrink-0 w-full h-full snap-center overflow-hidden"
         style={SLIDE_STYLE} onClick={onClick} {...pinch.handlers}>
      <img src={abs(`/api/images/${image.id}/thumb`)} alt="" aria-hidden
           className="absolute inset-0 w-full h-full object-cover"
           style={{ filter: 'blur(24px) brightness(0.55)', transform: 'scale(1.25)' }} />
      <img ref={pinch.ref} src={abs(`/api/images/${image.id}/preview?w=1080`)} alt="" loading="lazy"
           className="relative w-full h-full object-contain"
           onError={e => { e.target.style.opacity = 0 }} />
    </div>
  )
}

export function VideoSlide({ image, onClick }) {
  const videoRef = useRef(null)
  const ioRef = useRef(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(false)

  const containerRef = useCallback(node => {
    ioRef.current?.disconnect()
    if (!node) return
    const io = new IntersectionObserver(([e]) => {
      const v = videoRef.current
      if (!v) return
      if (e.intersectionRatio >= 0.5) {
        if (!v.src) v.src = abs(`/api/images/${image.id}/file`)
        v.play().catch(() => {})
      } else v.pause()
    }, { threshold: [0, 0.5] })
    io.observe(node)
    ioRef.current = io
  }, [image.id])

  useEffect(() => () => {
    ioRef.current?.disconnect()
    const v = videoRef.current
    if (v) { v.pause(); v.removeAttribute('src'); v.load() }
  }, [])

  return (
    <div ref={containerRef} className="relative shrink-0 w-full h-full snap-center overflow-hidden"
         style={SLIDE_STYLE} onClick={onClick}>
      <img src={abs(`/api/images/${image.id}/thumb`)} alt="" aria-hidden
           className="absolute inset-0 w-full h-full object-cover"
           style={{ filter: 'blur(24px) brightness(0.55)', transform: 'scale(1.25)' }} />
      <video ref={videoRef} muted={muted} loop playsInline preload="none"
             poster={abs(`/api/images/${image.id}/thumb`)}
             className="relative w-full h-full object-contain"
             onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <button
        onClick={e => { e.stopPropagation(); const m = !muted; setMuted(m); const v = videoRef.current; if (v) { v.muted = m; if (!m) v.play().catch(() => {}) } }}
        className="absolute bottom-3 right-3 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', zIndex: 3 }}>
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 2 }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '15px solid #fff', marginLeft: 4 }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Post card ────────────────────────────────────────────────────────────────
export default function FeedPost({ post, onCreatorClick }) {
  const navigate = useNavigate()
  const [liked, setLiked] = useState(post.liked)
  const [bigHeart, setBigHeart] = useState(false)
  const [idx, setIdx] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const stripRef = useRef(null)
  const tapTimer = useRef(null)

  const addToast = useVaultStore(s => s.addToast)
  const meta = TYPE_META[post.post_type] || TYPE_META.throwback
  const TypeIcon = meta.icon
  const many = post.images.length > 1
  const first = post.images.find(i => i.width && i.height)
  const aspect = first ? Math.min(1.6, Math.max(0.8, first.width / first.height)) : 0.8
  const comments = post.comments ?? []
  const visible = showAll ? comments : comments.slice(0, 2)
  const likeCount = (post.like_count ?? 0) + (liked ? 1 : 0)

  const toggleLike = () => {
    setLiked(l => !l)
    feedApi.like(post.id).catch(() => setLiked(l => !l))
  }
  const openImage = (img) => {
    // Videos open the video player, photos the gallery viewer
    if (img.is_video) navigate(`/video/${img.id}`)
    else if (img.gallery_id ?? post.gallery_id) navigate(`/photo/${img.id}`)
  }
  const tap = (img) => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current); tapTimer.current = null
      if (!liked) toggleLike()
      setBigHeart(true); setTimeout(() => setBigHeart(false), 650)
    } else {
      tapTimer.current = setTimeout(() => { tapTimer.current = null; openImage(img) }, 280)
    }
  }
  useEffect(() => () => clearTimeout(tapTimer.current), [])

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--c-surface)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      {/* header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Ava creator={post.creator} onClick={() => onCreatorClick?.(post.creator.id)} />
        <div className="min-w-0 flex-1" onClick={() => onCreatorClick?.(post.creator.id)}>
          <div className="text-[15px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.92)' }}>{post.creator.name}</div>
          <div className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>@{post.creator.handle} · {timeAgo(post.posted_at)}</div>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium shrink-0"
             style={{ background: `${meta.color}22`, color: meta.color }}>
          <TypeIcon size={12} />
          {post.post_type === 'theme_day' && post.theme_tag ? `${post.theme_tag} day` : meta.label}
        </div>
      </div>

      {/* carousel */}
      <div className="relative" style={{ aspectRatio: String(aspect), background: '#0a0a0a' }}>
        <div ref={stripRef} className="flex w-full h-full overflow-x-auto snap-x snap-mandatory" data-hswipe
             style={{ scrollbarWidth: 'none' }}
             onScroll={e => { const i = Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth); if (i !== idx) setIdx(i) }}>
          {post.images.map(img => img.is_video
            ? <VideoSlide key={img.id} image={img} onClick={() => tap(img)} />
            : <PhotoSlide key={img.id} image={img} onClick={() => tap(img)} />)}
        </div>
        <AnimatePresence>
          {bigHeart && (
            <motion.div initial={{ scale: 0, opacity: 0.9 }} animate={{ scale: 1.15, opacity: 1 }} exit={{ scale: 1.4, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 5 }}>
              <Heart size={90} fill="#FF2D75" stroke="none" style={{ filter: 'drop-shadow(0 4px 24px rgba(255,45,117,0.6))' }} />
            </motion.div>
          )}
        </AnimatePresence>
        {many && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
            {post.images.map((_, i) => (
              <div key={i} className="rounded-full" style={{ width: i === idx ? 7 : 5, height: i === idx ? 7 : 5, background: i === idx ? '#fff' : 'rgba(255,255,255,0.45)' }} />
            ))}
          </div>
        )}
      </div>

      {/* actions + caption + comments */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-3 mb-1.5">
          <motion.button onClick={toggleLike} whileTap={{ scale: 0.8 }}
                         style={{ color: liked ? '#FF2D75' : 'rgba(255,255,255,0.7)', background: 'none', border: 'none' }}>
            <Heart size={24} fill={liked ? '#FF2D75' : 'none'} />
          </motion.button>
          {post.gallery_id && (
            <button onClick={() => navigate(`/gallery/${post.gallery_id}`)}
                    style={{ color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none' }}>
              <FolderOpen size={22} />
            </button>
          )}
          <button onClick={() => {
                    const img = post.images[idx] || post.images[0]
                    if (!img) return
                    navigator.clipboard?.writeText(`vault://photo/${img.id}`)
                    addToast?.('Link copied — paste it in a chat 💜', 'info')
                  }}
                  style={{ color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none' }}>
            <Link2 size={21} />
          </button>
          {many && <span className="ml-auto text-[12px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{idx + 1}/{post.images.length}</span>}
        </div>
        <div className="text-[14px] font-semibold mb-0.5" style={{ color: 'rgba(255,255,255,0.9)' }}>{likeCount.toLocaleString()} likes</div>
        <div className="text-[15px] leading-snug" style={{ color: 'rgba(255,255,255,0.82)' }}>
          <span className="font-semibold" onClick={() => onCreatorClick?.(post.creator.id)} style={{ color: 'rgba(255,255,255,0.95)' }}>{post.creator.handle}</span>{' '}
          {post.caption}
        </div>
        {post.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
            {post.hashtags.map(t => <span key={t} className="text-[14px]" style={{ color: '#8AB4F8' }}>#{t.replace(/\s+/g, '_')}</span>)}
          </div>
        )}
        {comments.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {comments.length > 2 && !showAll && (
              <button onClick={() => setShowAll(true)} className="text-left text-[13px]" style={{ color: 'rgba(255,255,255,0.38)', background: 'none', border: 'none', padding: 0 }}>
                View all {comments.length} comments
              </button>
            )}
            {visible.map(cm => (
              <div key={cm.id} className="text-[14px] leading-snug" style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="font-semibold" style={{ color: cm.is_erika ? '#CE93F8' : 'rgba(255,255,255,0.92)' }}
                      onClick={() => !cm.is_erika && cm.creator_id && onCreatorClick?.(cm.creator_id)}>
                  {cm.is_erika ? `✦ ${cm.handle}` : cm.handle}
                </span>{' '}{cm.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stories rail ─────────────────────────────────────────────────────────────
export function StoriesRow({ groups, onOpen }) {
  if (!groups?.length) return null
  return (
    <div className="flex gap-3.5 overflow-x-auto pb-2 px-1 pt-1" data-hswipe style={{ scrollbarWidth: 'none' }}>
      {groups.map((g, i) => (
        <button key={g.creator.id} onClick={() => onOpen(i)}
                className="flex flex-col items-center gap-1 shrink-0 bg-transparent" style={{ width: 68, border: 'none' }}>
          <div className="rounded-full" style={{ padding: 2.5, background: g.all_viewed ? 'rgba(255,255,255,0.16)' : 'conic-gradient(from 210deg, #7F77DD, #D4537E, #EF9F27, #7F77DD)' }}>
            <div className="rounded-full" style={{ padding: 2, background: 'var(--c-bg)' }}>
              <Ava creator={g.creator} size={54} ring="transparent" />
            </div>
          </div>
          <span className="text-[11px] truncate w-full text-center" style={{ color: g.all_viewed ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)' }}>
            {g.creator.name}
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Story viewer ─────────────────────────────────────────────────────────────
const IMG_SECS = 6, VID_MAX = 15

export function StoryViewer({ groups, startGroup = 0, onClose, onSeen, onOpenProfile }) {
  const [g, setG] = useState(startGroup)
  const [s, setS] = useState(0)
  const [muted, setMuted] = useState(true)
  const videoRef = useRef(null)
  const timerRef = useRef(null)

  const group = groups[g]
  const story = group?.stories[s]
  const duration = story?.is_video ? Math.min(story.duration || VID_MAX, VID_MAX) : IMG_SECS

  const next = useCallback(() => {
    if (!group) return
    if (s < group.stories.length - 1) return setS(s + 1)
    if (g < groups.length - 1) { setG(g + 1); setS(0); return }
    onClose()
  }, [g, s, group, groups.length, onClose])
  const prev = useCallback(() => {
    if (s > 0) return setS(s - 1)
    if (g > 0) { setG(g - 1); setS(groups[g - 1].stories.length - 1) }
  }, [g, s, groups])

  useEffect(() => {
    if (!story) return
    onSeen?.(story.id)
    feedApi.storySeen(story.id).catch(() => {})
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(next, duration * 1000)
    return () => clearTimeout(timerRef.current)
  }, [g, s])   // eslint-disable-line

  if (!group || !story) return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center" data-hswipe style={{ background: '#000' }}>
      <div className="relative w-full h-full overflow-hidden">
        {/* progress */}
        <div className="absolute left-0 right-0 flex gap-1 px-3" style={{ top: 'calc(var(--sat, 0px) + 8px)', zIndex: 20 }}>
          {group.stories.map((st, i) => (
            <div key={st.id} className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.25)' }}>
              {i < s && <div className="h-full w-full" style={{ background: '#fff' }} />}
              {i === s && (
                <motion.div key={`b${st.id}`} className="h-full" style={{ background: '#fff' }}
                            initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration, ease: 'linear' }} />
              )}
            </div>
          ))}
        </div>
        {/* header */}
        <div className="absolute left-0 right-0 flex items-center gap-2 px-3" style={{ top: 'calc(var(--sat, 0px) + 18px)', zIndex: 20 }}>
          <div className="flex items-center gap-2 min-w-0 flex-1" onClick={e => { e.stopPropagation(); onOpenProfile?.(group.creator.id) }}>
            <Ava creator={group.creator} size={36} ring="rgba(255,255,255,0.4)" />
            <span className="text-[15px] font-semibold text-white truncate">{group.creator.name}</span>
            <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{timeAgo(story.posted_at)}</span>
          </div>
          {story.is_video && (
            <button onClick={e => { e.stopPropagation(); const m = !muted; setMuted(m); if (videoRef.current) videoRef.current.muted = m }}
                    className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)', color: '#fff', border: 'none' }}>
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          )}
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)', color: '#fff', border: 'none' }}>
            <X size={15} />
          </button>
        </div>
        {/* media */}
        <div className="absolute inset-0">
          <img src={abs(`/api/images/${story.image_id}/thumb`)} alt="" aria-hidden
               className="absolute inset-0 w-full h-full object-cover" style={{ filter: 'blur(30px) brightness(0.5)', transform: 'scale(1.3)' }} />
          {story.is_video ? (
            <video ref={videoRef} src={abs(`/api/images/${story.image_id}/file`)} autoPlay muted={muted} playsInline
                   className="relative w-full h-full object-contain" onEnded={next} />
          ) : (
            <img src={abs(`/api/images/${story.image_id}/preview?w=1080`)} alt="" className="relative w-full h-full object-contain" />
          )}
        </div>
        {/* tap zones */}
        <div className="absolute inset-y-0 left-0" style={{ width: '33%', zIndex: 10 }} onClick={prev} />
        <div className="absolute inset-y-0 right-0" style={{ width: '67%', zIndex: 10 }} onClick={next} />
      </div>
    </div>,
    document.body
  )
}
