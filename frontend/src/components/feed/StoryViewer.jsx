import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Volume2, VolumeX } from 'lucide-react'
import { feedApi } from '../../lib/api'

const IMAGE_SECONDS = 6
const VIDEO_MAX_SECONDS = 15

function timeAgo(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  return `${Math.floor(s / 3600)}h`
}

/**
 * Fullscreen Instagram-style story viewer.
 * Props: groups, startGroup, onClose, onSeen(storyId), onOpenProfile(creatorId)
 */
export default function StoryViewer({ groups, startGroup = 0, onClose, onSeen, onOpenProfile }) {
  const [g, setG] = useState(startGroup)
  const [s, setS] = useState(0)
  const [muted, setMuted] = useState(true)
  const videoRef = useRef(null)
  const timerRef = useRef(null)

  const group = groups[g]
  const story = group?.stories[s]
  const duration = story?.is_video
    ? Math.min(story.duration || VIDEO_MAX_SECONDS, VIDEO_MAX_SECONDS)
    : IMAGE_SECONDS

  const next = useCallback(() => {
    if (!group) return
    if (s < group.stories.length - 1) { setS(s + 1); return }
    if (g < groups.length - 1) { setG(g + 1); setS(0); return }
    onClose()
  }, [g, s, group, groups.length, onClose])

  const prev = useCallback(() => {
    if (s > 0) { setS(s - 1); return }
    if (g > 0) {
      const pg = g - 1
      setG(pg)
      setS(groups[pg].stories.length - 1)
    }
  }, [g, s, groups])

  // Mark seen + arm the auto-advance timer for every story change
  useEffect(() => {
    if (!story) return
    onSeen?.(story.id)
    feedApi.storySeen(story.id).catch(() => {})
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(next, duration * 1000)
    return () => clearTimeout(timerRef.current)
  }, [g, s])   // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: arrows navigate, Esc closes
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  if (!group || !story) return null

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.94)', backdropFilter: 'blur(10px)' }}
    >
      <motion.div
        key={`g-${g}`}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-[16px]"
        style={{ height: 'min(95vh, 1200px)', aspectRatio: '9/16', maxWidth: '94vw', background: '#0a0a0a' }}
      >
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 flex gap-1.5 px-3 pt-3" style={{ zIndex: 20 }}>
          {group.stories.map((st, i) => (
            <div key={st.id} className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.25)' }}>
              {i < s && <div className="h-full w-full" style={{ background: '#fff' }} />}
              {i === s && (
                <motion.div
                  key={`bar-${st.id}`}
                  className="h-full"
                  style={{ background: '#fff' }}
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration, ease: 'linear' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 flex items-center gap-2.5 px-3 pt-7 pb-3" style={{ zIndex: 20, background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)' }}>
          {/* Tap the identity to open the creator's profile — like IG */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
               onClick={e => { e.stopPropagation(); onOpenProfile?.(group.creator.id) }}>
            <img
              src={group.creator.has_avatar ? `/api/creators/${group.creator.id}/avatar-thumb?size=96` : '/logo.png'}
              alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              style={{ border: '1.5px solid rgba(255,255,255,0.4)' }}
              onError={e => { e.target.style.visibility = 'hidden' }}
            />
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[16px] font-semibold text-white truncate">{group.creator.name}</span>
              <span className="text-[13px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.55)' }}>{timeAgo(story.posted_at)}</span>
            </div>
          </div>
          {story.is_video && (
            <button onClick={e => { e.stopPropagation(); const m = !muted; setMuted(m); if (videoRef.current) videoRef.current.muted = m }}
                    className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
                    style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}>
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          )}
          <button onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}>
            <X size={15} />
          </button>
        </div>

        {/* Media — crossfade between stories */}
        <AnimatePresence mode="wait">
          <motion.div
            key={story.id}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0"
          >
            {/* blurred fill */}
            <img src={`/api/images/${story.image_id}/thumb`} alt="" aria-hidden
                 className="absolute inset-0 w-full h-full object-cover"
                 style={{ filter: 'blur(30px) brightness(0.5)', transform: 'scale(1.3)' }}
                 onError={e => { e.target.style.opacity = 0 }} />
            {story.is_video ? (
              <video
                ref={videoRef}
                src={`/api/images/${story.image_id}/file`}
                autoPlay muted={muted} playsInline
                className="relative w-full h-full object-contain"
                onEnded={next}
              />
            ) : (
              <img src={`/api/images/${story.image_id}/preview?w=1080`} alt=""
                   className="relative w-full h-full object-contain"
                   onError={e => { e.target.style.opacity = 0 }} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Tap zones: left third = back, right two thirds = forward */}
        <div className="absolute inset-y-0 left-0 cursor-pointer" style={{ width: '33%', zIndex: 10 }} onClick={prev} />
        <div className="absolute inset-y-0 right-0 cursor-pointer" style={{ width: '67%', zIndex: 10 }} onClick={next} />
      </motion.div>
    </motion.div>,
    document.body
  )
}
