import { Cpu, Pause, Play, X } from 'lucide-react'
import { useT } from '../../i18n'

const pillButton = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-[16px] cursor-pointer'

function formatEta(seconds, t) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600)
    const m = Math.round((seconds % 3600) / 60)
    return m ? t('~{h} h {m} min left', { h, m }) : t('~{h} h left', { h })
  }
  if (seconds >= 60) return t('~{m} min left', { m: Math.round(seconds / 60) })
  return t('~{s} s left', { s: Math.round(seconds) })
}

// A running or paused tagging job: models, progress, speed, controls.
export default function RunProgress({ status, onPause, onResume, onCancel }) {
  const t = useT()
  const pct = status.total > 0 ? (status.progress / status.total) * 100 : 0
  const eta = status.paused ? t('Paused — progress saved') : formatEta(status.eta_seconds, t)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {status.active_model && (
            <span className="flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[16px] font-medium"
                  style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)' }}>
              <Cpu size={14} /> {status.active_model}
            </span>
          )}
          {status.device && (
            <span className="px-3 py-0.5 rounded-full text-[16px] font-medium"
                  style={{ background: status.device === 'gpu' ? 'color-mix(in srgb, var(--c-green) 20%, transparent)' : 'rgba(255,255,255,0.07)',
                           color: status.device === 'gpu' ? 'var(--c-green-text)' : 'rgba(255,255,255,0.5)' }}>
              {status.device === 'gpu' ? t('⚡ GPU') : t('🖥 CPU')}
            </span>
          )}
          {status.total > 0 && (
            <span className="text-[16px] text-white/60">{status.progress.toLocaleString()} / {status.total.toLocaleString()}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status.paused ? (
            <button onClick={onResume} className={pillButton}
                    style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
              <Play size={14} /> {t('Resume')}
            </button>
          ) : (
            <button onClick={onPause} className={pillButton}
                    style={{ background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)' }}>
              <Pause size={14} /> {t('Pause')}
            </button>
          )}
          <button onClick={onCancel} className={pillButton}
                  style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
            <X size={14} /> {t('Cancel')}
          </button>
        </div>
      </div>
      <div className="h-2 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
        {status.total > 0 ? (
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--c-accent)' }} />
        ) : (
          <div className="h-full rounded-full animate-pulse" style={{ width: '100%', background: 'color-mix(in srgb, var(--c-amber) 45%, transparent)' }} />
        )}
      </div>
      {status.total > 0 ? (
        <div className="flex items-center justify-between gap-3 flex-wrap text-[16px]">
          <div className="text-white/45">
            {status.tagged.toLocaleString()} {t('tagged')} · {status.skipped.toLocaleString()} {t('skipped')}
            {status.errors > 0 && <span style={{ color: '#F4C0D1' }}> · {status.errors} {t('errors')}</span>}
            {status.items_per_second > 0 && <> · {status.items_per_second.toFixed(1)} {t('files/s')}</>}
          </div>
          {eta && <div style={{ color: 'var(--c-accent-text)' }}>{eta}</div>}
        </div>
      ) : (
        <div className="text-[16px] text-white/50">{status.message}</div>
      )}
      {status.current_path && (
        <div className="text-[16px] truncate text-white/30" title={status.current_path}>
          {status.current_path.replace(/.*[\\/]/, '')}
        </div>
      )}
    </div>
  )
}
