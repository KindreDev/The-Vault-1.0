import React from 'react'
import { LocalizedText, useT } from '../../i18n'
import { Layers, Loader, Sparkles } from 'lucide-react'

export default function TCGSetupGate({ status, loading, starting, onStart }) {
  const t = useT()
  const waiting = status?.owned_cards_waiting ?? 0
  return (
    <div style={{ minHeight: '100vh', background: '#080810', padding: '48px 28px' }}>
      <div style={{
        width: 'min(720px, 100%)', margin: '8vh auto 0', padding: 40, borderRadius: 24,
        background: 'linear-gradient(145deg, rgba(127,119,221,0.14), rgba(212,83,126,0.06))',
        border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 30px 90px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'rgba(127,119,221,0.2)' }}>
            <Layers size={28} color="var(--c-accent-text)" />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 28, fontWeight: 800 }}><LocalizedText text={"Start your new card collection"} /></div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, marginTop: 4 }}><LocalizedText text={"Your existing collection stays safe."} /></div>
          </div>
        </div>
        {loading ? (
          <div style={{ minHeight: 120, display: 'grid', placeItems: 'center' }}><Loader size={26} className="animate-spin" /></div>
        ) : (
          <>
            <div style={{ color: 'rgba(255,255,255,0.76)', fontSize: 17, lineHeight: 1.65 }}>
              {waiting > 0
                ? t('The {count} cards you already own will be kept as Legacy cards. They can be shown or hidden whenever you want, while every card minted from now on belongs to the new system.', { count: waiting.toLocaleString() })
                : t('No older cards were found. Your first mint will begin the new collection cleanly.')}
            </div>
            <button type="button" onClick={onStart} disabled={starting} style={{
              marginTop: 30, minHeight: 52, padding: '0 24px', borderRadius: 14, cursor: starting ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              color: '#fff', fontSize: 17, fontWeight: 800,
              background: 'linear-gradient(135deg, var(--c-accent), var(--c-pink))',
              border: '1px solid rgba(255,255,255,0.22)', opacity: starting ? 0.65 : 1,
            }}>
              {starting ? <Loader size={20} className="animate-spin" /> : <Sparkles size={20} />}
              {starting ? 'Preparing your collection…' : 'Start the TCG'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
