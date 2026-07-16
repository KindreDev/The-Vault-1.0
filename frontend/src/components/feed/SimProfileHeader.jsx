import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, ExternalLink, Droplets, Images as ImagesIcon, Video, MessageCircle } from 'lucide-react'
import { creatorsApi, companionApi } from '../../lib/api'
import { useVaultStore } from '../../store/vault'
import VerifiedBadge from './VerifiedBadge'
import { useT } from '../../i18n'

const RARITY_COLORS = {
  common:    '#888780',
  uncommon:  '#1D9E75',
  rare:      '#378ADD',
  epic:      '#7F77DD',
  legendary: '#BA7517',
}

function fmtCount(n) {
  if (n == null) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function thumbSrc(path) {
  if (!path) return null
  const filename = path.replace(/\\/g, '/').split('/').pop()
  return `/thumbs/${filename}`
}

/**
 * Instagram-style profile header shown at the top of a creator-filtered feed.
 * Banner + big rarity-ringed PFP + stats + bio + story highlights.
 * Props: profile (from feedApi.profile), onBack()
 */
export default function SimProfileHeader({ profile, onBack }) {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [pfpZoom, setPfpZoom] = useState(false)
  const [dmOpening, setDmOpening] = useState(false)
  const setCompanionConfig = useVaultStore(s => s.setCompanionConfig)
  const setCompanionOpen   = useVaultStore(s => s.setCompanionOpen)

  const followMutation = useMutation({
    mutationFn: () => creatorsApi.update(profile.id, { is_favorite: !profile.is_favorite }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed-profile', String(profile.id)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
    },
  })

  // DM = the existing floating companion chat, scoped to this creator as the persona
  const openDM = async () => {
    if (dmOpening) return
    setDmOpening(true)
    try {
      const res = await companionApi.updateConfig({ active_persona_id: profile.id, enabled: true })
      if (res?.data) {
        setCompanionConfig(res.data)
        qc.setQueryData(['companion-config'], res.data)
      }
      setCompanionOpen(true)
    } catch {
      toast.error(t('Could not open chat'))
    } finally {
      setDmOpening(false)
    }
  }

  const following = profile.is_favorite
  const rc = RARITY_COLORS[profile.card_rarity] || RARITY_COLORS.common
  const bannerSrc = profile.banner_image_id
    ? `/api/images/${profile.banner_image_id}/file`
    : profile.has_banner ? `/api/creators/${profile.id}/banner` : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[16px] overflow-hidden mb-6"
      style={{ background: '#161618', border: '0.5px solid rgba(255,255,255,0.09)' }}>

      {/* Banner — shorter on phones */}
      <div className="relative" style={{ height: 'clamp(150px, 26vw, 240px)', background: 'rgba(127,119,221,0.08)' }}>
        {bannerSrc && (
          <img src={bannerSrc} alt="" className="absolute inset-0 w-full h-full object-cover"
               onError={e => { e.target.style.display = 'none' }} />
        )}
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(22,22,24,0.35) 55%, #161618 100%)' }} />

        {/* Floating nav buttons */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between" style={{ zIndex: 2 }}>
          <button onClick={onBack}
                  className="flex items-center gap-1.5 text-[14px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.18)' }}>
            <ArrowLeft size={14} /> {t('Feed')}
          </button>
          <button onClick={() => navigate(`/creators/${profile.id}`)}
                  className="flex items-center gap-1.5 text-[14px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ color: '#fff', background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.18)' }}>
            <ExternalLink size={13} /> {t('Open in Vault')}
          </button>
        </div>
      </div>

      <div className="px-4 md:px-7 pb-6">
        {/* Identity row — PFP overlaps the banner */}
        <div className="flex items-end gap-4 md:gap-6 -mt-[55px] md:-mt-[85px]">
          <img
            src={profile.has_avatar ? `/api/creators/${profile.id}/avatar-thumb?size=480` : '/logo.png'}
            alt="" onError={e => { if (!e.target.src.endsWith('/logo.png')) e.target.src = '/logo.png' }}
            onClick={() => profile.has_avatar && setPfpZoom(true)}
            className="w-[110px] h-[110px] md:w-[170px] md:h-[170px] rounded-full object-cover flex-shrink-0 relative cursor-zoom-in transition-transform hover:scale-[1.03]"
            style={{ border: `4px solid ${rc}`, boxShadow: `0 0 45px ${rc}55, 0 8px 30px rgba(0,0,0,0.6)`, zIndex: 2 }}
          />
          <div className="min-w-0 flex-1 pb-2" style={{ zIndex: 2 }}>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[22px] md:text-[28px] font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.96)', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}>
                {profile.name}
              </span>
              <VerifiedBadge tier={profile.badge} size={24} />
            </div>
            <div className="text-[16px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
              @{profile.handle}
            </div>
          </div>
          <div className="flex items-center gap-2 pb-3 flex-shrink-0" style={{ zIndex: 2 }}>
            <button onClick={() => followMutation.mutate()} disabled={followMutation.isPending}
                    className="px-6 py-2.5 rounded-[10px] text-[15px] font-semibold cursor-pointer transition-all"
                    style={following
                      ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.16)' }
                      : { background: '#7F77DD', color: '#fff', border: '0.5px solid transparent' }}>
              {following ? t('Following ✓') : t('Follow')}
            </button>
            <button onClick={openDM} disabled={dmOpening} title={t('Message')}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] text-[15px] font-semibold cursor-pointer transition-all"
                    style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.16)' }}>
              <MessageCircle size={16} /> {t('Message')}
            </button>
          </div>
        </div>

        {/* Social stats */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-3 md:gap-x-10 mt-5">
          {[
            [profile.post_count, t('posts')],
            [fmtCount(profile.followers), t('followers')],
            [profile.following, t('following')],
          ].map(([v, label]) => (
            <div key={label} className="flex flex-col">
              <span className="text-[24px] font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.94)' }}>{v}</span>
              <span className="text-[15px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
            </div>
          ))}
          {/* Divider */}
          <div style={{ width: 1, height: 38, background: 'rgba(255,255,255,0.1)' }} />
          {/* Collection stats — the vault peeking through the sim */}
          {[
            [fmtCount(profile.image_count), t('photos'), ImagesIcon, 'rgba(255,255,255,0.8)'],
            [fmtCount(profile.video_count), t('videos'), Video, 'rgba(255,255,255,0.8)'],
            ...(profile.cum_count > 0 ? [[fmtCount(profile.cum_count), '💦', Droplets, '#ED93B1']] : []),
          ].map(([v, label, Icon, color]) => (
            <div key={label} className="flex flex-col">
              <span className="text-[24px] font-semibold leading-tight flex items-center gap-1.5" style={{ color }}>
                {v}
              </span>
              <span className="text-[15px] flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <Icon size={13} /> {label}
              </span>
            </div>
          ))}
        </div>

        {/* Bio */}
        {profile.bio && (
          <div className="mt-4 text-[16px] leading-relaxed max-w-2xl" style={{ color: 'rgba(255,255,255,0.68)' }}>
            {profile.bio}
          </div>
        )}

        {/* Highlights — favorite galleries as story circles */}
        {profile.highlights?.length > 0 && (
          <div className="flex gap-5 mt-6 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {profile.highlights.map(h => (
              <div key={h.id} onClick={() => navigate(`/galleries/${h.id}`)}
                   className="flex flex-col items-center gap-2 cursor-pointer flex-shrink-0" style={{ width: 92 }}>
                <div className="w-20 h-20 rounded-full overflow-hidden"
                     style={{ border: '2px solid rgba(255,255,255,0.22)', padding: 2.5, background: '#0e0e0e' }}>
                  {h.cover_thumb
                    ? <img src={thumbSrc(h.cover_thumb)} alt="" className="w-full h-full object-cover rounded-full"
                           onError={e => { e.target.style.visibility = 'hidden' }} />
                    : <div className="w-full h-full rounded-full" style={{ background: 'rgba(127,119,221,0.2)' }} />
                  }
                </div>
                <span className="text-[13px] truncate w-full text-center" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {h.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PFP maximize lightbox */}
      {pfpZoom && createPortal(
        <div className="fixed inset-0 z-[95] flex items-center justify-center cursor-zoom-out"
             style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(12px)', animation: 'fadeIn 0.18s ease' }}
             onClick={() => setPfpZoom(false)}>
          <div style={{ animation: 'zoomIn 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <img
              src={`/api/creators/${profile.id}/avatar`}
              alt={profile.name}
              className="rounded-[24px]"
              style={{ maxHeight: '88vh', maxWidth: '88vw', objectFit: 'contain', border: `3px solid ${rc}`, boxShadow: `0 0 90px ${rc}55` }}
            />
            <div className="text-center mt-3 text-[15px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              @{profile.handle}
            </div>
          </div>
          <style>{`
            @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes zoomIn { from { transform: scale(0.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }
          `}</style>
        </div>,
        document.body
      )}
    </motion.div>
  )
}
