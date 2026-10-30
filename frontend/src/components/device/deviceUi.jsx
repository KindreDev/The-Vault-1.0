import React from 'react'

// Shared Device Control primitives. Kept identical to the page's original
// local versions so every card on the page looks the same.

export function Card({ title, children, className = '' }) {
  return (
    <div className={`vault-card p-5 ${className}`}>
      {title && (
        <div className="text-[16px] font-semibold text-[rgba(255,255,255,0.5)] mb-4 uppercase tracking-wider">
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, unit = '', hint }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[16px] text-[rgba(255,255,255,0.6)]">{label}</span>
        <span className="text-[16px] font-mono text-[rgba(255,255,255,0.85)]">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[var(--c-accent)] cursor-pointer" />
      {hint && <div className="text-[16px] text-[rgba(255,255,255,0.3)] mt-0.5">{hint}</div>}
    </div>
  )
}

export function Toggle({ label, checked, onChange, desc }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-[var(--c-accent)]' : 'bg-[rgba(255,255,255,0.1)]'
        }`}
        onClick={() => onChange(!checked)}>
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <div>
        <div className="text-[16px] text-[rgba(255,255,255,0.85)] font-medium">{label}</div>
        {desc && <div className="text-[16px] text-[rgba(255,255,255,0.35)]">{desc}</div>}
      </div>
    </label>
  )
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 text-[16px] cursor-pointer transition-colors"
          style={{
            background: value === opt.value ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'transparent',
            color: value === opt.value ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
