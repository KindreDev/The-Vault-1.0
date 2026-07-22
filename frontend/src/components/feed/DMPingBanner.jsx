import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircleHeart, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { feedApi, companionApi } from '../../lib/api'
import { useVaultStore } from '../../store/vault'
import { useT } from '../../i18n'

/**
 * "She texted you first" banner at the top of the feed.
 * Replying flips the companion to her persona and opens the floating chat —
 * her opener is already sitting in the chat history waiting for you.
 *
 * Props: ping ({ id, message, creator }), onDismiss()
 */
export default function DMPingBanner({ ping, onDismiss }) {
  const t = useT()
  const qc = useQueryClient()
  const [opening, setOpening] = useState(false)
  const setCompanionConfig = useVaultStore(s => s.setCompanionConfig)
  const setCompanionOpen   = useVaultStore(s => s.setCompanionOpen)
  const setCompanionGroup  = useVaultStore(s => s.setCompanionGroup)

  const markRead = () => {
    feedApi.dmRead(ping.id).catch(() => {})
    qc.invalidateQueries({ queryKey: ['feed-dm'] })
    onDismiss?.()
  }

  const reply = async () => {
    if (opening) return
    setOpening(true)
    try {
      if (ping.group_id) {
        // "She added you to a group" — open the group chat, not her 1-on-1 DM
        const res = await companionApi.updateConfig({ enabled: true })
        if (res?.data) {
          setCompanionConfig(res.data)
          qc.setQueryData(['companion-config'], res.data)
        }
        setCompanionGroup(ping.group_id)
      } else {
        const res = await companionApi.updateConfig({ active_persona_id: ping.creator.id, enabled: true })
        if (res?.data) {
          setCompanionConfig(res.data)
          qc.setQueryData(['companion-config'], res.data)
        }
      }
      setCompanionOpen(true)
      markRead()
    } catch {
      toast.error(t('Could not open chat'))
    } finally {
      setOpening(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-3.5 rounded-[14px] px-4 py-3.5 mb-5 cursor-pointer"
      style={{
        background: 'linear-gradient(120deg, rgba(212,83,126,0.14), rgba(127,119,221,0.12))',
        border: '0.5px solid rgba(212,83,126,0.35)',
        boxShadow: '0 4px 24px rgba(212,83,126,0.12)',
      }}
      onClick={reply}
    >
      {/* Pulsing avatar ring */}
      <div className="relative flex-shrink-0">
        <motion.div
          animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="absolute inset-0 rounded-full"
          style={{ border: '2px solid #ED93B1' }}
        />
        <img
          src={ping.creator.has_avatar ? `/api/creators/${ping.creator.id}/avatar-thumb?size=96` : '/logo.png'}
          alt="" onError={e => { if (!e.target.src.endsWith('/logo.png')) e.target.src = '/logo.png' }}
          className="w-12 h-12 rounded-full object-cover"
          style={{ border: '2px solid rgba(237,147,177,0.7)' }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>
          <MessageCircleHeart size={15} style={{ color: '#ED93B1' }} />
          {ping.creator.name} {ping.group_id ? t('added you to a group') : t('sent you a message')}
        </div>
        <div className="text-[14px] italic truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          “{ping.message}”
        </div>
      </div>

      <button
        onClick={e => { e.stopPropagation(); reply() }}
        disabled={opening}
        className="flex-shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold cursor-pointer"
        style={{ background: 'rgba(212,83,126,0.3)', color: '#FFD3E0', border: '0.5px solid rgba(212,83,126,0.5)' }}>
        {opening ? t('Opening…') : t('Reply 💜')}
      </button>
      <button
        onClick={e => { e.stopPropagation(); markRead() }}
        className="fx-btn flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', border: 'none' }}>
        <X size={14} />
      </button>
    </motion.div>
  )
}
