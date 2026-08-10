import React, { useRef, useState, useEffect } from 'react'
import { Sparkles, X, Maximize2, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { useVaultStore } from '../../store/vault'
import { companionApi, creatorsApi } from '../../lib/api'
import { useAllCreators } from '../../hooks/useAllCreators'
import { usePersonalMode } from '../../hooks/usePersonalMode'
import CompanionChat from './CompanionChat'
import { GroupChat, GroupsPanel, hasPersonalModules } from './personalModules'

export default function CompanionBubble() {
  const companion          = useVaultStore(s => s.companion)
  const setOpen            = useVaultStore(s => s.setCompanionOpen)
  const setCompanionConfig = useVaultStore(s => s.setCompanionConfig)
  const setCompanionGroup  = useVaultStore(s => s.setCompanionGroup)
  const navigate           = useNavigate()
  const bubbleRef          = useRef(null)
  const qc                 = useQueryClient()
  const [tab, setTab]      = useState('dm')   // 'dm' | 'groups'

  // Fetch creators for the persona switcher
  const { data: creators } = useAllCreators()

  // Group chat is personal-mode content: hidden unless this build actually has
  // the components AND the gate is currently unlocked.
  const personalMode = usePersonalMode()
  const groupsAvailable = hasPersonalModules && personalMode

  // A drama-spawned group opened from a ping banner lands here with groupId set
  useEffect(() => {
    if (companion.groupId && groupsAvailable) setTab('groups')
  }, [companion.groupId, groupsAvailable])

  // Locking personal mode while the groups tab is open drops you back to the DM
  useEffect(() => {
    if (!groupsAvailable && tab === 'groups') setTab('dm')
  }, [groupsAvailable, tab])

  if (!companion.enabled || !companion.config) return null

  const config   = companion.config
  const compName = config.name || 'Erika'
  const groupId  = companion.groupId

  // Non-reload persona change: update API + zustand + invalidate queries
  const handlePersonaChange = async (id) => {
    try {
      const res = await companionApi.updateConfig({ active_persona_id: id })
      if (res?.data) {
        setCompanionConfig(res.data)
        qc.setQueryData(['companion-config'], res.data)
      }
    } catch (e) {
      console.error('persona switch failed', e)
    }
  }

  return (
    <>
      {/* Floating avatar button */}
      <AnimatePresence>
        {!companion.open && (
          <motion.button
            key="bubble-btn"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-[200] w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-110 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #7F77DD, #D4537E)',
              boxShadow: '0 0 20px rgba(127,119,221,0.4)',
            }}
            title={`Chat with ${compName}`}
          >
            <Sparkles size={24} color="#fff" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Compact chat drawer */}
      <AnimatePresence>
        {companion.open && (
          <motion.div
            key="bubble-drawer"
            ref={bubbleRef}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[200] w-[360px] rounded-2xl overflow-hidden flex flex-col"
            style={{
              height: 480,
              background: '#161616',
              border: '1px solid rgba(127,119,221,0.2)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 30px rgba(127,119,221,0.1)',
            }}
          >
            {/* Drawer header */}
            <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
                 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(127,119,221,0.08)' }}>
              <Sparkles size={16} style={{ color: '#7F77DD' }} />
              <span className="flex-1 text-[17px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>
                {compName}
              </span>
              {/* DMs / Groups toggle */}
              <div className="flex rounded-lg overflow-hidden flex-shrink-0"
                   style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                {[
                  { id: 'dm',     label: 'DM' },
                  ...(groupsAvailable ? [{ id: 'groups', label: <Users size={13} /> }] : []),
                ].map(t => (
                  <button key={t.id}
                          onClick={() => { setTab(t.id); if (t.id === 'dm') setCompanionGroup(null) }}
                          className="px-2.5 py-1 text-[13px] font-medium flex items-center transition-all"
                          style={tab === t.id
                            ? { background: 'rgba(127,119,221,0.3)', color: '#CECBF6' }
                            : { color: 'rgba(255,255,255,0.4)' }}
                          title={t.id === 'groups' ? 'Group chats' : '1-on-1 chat'}>
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setOpen(false); navigate('/erika') }}
                className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                title="Open full page"
                style={{ color: 'rgba(255,255,255,0.4)' }}
              >
                <Maximize2 size={15} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                title="Close"
                style={{ color: 'rgba(255,255,255,0.4)' }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Body — 1-on-1 chat, groups list, or an open group */}
            <div className="flex-1 min-h-0">
              {(tab === 'dm' || !groupsAvailable) ? (
                <CompanionChat
                  config={config}
                  creators={creators || []}
                  onPersonaChange={handlePersonaChange}
                  compact
                />
              ) : groupId ? (
                <GroupChat
                  groupId={groupId}
                  compact
                  onBack={() => setCompanionGroup(null)}
                  onDeleted={() => setCompanionGroup(null)}
                />
              ) : (
                <GroupsPanel creators={creators || []} onOpenGroup={(id) => setCompanionGroup(id)} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
