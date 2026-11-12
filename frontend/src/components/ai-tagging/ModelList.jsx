import { Download, Check } from 'lucide-react'
import { useT } from '../../i18n'

// Downloadable local models: taggers (one per file) and detector add-ons.
export default function ModelList({ models, busy, onDownload }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2">
      {models.map(m => (
        <div key={m.key} className="flex items-center justify-between gap-3 py-3 px-4 rounded-[8px]"
             style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0"
                 style={{ background: m.ready ? 'var(--c-green)' : 'rgba(255,255,255,0.2)' }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[16px] font-medium text-white/85">
                {m.label}
                {m.kind === 'detector' && (
                  <span className="px-2 rounded-full text-[16px] font-normal"
                        style={{ background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)', color: 'var(--c-accent-text)' }}>
                    {t('add-on')}
                  </span>
                )}
              </div>
              <div className="text-[16px] text-white/45">{t(m.desc)}</div>
            </div>
          </div>
          {m.ready ? (
            <span className="flex items-center gap-1.5 text-[16px] flex-shrink-0" style={{ color: 'var(--c-green-text)' }}>
              <Check size={15} /> {m.size_mb ? `${Math.round(m.size_mb)} MB` : t('Downloaded')}
            </span>
          ) : m.downloadable === false ? (
            <span className="text-[16px] text-white/40 flex-shrink-0" title={t('This model has no download source; it is installed by hand.')}>
              {t('Not installed')}
            </span>
          ) : (
            <button disabled={busy} onClick={() => onDownload(m.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[16px] cursor-pointer disabled:opacity-40 flex-shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
              <Download size={14} /> {t('Download')} · ~{m.approx_mb >= 1000 ? `${(m.approx_mb / 1000).toFixed(1)} GB` : `${m.approx_mb} MB`}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
