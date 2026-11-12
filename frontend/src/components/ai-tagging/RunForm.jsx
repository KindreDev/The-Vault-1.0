import { Clock, Cpu } from 'lucide-react'
import { useT } from '../../i18n'
import RootDropdown from '../settings/RootDropdown'
import CreatorPicker from './CreatorPicker'

const SCOPES = [
  { key: 'library', label: 'Entire library' },
  { key: 'folder', label: 'Specific folder' },
  { key: 'creator', label: 'By creator' },
]
const MEDIA = [
  { key: 'all', label: 'Photos and videos' },
  { key: 'photos', label: 'Photos only' },
  { key: 'videos', label: 'Videos only' },
]

function Chip({ active, disabled, onClick, title, children }) {
  return (
    <button disabled={disabled} onClick={onClick} title={title}
            className="px-3 py-1.5 rounded-[6px] text-[16px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: active ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.05)',
              color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.6)',
              border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
            }}>
      {children}
    </button>
  )
}

function Toggle({ on, onClick, disabled, label, hint }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[16px] text-white/80">{label}</div>
        {hint && <div className="text-[16px] text-white/40 mt-0.5">{hint}</div>}
      </div>
      <button onClick={onClick} disabled={disabled} role="switch" aria-checked={on}
              className="w-11 h-6 rounded-full relative cursor-pointer flex-shrink-0 transition-colors disabled:opacity-50"
              style={{ background: on ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.12)' }}>
        <span className="w-4 h-4 rounded-full absolute top-1 transition-all bg-white" style={{ left: on ? 'calc(100% - 20px)' : '4px' }} />
      </button>
    </div>
  )
}

function Field({ label, children, hint }) {
  return (
    <div>
      <div className="text-[16px] font-semibold text-white/60 mb-2">{label}</div>
      {children}
      {hint && <div className="text-[16px] text-white/40 mt-1.5">{hint}</div>}
    </div>
  )
}

// Choices for a new tagging run. `tagging` is the useAITagging() result.
export default function RunForm({ tagging }) {
  const t = useT()
  const { prefs, update, model, extras } = tagging
  const toggleExtra = key => update({ extras: extras.includes(key) ? extras.filter(k => k !== key) : [...extras, key] })
  return (
    <div className="flex flex-col gap-5">
      {tagging.status?.message && tagging.status.message !== 'Idle' && (
        <div className="text-[16px] text-white/50">{tagging.status.message}</div>
      )}
      <Field label={t('What to tag')}>
        <div className="flex gap-2 flex-wrap">
          {SCOPES.map(s => <Chip key={s.key} active={tagging.scope === s.key} onClick={() => tagging.setScope(s.key)}>{t(s.label)}</Chip>)}
        </div>
        {tagging.scope === 'folder' && (
          <div className="mt-2"><RootDropdown roots={tagging.roots} value={tagging.rootId} onChange={tagging.setRootId} /></div>
        )}
        {tagging.scope === 'creator' && (
          <div className="mt-2">
            <CreatorPicker search={tagging.creatorSearch} onSearch={tagging.setCreatorSearch}
                           selected={tagging.selectedCreator} onSelect={tagging.setCreatorId}
                           results={tagging.filteredCreators} />
          </div>
        )}
        <div className="flex gap-2 flex-wrap mt-3">
          {MEDIA.map(m => <Chip key={m.key} active={prefs.media === m.key} onClick={() => update({ media: m.key })}>{t(m.label)}</Chip>)}
        </div>
      </Field>

      <Field label={t('Tagger')}
             hint={model === 'auto' ? t("Auto uses each gallery's creator type: real people → JoyTag, artists and characters → WD14.") : null}>
        <div className="flex gap-2 flex-wrap">
          <Chip active={model === 'auto'} onClick={() => update({ model: 'auto' })}>{t('Auto')}</Chip>
          {tagging.taggers.map(m => (
            <Chip key={m.key} active={model === m.key} disabled={!m.ready}
                  title={m.ready ? t(m.desc) : t('Model not downloaded')}
                  onClick={() => update({ model: m.key })}>
              {m.label}
            </Chip>
          ))}
        </div>
      </Field>

      {tagging.detectors.length > 0 && (
        <Field label={t('Add-ons')}>
          <div className="flex flex-col gap-3">
            {tagging.detectors.map(m => (
              <Toggle key={m.key} on={extras.includes(m.key)} disabled={!m.ready}
                      onClick={() => toggleExtra(m.key)}
                      label={m.label}
                      hint={m.ready ? t(m.desc) : t('Download it above to use it.')} />
            ))}
          </div>
        </Field>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[16px] font-semibold text-white/60">{t('Confidence threshold')}</div>
          <div className="text-[16px] font-mono" style={{ color: 'var(--c-accent-text)' }}>{Math.round(prefs.threshold * 100)}%</div>
        </div>
        <input type="range" min="10" max="90" step="5" value={Math.round(prefs.threshold * 100)}
               onChange={e => update({ threshold: Number(e.target.value) / 100 })}
               className="w-full accent-[var(--c-accent)] cursor-pointer" />
        <div className="flex justify-between text-[16px] text-white/35 mt-0.5">
          <span>{t('More tags')}</span><span>{t('Fewer, precise')}</span>
        </div>
      </div>

      <Toggle on={tagging.gpuOn} onClick={tagging.toggleGpu} disabled={tagging.gpuBusy}
              label={t('GPU acceleration (NVIDIA CUDA)')}
              hint={tagging.gpuOn ? t('ON — using CUDA if available, CPU fallback otherwise') : t('OFF — running on CPU only')} />
      <Toggle on={prefs.retag} onClick={() => update({ retag: !prefs.retag })}
              label={t('Re-tag already tagged files')}
              hint={t('Off = skip files that already have AI tags')} />

      {tagging.queued ? (
        <div className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] w-fit"
             style={{ background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', color: 'rgba(255,255,255,0.55)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 20%, transparent)' }}>
          <Clock size={15} style={{ color: 'var(--c-accent)' }} /> {t('Queued in task queue…')}
        </div>
      ) : (
        <button disabled={tagging.starting || !tagging.anyTaggerReady} onClick={tagging.start}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer w-fit disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 22%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
          <Cpu size={16} /> {tagging.starting ? t('Starting…') : t('Start AI Tagging')}
        </button>
      )}
    </div>
  )
}
