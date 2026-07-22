import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, FolderOpen, ChevronLeft, ChevronRight, CalendarHeart, History, Flame, Sparkles, Volume2, VolumeX, Camera, Bookmark, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import { feedApi, systemApi } from '../../lib/api'
import VerifiedBadge from './VerifiedBadge'
import { useT } from '../../i18n'

const TYPE_META = {
  on_this_day: { icon: CalendarHeart, label: 'On this day',  color: '#ED93B1' },
  throwback:   { icon: History,       label: 'Throwback',    color: '#A79FF0' },
  theme_day:   { icon: Sparkles,      label: 'Theme day',    color: '#FAC775' },
  fresh_drop:  { icon: Flame,         label: 'New drop',     color: '#9FE1CB' },
  daily:       { icon: Camera,        label: 'Daily',        color: '#CECBF6' },
  saved:       { icon: Bookmark,      label: 'Saved',        color: '#8AB4F8' },
}

function timeAgo(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const d = Math.floor(s / 86400)
  return d === 1 ? '1 day ago' : `${d} days ago`
}

// Post frame aspect (width/height): follow the first image, clamped so extreme
// panoramas and skyscraper crops still look like a feed post.
function postAspect(images) {
  const first = images.find(i => i.width && i.height)
  if (!first) return 0.8                       // classic IG 4:5
  return Math.min(1.6, Math.max(0.8, first.width / first.height))
}

/** Photo slide — sharp 1080p preview letterboxed over a blurred fill. */
function PhotoSlide({ image, onClick }) {
  return (
    <div className="relative flex-shrink-0 w-full h-full snap-center cursor-pointer overflow-hidden" onClick={onClick}>
      {/* blurred fill behind — makes landscape shots look intentional, not cropped */}
      <img src={`/api/images/${image.id}/thumb`} alt="" aria-hidden
           className="absolute inset-0 w-full h-full object-cover"
           style={{ filter: 'blur(28px) brightness(0.55)', transform: 'scale(1.25)' }}
           onError={e => { e.target.style.opacity = 0 }} />
      <img src={`/api/images/${image.id}/preview?w=1080`} alt="" loading="lazy"
           className="relative w-full h-full object-contain"
           onError={e => { e.target.style.opacity = 0 }} />
    </div>
  )
}

/** Video slide — plays automatically while at least half in view, muted by
 *  default with an IG-style corner sound toggle. */
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
        if (!v.src) v.src = `/api/images/${image.id}/file`
        v.play().catch(() => {})
      } else {
        v.pause()
      }
    }, { threshold: [0, 0.5] })
    io.observe(node)
    ioRef.current = io
  }, [image.id])

  useEffect(() => {
    return () => {
      ioRef.current?.disconnect()
      const v = videoRef.current
      if (!v) return
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  }, [])

  return (
    <div ref={containerRef} className="relative flex-shrink-0 w-full h-full snap-center cursor-pointer overflow-hidden"
         onClick={onClick}>
      <img src={`/api/images/${image.id}/thumb`} alt="" aria-hidden
           className="absolute inset-0 w-full h-full object-cover"
           style={{ filter: 'blur(28px) brightness(0.55)', transform: 'scale(1.25)' }}
           onError={e => { e.target.style.opacity = 0 }} />
      <video
        ref={videoRef}
        muted={muted}
        loop
        playsInline
        preload="none"
        poster={`/api/images/${image.id}/thumb`}
        className="relative w-full h-full object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {/* Sound toggle — the only control, just like IG */}
      <button
        onClick={e => {
          e.stopPropagation()
          const v = videoRef.current
          const next = !muted
          setMuted(next)
          if (v) { v.muted = next; if (!next) v.play().catch(() => {}) }
        }}
        className="fx-btn absolute bottom-3 right-3 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer"
        style={{ background: 'rgba(0,0,0,0.6)', border: '0.5px solid rgba(255,255,255,0.25)', color: '#fff', zIndex: 3 }}>
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 2 }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center"
               style={{ background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.25)' }}>
            <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}
                        style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '15px solid #fff', marginLeft: 4 }} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One Instagram-style post in the feed.
 * Props: post (serialized FeedPost), onCreatorClick(creatorId)
 */
export default function FeedPost({ post, onCreatorClick }) {
  const t = useT()
  const navigate = useNavigate()
  const [liked, setLiked] = useState(post.liked)
  const [likeBurst, setLikeBurst] = useState(false)
  const [bigHeart, setBigHeart] = useState(false)
  const [idx, setIdx] = useState(0)
  const [showAllComments, setShowAllComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)
  const [localComments, setLocalComments] = useState([])
  const stripRef = useRef(null)
  const tapTimer = useRef(null)

  const { data: personalMode } = useQuery({
    queryKey: ['personal-mode'],
    queryFn:  () => systemApi.getPersonalMode().then(r => r.data.enabled),
    initialData: false,
  })

  const comments = [...(post.comments ?? []), ...localComments]
  const visibleComments = showAllComments ? comments : comments.slice(0, 2)

  const submitComment = async () => {
    const text = commentText.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      const { data } = await feedApi.comment(post.id, text)
      setLocalComments(prev => [...prev, {
        id: data.id, author: data.author, handle: data.author,
        is_user: true, is_erika: false, text: data.text,
      }])
      setCommentText('')
      setShowAllComments(true)
    } catch { toast.error('Could not post comment') }
    finally { setPosting(false) }
  }
  const likeCount = (post.like_count ?? 0) + (liked ? 1 : 0)

  const meta = TYPE_META[post.post_type] || TYPE_META.throwback
  const TypeIcon = meta.icon
  const many = post.images.length > 1
  const aspect = postAspect(post.images)

  const toggleLike = () => {
    setLiked(l => !l)
    if (!liked) { setLikeBurst(true); setTimeout(() => setLikeBurst(false), 450) }
    feedApi.like(post.id).catch(() => setLiked(l => !l))
  }

  const goto = (i) => {
    const clamped = Math.max(0, Math.min(post.images.length - 1, i))
    setIdx(clamped)
    stripRef.current?.scrollTo({ left: clamped * stripRef.current.clientWidth, behavior: 'smooth' })
  }

  const openImage = (img) => {
    const gid = img.gallery_id ?? post.gallery_id
    if (gid) navigate(`/galleries/${gid}?openImage=${img.id}`)
  }

  // Single tap opens the image (after a short delay); double tap likes — IG style
  const handleMediaTap = (img) => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current)
      tapTimer.current = null
      if (!liked) toggleLike()
      setBigHeart(true)
      setTimeout(() => setBigHeart(false), 650)
    } else {
      tapTimer.current = setTimeout(() => { tapTimer.current = null; openImage(img) }, 280)
    }
  }
  useEffect(() => () => clearTimeout(tapTimer.current), [])

  return (
    <div className="rounded-[14px] overflow-hidden"
         style={{ background: '#161618', border: '0.5px solid rgba(255,255,255,0.09)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <img
          src={post.creator.has_avatar ? `/api/creators/${post.creator.id}/avatar-thumb?size=96` : '/logo.png'}
          alt="" onError={e => { e.target.style.visibility = 'hidden' }}
          onClick={() => onCreatorClick?.(post.creator.id)}
          className="w-11 h-11 rounded-full object-cover cursor-pointer flex-shrink-0"
          style={{ border: '2px solid rgba(127,119,221,0.55)' }}
        />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onCreatorClick?.(post.creator.id)}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[16px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.92)' }}>
              {post.creator.name}
            </span>
            <VerifiedBadge tier={post.creator.badge} size={15} />
          </div>
          <div className="text-[13px] truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
            @{post.creator.handle} · {timeAgo(post.posted_at)}
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium flex-shrink-0"
             style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
          <TypeIcon size={13} />
          {post.post_type === 'theme_day' && post.theme_tag ? `${post.theme_tag} day` : t(meta.label)}
        </div>
      </div>

      {/* Media carousel — frame follows the first image's shape */}
      <div className="relative group/media" style={{ aspectRatio: String(aspect), background: '#0a0a0a' }}>
        <div ref={stripRef}
             className="flex w-full h-full overflow-x-auto snap-x snap-mandatory"
             style={{ scrollbarWidth: 'none' }}
             onScroll={e => {
               const el = e.currentTarget
               const i = Math.round(el.scrollLeft / el.clientWidth)
               if (i !== idx) setIdx(i)
             }}>
          {post.images.map(img => img.is_video
            ? <VideoSlide key={img.id} image={img} onClick={() => handleMediaTap(img)} />
            : <PhotoSlide key={img.id} image={img} onClick={() => handleMediaTap(img)} />
          )}
        </div>

        {/* Double-tap heart burst */}
        <AnimatePresence>
          {bigHeart && (
            <motion.div
              initial={{ scale: 0, opacity: 0.9 }}
              animate={{ scale: 1.15, opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ zIndex: 5 }}
            >
              <Heart size={96} fill="#FF2D75" stroke="none"
                     style={{ filter: 'drop-shadow(0 4px 24px rgba(255,45,117,0.6))' }} />
            </motion.div>
          )}
        </AnimatePresence>

        {many && idx > 0 && (
          <button onClick={() => goto(idx - 1)}
                  className="fx-btn carousel-arrow absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover/media:opacity-100 transition-opacity duration-200"
                  style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', zIndex: 4, backdropFilter: 'blur(4px)' }}>
            <ChevronLeft size={17} />
          </button>
        )}
        {many && idx < post.images.length - 1 && (
          <button onClick={() => goto(idx + 1)}
                  className="fx-btn carousel-arrow absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover/media:opacity-100 transition-opacity duration-200"
                  style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', zIndex: 4, backdropFilter: 'blur(4px)' }}>
            <ChevronRight size={17} />
          </button>
        )}
        {many && (
          <div className="absolute bottom-2.5 left-0 right-0 flex items-center justify-center gap-1.5 pointer-events-none" style={{ zIndex: 4 }}>
            {post.images.map((_, i) => (
              <div key={i} className="rounded-full transition-all duration-200"
                   style={{
                     width: i === idx ? 7 : 5, height: i === idx ? 7 : 5,
                     background: i === idx ? '#fff' : 'rgba(255,255,255,0.45)',
                   }} />
            ))}
          </div>
        )}
      </div>

      {/* Actions + caption */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <motion.button onClick={toggleLike} whileTap={{ scale: 0.8 }} whileHover={{ scale: 1.12 }}
                         className="fx-btn cursor-pointer flex items-center justify-center"
                         style={{ color: liked ? '#FF2D75' : 'rgba(255,255,255,0.7)', transition: 'color 0.2s' }}>
            <motion.span animate={likeBurst ? { scale: [1, 1.45, 1] } : {}} transition={{ duration: 0.4 }}
                         style={{ display: 'flex' }}>
              <Heart size={24} fill={liked ? '#FF2D75' : 'none'} />
            </motion.span>
          </motion.button>
          {post.gallery_id && (
            <button onClick={() => navigate(`/galleries/${post.gallery_id}`)}
                    title={post.gallery_name ? `${t('Open')} ${post.gallery_name}` : t('Open gallery')}
                    className="cursor-pointer flex items-center justify-center"
                    style={{ color: 'rgba(255,255,255,0.7)' }}>
              <FolderOpen size={22} />
            </button>
          )}
          {/* Copy a link to the current photo so you can paste it into a chat */}
          <button onClick={() => {
                    const img = post.images[idx] || post.images[0]
                    if (!img) return
                    navigator.clipboard?.writeText(`vault://photo/${img.id}`)
                    toast.success(t('Link copied — paste it in a chat 💜'))
                  }}
                  title={t('Copy link (to share in chat)')}
                  className="cursor-pointer flex items-center justify-center"
                  style={{ color: 'rgba(255,255,255,0.7)' }}>
            <Link2 size={21} />
          </button>
          {many && (
            <span className="ml-auto text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {idx + 1} / {post.images.length}
            </span>
          )}
        </div>
        <div className="text-[15px] font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>
          {likeCount.toLocaleString()} {t('likes')}
        </div>
        <div className="text-[16px] leading-snug" style={{ color: 'rgba(255,255,255,0.82)' }}>
          <span className="font-semibold cursor-pointer" style={{ color: 'rgba(255,255,255,0.95)' }}
                onClick={() => onCreatorClick?.(post.creator.id)}>
            {post.creator.handle}
          </span>{' '}
          {post.caption}
        </div>
        {/* Hashtags — the post's real tags, tap to browse that tag */}
        {post.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 mt-1.5">
            {post.hashtags.map(tag => (
              <span key={tag}
                    onClick={() => navigate(`/images?tags=${encodeURIComponent(tag)}`)}
                    className="text-[15px] cursor-pointer hover:underline"
                    style={{ color: '#8AB4F8' }}>
                #{tag.replace(/\s+/g, '_')}
              </span>
            ))}
          </div>
        )}

        {personalMode ? (
          <>
            {/* Comments — the other girls (and Erika) in the replies */}
            {comments.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {comments.length > 2 && !showAllComments && (
                  <button onClick={() => setShowAllComments(true)}
                          className="text-left text-[14px] cursor-pointer"
                          style={{ color: 'rgba(255,255,255,0.38)', background: 'none', border: 'none', padding: 0 }}>
                    {t('View all')} {comments.length} {t('comments')}
                  </button>
                )}
                {visibleComments.map(cm => (
                  <div key={cm.id} className="text-[15px] leading-snug"
                       style={{
                         color: 'rgba(255,255,255,0.75)',
                         // Drama replies indent under whoever they answer — reads like a thread
                         paddingLeft: cm.reply_to ? 18 : 0,
                         borderLeft: cm.reply_to ? '2px solid rgba(255,255,255,0.08)' : 'none',
                         marginLeft: cm.reply_to ? 2 : 0,
                       }}>
                    <span
                      className={`font-semibold ${(cm.is_erika || cm.is_user) ? '' : 'cursor-pointer'}`}
                      style={{ color: cm.is_user ? 'var(--accent, #7F77DD)' : cm.is_erika ? '#CE93F8' : 'rgba(255,255,255,0.92)' }}
                      onClick={() => !cm.is_erika && !cm.is_user && cm.creator_id && onCreatorClick?.(cm.creator_id)}>
                      {cm.is_erika ? `✦ ${cm.handle}` : cm.handle}
                    </span>{' '}
                    {cm.reply_to && (
                      <span style={{ color: 'var(--accent, #7F77DD)', opacity: 0.85 }}>@{cm.reply_to} </span>
                    )}
                    {cm.text}
                  </div>
                ))}
              </div>
            )}

            {/* Your comment box — join the arena */}
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitComment() }}
                placeholder={t('Add a comment…')}
                disabled={posting}
                className="flex-1 bg-transparent text-[15px] outline-none"
                style={{ color: 'rgba(255,255,255,0.85)' }}
              />
              {commentText.trim() && (
                <button onClick={submitComment} disabled={posting}
                        className="text-[14px] font-semibold flex-shrink-0"
                        style={{ color: 'var(--accent, #7F77DD)', background: 'none', border: 'none' }}>
                  {posting ? '…' : t('Post')}
                </button>
              )}
            </div>
          </>
        ) : post.likes_summary && (
          <div className="mt-2 text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {t('Liked by')}{' '}
            <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {post.likes_summary.names.join(', ')}
            </span>
            {post.likes_summary.extra > 0 && (
              <> {t('and')} <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {post.likes_summary.extra.toLocaleString()}
              </span> {t('more')}</>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
