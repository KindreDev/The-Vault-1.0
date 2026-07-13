import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

// Always-first, always-last, current ± 1, with "…" collapsing the rest —
// keeps the pager small even when there are hundreds of pages.
function getPageWindow(page, totalPages) {
  const delta = 1
  const range = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      range.push(i)
    }
  }
  const withDots = []
  let last = 0
  for (const i of range) {
    if (last) {
      if (i - last === 2) withDots.push(last + 1)
      else if (i - last > 2) withDots.push('…')
    }
    withDots.push(i)
    last = i
  }
  return withDots
}

const navBtnClass = 'flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[16px] cursor-pointer ' +
  'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[rgba(255,255,255,0.05)] ' +
  'transition-all duration-150 hover:bg-white/10 active:scale-95'
const iconBtnClass = 'p-1.5 rounded-[6px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ' +
  'disabled:hover:bg-[rgba(255,255,255,0.05)] transition-all duration-150 hover:bg-white/10 active:scale-95'

// `id` keeps the top/bottom pager instances from fighting over the same
// shared-layout highlight — each gets its own animated pill.
export default function GalleryPagination({ page, totalPages, onChange, t = (s) => s, id = 'default' }) {
  const [jumpValue, setJumpValue] = useState('')
  const [jumpState, setJumpState] = useState('idle') // idle | invalid | success

  if (totalPages <= 1) return null

  const submitJump = () => {
    const n = parseInt(jumpValue, 10)
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
      onChange(n)
      setJumpValue('')
      setJumpState('success')
      setTimeout(() => setJumpState('idle'), 400)
    } else {
      setJumpState('invalid')
      setTimeout(() => setJumpState('idle'), 500)
    }
  }

  const pages = getPageWindow(page, totalPages)
  const jumpGlow = jumpState === 'invalid' ? 'rgba(212,83,126,0.6)' : jumpState === 'success' ? 'rgba(127,119,221,0.6)' : null

  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <button
        onClick={() => onChange(1)}
        disabled={page === 1}
        className={iconBtnClass}
        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}
        title={t('First page')}>
        <ChevronsLeft size={14} />
      </button>
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className={navBtnClass}
        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
        <ChevronLeft size={13} /> {t('Prev')}
      </button>

      {pages.map((p, i) => (
        p === '…' ? (
          <span key={`dots-${i}`} className="w-8 text-center text-[16px]" style={{ color: 'rgba(255,255,255,0.25)' }}>…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className="relative w-8 h-8 rounded-[6px] text-[16px] font-medium cursor-pointer transition-colors duration-150 active:scale-95"
            style={{ color: p === page ? '#CECBF6' : 'rgba(255,255,255,0.4)' }}>
            {p === page ? (
              <motion.span
                layoutId={`gallery-pager-highlight-${id}`}
                className="absolute inset-0 rounded-[6px]"
                style={{ background: 'rgba(127,119,221,0.25)', border: '0.5px solid rgba(127,119,221,0.4)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            ) : (
              <span
                className="absolute inset-0 rounded-[6px] bg-white/[0.04] hover:bg-white/10 transition-colors duration-150"
                style={{ border: '0.5px solid rgba(255,255,255,0.08)' }}
              />
            )}
            <span className="relative">{p}</span>
          </button>
        )
      ))}

      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className={navBtnClass}
        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
        {t('Next')} <ChevronRight size={13} />
      </button>
      <button
        onClick={() => onChange(totalPages)}
        disabled={page === totalPages}
        className={iconBtnClass}
        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}
        title={t('Last page')}>
        <ChevronsRight size={14} />
      </button>

      <motion.div
        className="flex items-center gap-1.5 ml-2"
        animate={jumpState === 'invalid' ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={e => { setJumpValue(e.target.value); if (jumpState !== 'idle') setJumpState('idle') }}
          onKeyDown={e => { if (e.key === 'Enter') submitJump() }}
          placeholder={t('Page…')}
          className="w-16 px-2 py-1.5 rounded-[8px] text-[16px] outline-none transition-all duration-150 focus:ring-2 focus:ring-[rgba(127,119,221,0.5)]"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${jumpGlow ?? 'rgba(255,255,255,0.1)'}`,
            color: 'rgba(255,255,255,0.8)',
            ...(jumpGlow ? { boxShadow: `0 0 0 2px ${jumpGlow.replace('0.6', '0.15')}` } : {}),
          }}
        />
        <button
          onClick={submitJump}
          className="px-3 py-1.5 rounded-[8px] text-[16px] cursor-pointer transition-all duration-150 hover:bg-white/10 active:scale-95"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
          {t('Go')}
        </button>
      </motion.div>
    </div>
  )
}
