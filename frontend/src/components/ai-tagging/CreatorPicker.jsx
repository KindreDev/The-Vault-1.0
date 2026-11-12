import { X } from 'lucide-react'
import { useT } from '../../i18n'

const TYPE_COLORS = { cosplayer: '#1D9E75', ethot: '#D4537E', artist: '#7F77DD', character: '#BA7517', actress: '#378ADD', custom: '#888780' }

// Search-and-pick a single creator for a creator-scoped tagging run.
export default function CreatorPicker({ search, onSearch, selected, onSelect, results }) {
  const t = useT()
  if (selected) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-[8px]"
           style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
        <span className="text-[16px] font-semibold" style={{ color: 'var(--c-accent-text)' }}>{selected.name}</span>
        <button onClick={() => onSelect('')} className="cursor-pointer" aria-label={t('Clear')} style={{ color: 'rgba(255,255,255,0.45)' }}><X size={16} /></button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <input placeholder={t('Search creators…')} value={search}
             onChange={e => onSearch(e.target.value)}
             className="w-full px-3 py-2 rounded-[8px] text-[16px] outline-none"
             style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }} />
      {results.length > 0 ? (
        <div className="rounded-[8px] overflow-y-auto"
             style={{ background: 'var(--c-card)', border: '0.5px solid rgba(255,255,255,0.1)', maxHeight: 200 }}>
          {results.map(c => (
            <button key={c.id} onClick={() => { onSelect(String(c.id)); onSearch('') }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer text-[16px] hover:bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)]"
                    style={{ color: 'rgba(255,255,255,0.8)', borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[c.creator_type] || '#888780' }} />
              {c.name}
              <span className="ml-auto capitalize text-white/35">{c.creator_type}</span>
            </button>
          ))}
        </div>
      ) : search ? (
        <div className="px-3 py-2 rounded-[8px] text-[16px] text-white/40" style={{ background: 'rgba(255,255,255,0.03)' }}>{t('No creators found')}</div>
      ) : null}
    </div>
  )
}
