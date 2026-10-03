import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LocalizedText, useT } from '../../i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BrainCircuit, Check, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'

const THEME_SOURCES = [
  ['periods', 'Periods'], ['characters', 'Characters and franchises'], ['cosplay', 'Creator x character cosplay'],
  ['exposure', 'Exposure classifications'], ['sexual-content', 'Sex acts and positions'],
  ['clothing', 'Clothing and body-focused tags'], ['medium', 'Medium and style'],
  ['creator-spotlights', 'Creator spotlights'], ['collaborations', 'Collaboration metadata'],
]

export default function AdvancedSettings({
  settings, onClose, onToggleAdvanced, refreshTask, refreshActive, refreshPending, onRestore,
  wipePending, onWipe,
}) {
  const t = useT()
  const qc = useQueryClient()
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false)
  const [wipePhrase, setWipePhrase] = useState('')
  const save = useMutation({
    mutationFn: data => tcgV2Api.updateSettings(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); toast.success(t('Advanced settings saved')) },
    onError: e => toast.error(e.response?.data?.detail || t('Could not save settings')),
  })
  const enabled = settings.enabled_theme_sources?.length ? settings.enabled_theme_sources : THEME_SOURCES.map(([id]) => id)
  const toggleTheme = id => save.mutate({ enabled_theme_sources: enabled.includes(id) ? enabled.filter(value => value !== id) : [...enabled, id] })

  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const taskLabel = refreshTask?.status === 'running'
    ? t('Task Q is rebuilding the catalogue')
    : refreshTask?.status === 'queued'
      ? t('Catalogue refresh is queued in Task Q')
      : refreshTask?.message || t('No catalogue restore is currently queued')

  return createPortal(
    <div className="tcgws-settings-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="tcgws-settings-panel" role="dialog" aria-modal="true" aria-labelledby="tcgws-advanced-title">
        <header>
          <div><span><LocalizedText text={"Developer and manual controls"} /></span><h2 id="tcgws-advanced-title"><LocalizedText text={"Advanced settings"} /></h2></div>
          <button type="button" onClick={onClose}><LocalizedText text={"Done"} /></button>
        </header>

        <div className="tcgws-settings-body">
        <section className="tcgws-advanced-toggle">
          <SlidersHorizontal size={20} />
          <div><h3>{t('Advanced Mode')}</h3><p>{t('Turn advanced collection controls on or off. This panel stays available either way.')}</p></div>
          <button type="button" role="switch" aria-checked={Boolean(settings.advanced_mode)} aria-label={t('Advanced Mode')} className={`tcgws-mode-switch ${settings.advanced_mode ? 'active' : ''}`} onClick={() => onToggleAdvanced(!settings.advanced_mode)}><i /></button>
        </section>

        <section>
          <SlidersHorizontal size={20} />
          <div><h3><LocalizedText text={"Release generation"} /></h3><p><LocalizedText text={"Automatic and Manual Review use the same validation pipeline."} /></p>
            <select value={settings.release_generation_mode} onChange={e => save.mutate({ release_generation_mode: e.target.value })}><option value="automatic"><LocalizedText text={"Automatic"} /></option><option value="manual_review"><LocalizedText text={"Manual review"} /></option></select>
          </div>
        </section>

        <section>
          <BrainCircuit size={20} />
          <div><h3><LocalizedText text={"AI classification threshold"} /></h3><p><LocalizedText text={"AI exposure and sexual-intensity results below this confidence resolve to Unknown."} /></p>
            <input type="range" min="0" max="1" step="0.01" value={settings.ai_confidence_threshold} onChange={e => save.mutate({ ai_confidence_threshold: Number(e.target.value) })} /><strong>{Math.round(settings.ai_confidence_threshold * 100)}%</strong>
          </div>
        </section>

        <section className="tcgws-theme-sources">
          <div><h3><LocalizedText text={"Theme sources"} /></h3><p><LocalizedText text={"Control which real metadata categories can propose future release themes."} /></p></div>
          {THEME_SOURCES.map(([id, label]) => <button type="button" className={enabled.includes(id) ? 'active' : ''} key={id} onClick={() => toggleTheme(id)}><span>{t(label)}</span>{enabled.includes(id) && <Check size={16} />}</button>)}
        </section>

        <section className="tcgws-maintenance-section">
          <RefreshCw size={20} />
          <div>
            <h3>{t('Restore card catalogue')}</h3>
            <p>{t('Rebuilds the catalogue from currently available library sources. Existing cards, ownership, numbering, and history stay preserved.')}</p>
            <p className="tcgws-maintenance-status" role="status">{taskLabel}{refreshTask?.status === 'running' && refreshTask.total > 0 ? ` · ${refreshTask.progress.toLocaleString()} / ${refreshTask.total.toLocaleString()}` : ''}</p>
            {!restoreConfirmOpen
              ? <button type="button" className="tcgws-maintenance-button" disabled={refreshPending || refreshActive} onClick={() => setRestoreConfirmOpen(true)}><RefreshCw size={17} />{t(refreshActive ? 'Refresh in Task Q' : 'Restore catalogue')}</button>
              : <div className="tcgws-maintenance-confirm"><p>{t('Queue a new catalogue snapshot from the library as it exists now? The current snapshot remains active until the new one is validated.')}</p><div><button type="button" className="tcgws-secondary" onClick={() => setRestoreConfirmOpen(false)}>{t('Cancel')}</button><button type="button" className="tcgws-maintenance-button" disabled={refreshPending || refreshActive} onClick={() => { onRestore(); setRestoreConfirmOpen(false) }}>{t('Confirm restore')}</button></div></div>}
          </div>
        </section>

        <section className="tcgws-maintenance-section tcgws-wipe-section">
          <AlertTriangle size={20} />
          <div>
            <h3>{t('Wipe owned cards')}</h3>
            <p>{t('Removes all currently owned cards and clears their binder and room display assignments. Catalogue, releases, binders, furniture, room layout, receipts, trade history, Vault Credits, and XP are kept.')}</p>
            {!wipeConfirmOpen
              ? <button type="button" className="tcgws-wipe-button" onClick={() => setWipeConfirmOpen(true)}><Trash2 size={17} />{t('Wipe owned cards')}</button>
              : <div className="tcgws-maintenance-confirm">
                <p>{t('This permanently removes current owned copies. Historical traded-away copies and all purchase and transaction history remain. Type WIPE OWNED CARDS to continue.')}</p>
                <label>{t('Confirmation phrase')}<input autoComplete="off" value={wipePhrase} onChange={event => setWipePhrase(event.target.value)} /></label>
                <div><button type="button" className="tcgws-secondary" disabled={wipePending} onClick={() => { setWipeConfirmOpen(false); setWipePhrase('') }}>{t('Cancel')}</button><button type="button" className="tcgws-wipe-button" disabled={wipePending || wipePhrase !== 'WIPE OWNED CARDS'} onClick={() => { onWipe(wipePhrase); setWipeConfirmOpen(false); setWipePhrase('') }}><Trash2 size={17} />{t(wipePending ? 'Wiping owned cards' : 'Confirm wipe')}</button></div>
              </div>}
          </div>
        </section>
        </div>
      </aside>
    </div>, document.body,
  )
}
