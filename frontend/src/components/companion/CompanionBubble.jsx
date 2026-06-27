import React, { useRef } from 'react'
import { Sparkles, X, Maximize2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVaultStore } from '../../store/vault'
import { companionApi, creatorsApi } from '../../lib/api'
import { useAllCreators } from '../../hooks/useAllCreators'
import CompanionChat from './CompanionChat'

export default function CompanionBubble() {
  const companion          = useVaultStore(s => s.companion)
  const setOpen            = useVaultStore(s => s.setCompanionOpen)
  const setCompanionConfig = useVaultStore(s => s.setCompanionConfig)
  const navigate           = useNavigate()
  const bubbleRef          = useRef(null)
  const qc                 = useQueryClient()

  // Fetch creators for the persona switcher
  const { data: creators } = useAllCreators()

  if (!companion.enabled || !companion.config) return null

  const config   = companion.config
  const compName = config.name || 'Erika'

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
              <span className="flex-1 text-[17px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>
                {compName}
              </span>
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

            {/* Chat — shared component, same history */}
            <div className="flex-1 min-h-0">
              <CompanionChat
                config={config}
                creators={creators || []}
                onPersonaChange={handlePersonaChange}
                compact
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
