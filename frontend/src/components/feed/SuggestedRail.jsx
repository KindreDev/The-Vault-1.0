import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { creatorsApi } from '../../lib/api'
import { useT } from '../../i18n'

function handleFor(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'creator'
}

/**
 * IG-style "Suggested for you" side rail — random creators with quick Follow.
 * Props: onOpen(creatorId) — open their sim profile feed
 */
export default function SuggestedRail({ onOpen }) {
  const t = useT()
  const [followed, setFollowed] = useState(() => new Set())

  const { data: suggestions } = useQuery({
    queryKey: ['feed-suggestions'],
    queryFn: () => creatorsApi.randomPicks(6).then(r => r.data),
    staleTime: Infinity,   // stable for the visit — reshuffles next time like the feed
  })

  const follow = (c) => {
    setFollowed(prev => new Set(prev).add(c.id))
    creatorsApi.update(c.id, { is_favorite: true }).catch(() =>
      setFollowed(prev => { const n = new Set(prev); n.delete(c.id); return n })
    )
  }

  if (!suggestions?.length) return null

  return (
    <div className="rounded-[14px] p-5"
         style={{ background: '#161618', border: '0.5px solid rgba(255,255,255,0.09)' }}>
      <div className="flex items-center gap-2 mb-4">
        <UserPlus size={15} style={{ color: 'rgba(255,255,255,0.4)' }} />
        <span className="text-[15px] font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {t('Suggested for you')}
        </span>
      </div>
      <div className="flex flex-col gap-3.5">
        {suggestions.map(c => {
          const isFollowed = c.is_favorite || followed.has(c.id)
          return (
            <div key={c.id} className="flex items-center gap-3">
              <img
                src={c.avatar_path ? `/api/creators/${c.id}/avatar-thumb?size=96` : '/logo.png'}
                alt="" onError={e => { e.target.style.visibility = 'hidden' }}
                onClick={() => onOpen?.(c.id)}
                className="w-11 h-11 rounded-full object-cover cursor-pointer flex-shrink-0 transition-all duration-200 hover:scale-110"
                style={{ border: '1.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--c-accent) 90%, transparent)'; e.currentTarget.style.boxShadow = '0 0 14px color-mix(in srgb, var(--c-accent) 40%, transparent)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--c-accent) 40%, transparent)'; e.currentTarget.style.boxShadow = 'none' }}
              />
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpen?.(c.id)}>
                <div className="text-[15px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {c.name}
                </div>
                <div className="text-[13px] truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  @{handleFor(c.name)}
                </div>
              </div>
              <button
                onClick={() => !isFollowed && follow(c)}
                className="text-[13px] font-semibold cursor-pointer flex-shrink-0 px-2 py-1"
                style={{ color: isFollowed ? 'rgba(255,255,255,0.35)' : '#A79FF0', background: 'none', border: 'none' }}>
                {isFollowed ? t('Following') : t('Follow')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
