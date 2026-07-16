import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Play, Heart } from 'lucide-react'

/**
 * Instagram-style 3-column square grid of a creator's posts.
 * Props: posts (serialized FeedPosts), onOpenPost(post)
 */
function GridCell({ post, i, onOpenPost }) {
  const [hovered, setHovered] = useState(false)
  const cover = post.images?.[0]
  const many = (post.images?.length ?? 0) > 1
  const isVideo = cover?.is_video
  if (!cover) return null
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: (i % 12) * 0.03, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onOpenPost(post)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fx-btn relative overflow-hidden cursor-pointer bg-transparent"
      style={{ aspectRatio: '1', border: 'none', borderRadius: 2 }}
    >
      <img src={`/api/images/${cover.id}/thumb`} alt=""
           className="w-full h-full object-cover"
           style={{ transform: hovered ? 'scale(1.06)' : 'scale(1)', transition: 'transform 0.3s ease' }}
           onError={e => { e.target.style.opacity = 0 }} />

      {/* corner indicators */}
      {many && (
        <div className="absolute top-1.5 right-1.5" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
          <Copy size={15} color="#fff" fill="#fff" />
        </div>
      )}
      {isVideo && !many && (
        <div className="absolute top-1.5 right-1.5" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
          <Play size={15} color="#fff" fill="#fff" />
        </div>
      )}

      {/* hover overlay — like count */}
      <motion.div
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.42)' }}
      >
        <div className="flex items-center gap-1.5 text-[15px] font-semibold text-white">
          <Heart size={16} fill="#fff" /> {(post.like_count ?? 0).toLocaleString()}
        </div>
      </motion.div>
    </motion.button>
  )
}

export default function ProfilePostGrid({ posts, onOpenPost }) {
  return (
    <div className="grid grid-cols-3" style={{ gap: 4 }}>
      {posts.map((post, i) => (
        <GridCell key={post.id} post={post} i={i} onOpenPost={onOpenPost} />
      ))}
    </div>
  )
}
