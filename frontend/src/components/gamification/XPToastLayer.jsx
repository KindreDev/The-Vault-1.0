import React from 'react'
import { useVaultStore } from '../../store/vault'

const TOAST_STYLES = {
  xp: {
    background: 'color-mix(in srgb, var(--c-accent) 93%, transparent)',
    border:     'color-mix(in srgb, var(--c-accent) 50%, transparent)',
    color:      '#fff',
    icon:       '⚡',
  },
  credits: {
    background: 'color-mix(in srgb, var(--c-amber) 93%, transparent)',
    border:     'color-mix(in srgb, var(--c-amber) 50%, transparent)',
    color:      '#fff',
    icon:       '🪙',
  },
}

function RegularToast({ t }) {
  const style = TOAST_STYLES[t.type] || TOAST_STYLES.xp
  return (
    <div
      className="xp-toast flex items-center gap-3 px-7 py-4 rounded-2xl font-semibold shadow-2xl"
      style={{
        background:    style.background,
        color:         style.color,
        border:        `1px solid ${style.border}`,
        boxShadow:     '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter:'blur(12px)',
        fontSize:      20,
        letterSpacing: '0.01em',
        minWidth:      160,
      }}
    >
      <span style={{ fontSize: 22 }}>{style.icon}</span>
      {t.msg}
    </div>
  )
}

function PackToast({ t }) {
  const isPremium = t.packType === 'premium'
  return (
    <div
      className="xp-toast flex items-center gap-4 px-8 py-5 rounded-2xl font-bold shadow-2xl"
      style={{
        background:    isPremium
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--c-amber) 97%, transparent) 0%, color-mix(in srgb, var(--c-pink) 97%, transparent) 100%)'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--c-accent) 97%, transparent) 0%, color-mix(in srgb, var(--c-green) 97%, transparent) 100%)',
        color:         '#fff',
        border:        `1px solid ${isPremium ? 'color-mix(in srgb, var(--c-amber) 50%, transparent)' : 'color-mix(in srgb, var(--c-accent) 40%, transparent)'}`,
        boxShadow:     `0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px ${isPremium ? 'color-mix(in srgb, var(--c-amber) 15%, transparent)' : 'color-mix(in srgb, var(--c-accent) 20%, transparent)'}`,
        backdropFilter:'blur(16px)',
        minWidth:      220,
      }}
    >
      <span style={{ fontSize: 36, lineHeight: 1 }}>🎴</span>
      <div className="flex flex-col gap-0.5">
        <span style={{ fontSize: 13, opacity: 0.75, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Quest reward
        </span>
        <span style={{ fontSize: 24, lineHeight: 1.15 }}>
          {t.quantity} {isPremium ? 'Premium' : 'Booster'} {t.quantity === 1 ? 'Pack' : 'Packs'}
        </span>
        <span style={{ fontSize: 13, opacity: 0.65, fontWeight: 400 }}>
          Added to your collection
        </span>
      </div>
    </div>
  )
}

export default function XPToastLayer() {
  const toasts = useVaultStore(s => s.xpToasts)
  return (
    <div className="fixed bottom-8 right-8 flex flex-col-reverse gap-3 pointer-events-none z-50">
      {toasts.map(t =>
        t.type === 'pack'
          ? <PackToast key={t.id} t={t} />
          : <RegularToast key={t.id} t={t} />
      )}
    </div>
  )
}
