import { AnimatePresence, motion } from 'framer-motion'
import { useVaultStore } from '../store/vault.js'

export default function ToastLayer() {
  const toasts = useVaultStore(s => s.toasts)

  return (
    <div className="fixed left-0 right-0 z-[60] flex flex-col items-center gap-2 pointer-events-none"
         style={{ top: 'calc(var(--sat) + 12px)' }}>
      <AnimatePresence initial={true}>
        {toasts.map(t => (
          <motion.div key={t.id}
               layout
               initial={{ opacity: 0, y: -20, scale: 0.9 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               exit={{ opacity: 0, y: -12, scale: 0.9 }}
               transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
               className="px-4 py-2 rounded-full text-[15px] font-semibold shadow-lg backdrop-blur"
               style={{
                 background: t.type === 'credits' ? 'var(--c-amber)'
                           : t.type === 'xp'      ? 'var(--accent)'
                           : 'var(--c-card)',
                 color: t.type === 'info' ? 'rgba(255,255,255,0.9)' : '#fff',
               }}>
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
