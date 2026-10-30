import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LayoutGrid, LayoutDashboard, Rows3, List, CalendarDays, PanelsTopLeft, SquareStack, SquareUser, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { VIEW_MODES } from './viewModes'

const ICONS = {
  grid: LayoutGrid,
  cards: PanelsTopLeft,
  compact: SquareStack,
  portrait: SquareUser,
  avatars: Users,
  masonry: LayoutDashboard,
  justified: Rows3,
  details: List,
  timeline: CalendarDays,
}

// Same look and behaviour as SortDropdown, so the two sit together in the
// toolbar of every list.
export default function ViewModeDropdown({ value, onChange, modes }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const Icon = ICONS[value] || LayoutGrid
  return (
    <div ref={ref} className="relative z-30 flex-shrink-0 vault-row-control">
      <button
        type="button"
        title={t('View')}
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] cursor-pointer"
        style={{
          background: 'rgba(255,255,255,0.05)',
          color: 'rgba(255,255,255,0.45)',
          border: '0.5px solid rgba(255,255,255,0.08)',
        }}>
        <Icon size={13} />
        {t(VIEW_MODES[value]?.label ?? 'View')}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-[10px] shadow-2xl animate-menu-pop py-1"
             onWheel={e => e.stopPropagation()}
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 240 }}>
          {modes.map(mode => {
            const ModeIcon = ICONS[mode] || LayoutGrid
            const active = mode === value
            return (
              <button key={mode} type="button"
                      onMouseDown={() => { onChange(mode); setOpen(false) }}
                      className="w-full text-left px-3 py-2 cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-2.5"
                      style={{
                        color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.75)',
                        background: active ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                      }}>
                <ModeIcon size={15} style={{ flexShrink: 0, color: active ? 'var(--c-accent)' : 'rgba(255,255,255,0.45)' }} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-[16px] leading-6">{t(VIEW_MODES[mode].label)}</span>
                  <span className="text-[12px] leading-4" style={{ color: 'rgba(255,255,255,0.35)' }}>{t(VIEW_MODES[mode].hint)}</span>
                </span>
                {active && <Check size={12} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
