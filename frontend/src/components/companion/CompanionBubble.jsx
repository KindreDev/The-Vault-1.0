import React, { useRef, useState, useEffect, useCallback } from 'react'
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

// The bubble sits above everything, so wherever it parks it will eventually
// cover something. Position is the user's to set, and it persists.
const POS_KEY  = 'vault.companion.bubblePos'
const BUBBLE   = 56          // w-14 / h-14
const MARGIN   = 24          // matches the old bottom-6 right-6 resting place
const DRAG_MIN = 4           // px before a press becomes a drag, not a click

const defaultPos = () => ({
  x: window.innerWidth  - BUBBLE - MARGIN,
  y: window.innerHeight - BUBBLE - MARGIN,
})

const clampPos = (p) => ({
  x: Math.min(Math.max(p.x, MARGIN / 2), window.innerWidth  - BUBBLE - MARGIN / 2),
  y: Math.min(Math.max(p.y, MARGIN / 2), window.innerHeight - BUBBLE - MARGIN / 2),
})

export default function CompanionBubble() {
  const companion          = useVaultStore(s => s.companion)
  const setOpen            = useVaultStore(s => s.setCompanionOpen)
  const setCompanionConfig = useVaultStore(s => s.setCompanionConfig)
  const setCompanionGroup  = useVaultStore(s => s.setCompanionGroup)
  const navigate           = useNavigate()
  const bubbleRef          = useRef(null)
  const qc                 = useQueryClient()
  const [tab, setTab]      = useState('dm')   // 'dm' | 'groups'

  const [pos, setPos]       = useState(null)   // null until measured client-side
  const [dragging, setDragging] = useState(false)
  const dragState = useRef(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      setPos(saved ? clampPos(saved) : defaultPos())
    } catch {
      setPos(defaultPos())
    }
  }, [])

  // A window that shrinks below the bubble's saved corner would strand it
  // off-screen with no way to drag it back.
  useEffect(() => {
    const onResize = () => setPos(p => (p ? clampPos(p) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startDrag = useCallback((e) => {
    if (e.button !== 0) return
    const origin = { x: e.clientX, y: e.clientY }
    dragState.current = { origin, start: pos, moved: false }

    const onMove = (ev) => {
      const st = dragState.current
      if (!st) return
      const dx = ev.clientX - st.origin.x
      const dy = ev.clientY - st.origin.y
      if (!st.moved && Math.hypot(dx, dy) < DRAG_MIN) return
      st.moved = true
      setDragging(true)
      setPos(clampPos({ x: st.start.x + dx, y: st.start.y + dy }))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const st = dragState.current
      dragState.current = null
      setDragging(false)
      if (st?.moved) {
        // Swallow the click that follows the mouseup, so parking the bubble
        // doesn't also open the chat.
        window.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault() },
                                { capture: true, once: true })
        setPos(p => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch {} ; return p })
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pos])

  // The drawer hangs off whichever corner the bubble is parked nearest, so it
  // opens into free space instead of off the edge of the screen.
  const drawerAnchor = () => {
    const p = pos || defaultPos()
    const right  = p.x + BUBBLE / 2 > window.innerWidth / 2
    const bottom = p.y + BUBBLE / 2 > window.innerHeight / 2
    return {
      [right ? 'right' : 'left']: Math.max(MARGIN / 2,
        right ? window.innerWidth - p.x - BUBBLE : p.x),
      [bottom ? 'bottom' : 'top']: Math.max(MARGIN / 2,
        bottom ? window.innerHeight - p.y - BUBBLE : p.y),
    }
  }

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
            onMouseDown={startDrag}
            className={`fixed z-[200] w-14 h-14 rounded-full flex items-center justify-center shadow-xl ${
              dragging ? '' : 'transition-transform hover:scale-110 active:scale-95'}`}
            style={{
              left: (pos || defaultPos()).x,
              top:  (pos || defaultPos()).y,
              cursor: dragging ? 'grabbing' : 'grab',
              background: 'linear-gradient(135deg, var(--c-accent), var(--c-pink))',
              boxShadow: '0 0 20px color-mix(in srgb, var(--c-accent) 40%, transparent)',
              touchAction: 'none',
            }}
            title={`Chat with ${compName} — drag to move`}
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
            className="fixed z-[200] w-[360px] rounded-2xl overflow-hidden flex flex-col"
            style={{
              ...drawerAnchor(),
              height: 480,
              background: '#161616',
              border: '1px solid color-mix(in srgb, var(--c-accent) 20%, transparent)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 30px color-mix(in srgb, var(--c-accent) 10%, transparent)',
            }}
          >
            {/* Drawer header */}
            <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
                 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)' }}>
              <Sparkles size={16} style={{ color: 'var(--c-accent)' }} />
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
                            ? { background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)' }
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
