import { Loader2 } from 'lucide-react'

export function PageHeader({ title, right }) {
  return (
    <div
      className="sticky top-0 z-30 flex items-center justify-between px-4 pb-3 backdrop-blur"
      style={{ paddingTop: 'calc(var(--sat) + 12px)', background: 'color-mix(in srgb, var(--c-bg) 88%, transparent)' }}
    >
      <h1 className="text-2xl font-bold truncate">{title}</h1>
      {right}
    </div>
  )
}

export function Spinner({ className = '' }) {
  return (
    <div className={`flex items-center justify-center py-16 ${className}`}>
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  )
}

export function Empty({ icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center gap-3"
         style={{ color: 'rgba(255,255,255,0.4)' }}>
      {icon}
      <p className="text-[16px]">{text}</p>
    </div>
  )
}

// Small pink lifetime-count pill used on cards (the cum counter).
export function CountPill({ value, color = 'var(--c-pink)' }) {
  if (!value) return null
  return (
    <span className="px-1.5 py-0.5 rounded-md text-[12px] font-bold"
          style={{ background: color, color: '#fff' }}>
      {value}
    </span>
  )
}
