import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import FeedPost from './FeedPost'

/**
 * A single feed post opened as an Instagram-style modal — used by the profile
 * grid and Explore, so the post presentation is never lost. Clicking media
 * inside the post falls through to FeedPost's own handlers (which open the
 * exact image in its own gallery — multi-gallery posts stay correct).
 *
 * Props: post, onClose, onCreatorClick(creatorId)
 */
export default function PostModal({ post, onClose, onCreatorClick }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!post) return null

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[85] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <button onClick={onClose}
              className="fx-btn absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', color: '#fff', zIndex: 2 }}>
        <X size={17} />
      </button>
      <motion.div
        initial={{ scale: 0.92, y: 18, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="w-full overflow-y-auto rounded-[14px]"
        style={{ maxWidth: 620, maxHeight: '92vh', scrollbarWidth: 'none' }}
        onClick={e => e.stopPropagation()}
      >
        <FeedPost post={post} onCreatorClick={onCreatorClick} />
      </motion.div>
    </motion.div>,
    document.body
  )
}
