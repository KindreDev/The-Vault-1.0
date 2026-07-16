import React from 'react'
import { motion } from 'framer-motion'

/**
 * Instagram-style stories rail — gradient ring for unseen, grey for seen.
 * Props: groups (from feedApi.stories), onOpen(groupIdx)
 */
export default function StoriesRow({ groups, onOpen }) {
  if (!groups?.length) return null
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 mb-5 px-1 pt-1" style={{ scrollbarWidth: 'none' }}>
      {groups.map((g, i) => (
        <motion.button key={g.creator.id} onClick={() => onOpen(i)}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05, type: 'spring', stiffness: 320, damping: 22 }}
                whileHover={{ scale: 1.08, y: -3 }}
                whileTap={{ scale: 0.9 }}
                className="fx-btn flex flex-col items-center gap-1.5 cursor-pointer flex-shrink-0 bg-transparent"
                style={{ width: 78, border: 'none' }}>
          <div className="rounded-full"
               style={{
                 padding: 3,
                 background: g.all_viewed
                   ? 'rgba(255,255,255,0.16)'
                   : 'conic-gradient(from 210deg, #7F77DD, #D4537E, #EF9F27, #7F77DD)',
               }}>
            <div className="rounded-full" style={{ padding: 2.5, background: '#0e0e0e' }}>
              <img
                src={g.creator.has_avatar ? `/api/creators/${g.creator.id}/avatar-thumb?size=96` : '/logo.png'}
                alt="" onError={e => { e.target.style.visibility = 'hidden' }}
                className="w-16 h-16 rounded-full object-cover"
                style={{ display: 'block', opacity: g.all_viewed ? 0.65 : 1 }}
              />
            </div>
          </div>
          <span className="text-[12px] truncate w-full text-center"
                style={{ color: g.all_viewed ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)' }}>
            {g.creator.name}
          </span>
        </motion.button>
      ))}
    </div>
  )
}
