import { motion } from 'framer-motion'
import { Cpu, X } from 'lucide-react'
import ModalLayer from '../ModalLayer'
import { useT } from '../../i18n'
import AITaggingPanel from './AITaggingPanel'

// Dashboard → Tools → AI Tagging. Same controls as Settings, run section first.
export default function AITaggingModal({ onClose }) {
  const t = useT()
  return (
    <ModalLayer>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
           style={{ background: 'rgba(0,0,0,0.78)' }}
           onMouseDown={e => e.target === e.currentTarget && onClose()}>
        <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col overflow-hidden rounded-2xl shadow-2xl"
                    style={{ width: 'min(760px, 96vw)', maxHeight: '90vh', background: 'var(--c-surface)', border: '1px solid rgba(255,255,255,0.12)' }}>
          <header className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <Cpu size={22} style={{ color: 'var(--c-accent)' }} />
            <div className="flex-1">
              <div className="text-[20px] font-bold text-white/90">{t('AI Tagging')}</div>
              <div className="text-[16px] text-white/50">{t('Tag by library, folder or creator; photos and videos together or apart.')}</div>
            </div>
            <button onClick={onClose} aria-label={t('Close')} className="p-2 rounded-lg cursor-pointer hover:bg-[rgba(255,255,255,0.08)]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <X size={22} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-5">
            <AITaggingPanel runFirst />
          </div>
        </motion.div>
      </div>
    </ModalLayer>
  )
}
