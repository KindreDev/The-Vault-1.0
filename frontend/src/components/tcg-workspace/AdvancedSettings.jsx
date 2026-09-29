import { LocalizedText, useT } from '../../i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BrainCircuit, Check, SlidersHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'

const THEME_SOURCES = [
  ['periods', 'Periods'], ['characters', 'Characters and franchises'], ['cosplay', 'Creator x character cosplay'],
  ['exposure', 'Exposure classifications'], ['sexual-content', 'Sex acts and positions'],
  ['clothing', 'Clothing and body-focused tags'], ['medium', 'Medium and style'],
  ['creator-spotlights', 'Creator spotlights'], ['collaborations', 'Collaboration metadata'],
]

export default function AdvancedSettings({ settings, onClose }) {
  const t = useT()
  const qc = useQueryClient()
  const save = useMutation({ mutationFn: data => tcgV2Api.updateSettings(data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); toast.success(t("Advanced settings saved")) }, onError: e => toast.error(e.response?.data?.detail || t("Could not save settings")) })
  const enabled = settings.enabled_theme_sources?.length ? settings.enabled_theme_sources : THEME_SOURCES.map(([id]) => id)
  const toggleTheme = id => save.mutate({ enabled_theme_sources: enabled.includes(id) ? enabled.filter(value => value !== id) : [...enabled, id] })
  return <div className="tcgws-settings-panel"><header><div><span><LocalizedText text={"Developer and manual controls"} /></span><h2><LocalizedText text={"Advanced Mode"} /></h2></div><button onClick={onClose}><LocalizedText text={"Done"} /></button></header><section><SlidersHorizontal size={20} /><div><h3><LocalizedText text={"Release generation"} /></h3><p><LocalizedText text={"Automatic and Manual Review use the same validation pipeline."} /></p><select value={settings.release_generation_mode} onChange={e => save.mutate({ release_generation_mode: e.target.value })}><option value="automatic"><LocalizedText text={"Automatic"} /></option><option value="manual_review"><LocalizedText text={"Manual review"} /></option></select></div></section><section><BrainCircuit size={20} /><div><h3><LocalizedText text={"AI classification threshold"} /></h3><p><LocalizedText text={"AI exposure and sexual-intensity results below this confidence resolve to Unknown."} /></p><input type="range" min="0" max="1" step="0.01" value={settings.ai_confidence_threshold} onChange={e => save.mutate({ ai_confidence_threshold: Number(e.target.value) })} /><strong>{Math.round(settings.ai_confidence_threshold * 100)}%</strong></div></section><section className="tcgws-theme-sources"><div><h3><LocalizedText text={"Theme sources"} /></h3><p><LocalizedText text={"Control which real metadata categories can propose future release themes."} /></p></div>{THEME_SOURCES.map(([id, label]) => <button className={enabled.includes(id) ? 'active' : ''} key={id} onClick={() => toggleTheme(id)}><span>{label}</span>{enabled.includes(id) && <Check size={16} />}</button>)}</section></div>
}
