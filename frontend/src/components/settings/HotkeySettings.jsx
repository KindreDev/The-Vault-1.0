/**
 * <HotkeySettings /> — the Settings → Hotkeys panel.
 *
 * Renders straight from HOTKEY_GROUPS + HOTKEY_ACTIONS, so adding an action to
 * the registry makes a row appear here with no changes in this file.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { Keyboard, RotateCcw, X, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useVaultStore } from '../../store/vault'
import {
  HOTKEY_ACTIONS, HOTKEY_GROUPS, ARROW_PRESETS, detectArrowPreset,
  eventToBinding, bindingToDisplay, SCOPE_VIEWER,
} from '../../lib/hotkeys'
import { useT } from '../../i18n'

export default function HotkeySettings() {
  const hotkeys         = useVaultStore(s => s.hotkeys)
  const setHotkey       = useVaultStore(s => s.setHotkey)
  const setHotkeys      = useVaultStore(s => s.setHotkeys)
  const resetHotkeys    = useVaultStore(s => s.resetHotkeys)
  const hotkeySettings  = useVaultStore(s => s.hotkeySettings)
  const setHotkeySetting = useVaultStore(s => s.setHotkeySetting)
  const [capturing, setCapturing] = useState(null)   // actionId being rebound
  // Collapsible groups start folded — the ten rating rows would otherwise be
  // most of the panel.
  const [openGroups, setOpenGroups] = useState({})
  const t = useT()

  const arrowPreset = detectArrowPreset(hotkeys)

  // While capturing, the next real keypress becomes the binding.
  //   Escape    — cancel
  //   Backspace — unbind
  useEffect(() => {
    if (!capturing) return
    function onKey(e) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape')    { setCapturing(null); return }
      if (e.key === 'Backspace') { setHotkey(capturing, ''); setCapturing(null); return }
      const binding = eventToBinding(e)
      if (!binding) return   // still holding only modifiers
      setHotkey(capturing, binding)
      setCapturing(null)
    }
    // Capture phase, so neither dispatcher ever sees these keystrokes.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, setHotkey])

  // Bindings assigned to more than one action — flagged inline. Scoped, because
  // a viewer binding and a global one sharing a key is not a conflict: the
  // viewer dispatcher runs first and claims it only while a viewer is open.
  const conflicts = useMemo(() => {
    const seen = {}
    const dupes = new Set()
    for (const a of HOTKEY_ACTIONS) {
      const b = hotkeys[a.id]
      if (!b) continue
      const key = `${a.scope}:${b}`
      if (seen[key]) dupes.add(key)
      seen[key] = true
    }
    return dupes
  }, [hotkeys])

  const actionsByGroup = useMemo(() => {
    const out = {}
    for (const a of HOTKEY_ACTIONS) (out[a.group] ||= []).push(a)
    return out
  }, [])

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="text-[16px] text-white/35">
          {t('Click a shortcut to rebind it. Esc cancels, Backspace unbinds.')}
        </div>
        <button
          onClick={resetHotkeys}
          className="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[16px] cursor-pointer flex-shrink-0 transition-colors hover:bg-white/10"
          style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
          <RotateCcw size={14} /> {t('Reset defaults')}
        </button>
      </div>

      {/* Arrow-key preset — the one question most people actually want answered,
          answered in one click instead of four rebinds. */}
      <div className="mb-5 p-4 rounded-[10px]"
           style={{ background: 'color-mix(in srgb, var(--c-accent) 7%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 22%, transparent)' }}>
        <div className="text-[16px] text-white/75 mb-1">{t('What should the arrow keys do in a video?')}</div>
        <div className="text-[15px] text-white/35 mb-3">
          {t('Whichever pair loses the bare arrows picks up Shift + arrows, so nothing becomes unreachable.')}
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ARROW_PRESETS).map(([id, preset]) => {
            const active = arrowPreset === id
            return (
              <button key={id}
                      onClick={() => setHotkeys(preset.bindings)}
                      className="px-3.5 py-2.5 rounded-[8px] text-left cursor-pointer transition-all"
                      style={{
                        background: active ? 'color-mix(in srgb, var(--c-accent) 22%, transparent)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${active ? 'var(--c-accent, var(--c-accent))' : 'rgba(255,255,255,0.1)'}`,
                        color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.7)',
                      }}>
                <div className="text-[16px]">{t(preset.label)}</div>
                <div className="text-[14px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{t(preset.hint)}</div>
              </button>
            )
          })}
        </div>
        {arrowPreset === null && (
          <div className="text-[15px] text-white/30 mt-2.5">
            {t('Custom — you have rebound one of the four by hand.')}
          </div>
        )}

        {/* How far a seek key moves. */}
        <div className="flex flex-wrap items-center gap-5 mt-4 pt-3.5"
             style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <StepField label={t('Seek step')}
                     value={hotkeySettings.seekStep}
                     onChange={v => setHotkeySetting('seekStep', v)} />
          <StepField label={t('Long seek step')}
                     value={hotkeySettings.seekStepBig}
                     onChange={v => setHotkeySetting('seekStepBig', v)} />
        </div>
      </div>

      {HOTKEY_GROUPS.map(group => {
        const actions = actionsByGroup[group.name] ?? []
        if (!actions.length) return null
        const collapsed = group.collapsible && !openGroups[group.name]

        return (
          <div key={group.name} className="mb-5 last:mb-0">
            <div className="flex items-baseline gap-2 mb-1">
              <div
                onClick={group.collapsible ? () => setOpenGroups(o => ({ ...o, [group.name]: !o[group.name] })) : undefined}
                className={`flex items-center gap-1.5 text-[15px] uppercase tracking-wider text-white/25 ${group.collapsible ? 'cursor-pointer hover:text-white/45' : ''}`}>
                {group.collapsible && (collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />)}
                {t(group.name)}
              </div>
              <span className="text-[14px]"
                    style={{ color: group.scope === SCOPE_VIEWER ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.18)' }}>
                {group.scope === SCOPE_VIEWER ? t('viewers only') : t('anywhere')}
              </span>
            </div>
            <div className="text-[15px] text-white/25 mb-2.5">{t(group.blurb)}</div>

            {collapsed ? (
              <div
                onClick={() => setOpenGroups(o => ({ ...o, [group.name]: true }))}
                className="px-4 py-3 rounded-[8px] text-[16px] text-white/40 cursor-pointer transition-colors hover:bg-white/5"
                style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                {summarise(actions, hotkeys)}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {actions.map(action => {
                  const binding     = hotkeys[action.id] || ''
                  const isCapturing = capturing === action.id
                  const conflicted  = binding && conflicts.has(`${action.scope}:${binding}`)
                  return (
                    <div key={action.id}
                         className="flex items-center justify-between gap-4 px-4 py-3 rounded-[8px]"
                         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                      <div className="min-w-0">
                        <div className="text-[16px] text-white/75">{t(action.label)}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t(action.hint)}</div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {conflicted && (
                          <span title={t('Another action in this scope uses this shortcut')}>
                            <AlertTriangle size={15} style={{ color: 'var(--c-amber, var(--c-amber))' }} />
                          </span>
                        )}
                        <button
                          onClick={() => setCapturing(isCapturing ? null : action.id)}
                          className="px-3 py-1.5 rounded-[7px] text-[16px] font-mono cursor-pointer transition-all min-w-[120px] text-center"
                          style={{
                            background: isCapturing ? 'color-mix(in srgb, var(--c-accent) 22%, transparent)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${isCapturing ? 'var(--c-accent)' : conflicted ? 'color-mix(in srgb, var(--c-amber) 50%, transparent)' : 'rgba(255,255,255,0.1)'}`,
                            color: isCapturing ? 'var(--c-accent-text)' : binding ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
                          }}>
                          {isCapturing ? t('Press a key…') : bindingToDisplay(binding)}
                        </button>
                        {binding && !isCapturing && (
                          <button
                            onClick={() => setHotkey(action.id, '')}
                            title={t('Unbind')}
                            className="p-2 rounded-[7px] cursor-pointer transition-colors hover:text-[var(--c-pink)]"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex items-start gap-2 mt-5 pt-4 text-[15px] text-white/30"
           style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
        <Keyboard size={15} className="flex-shrink-0 mt-0.5" />
        <span>
          {t('Shortcuts are ignored while you are typing — except Emergency stop, which always fires. Viewer shortcuts only work while a viewer or the panel wall is open, and they take priority over anywhere-shortcuts on the same key. On the panel wall, click a panel to pin it — the pinned panel is what viewer keys act on.')}
        </span>
      </div>
    </div>
  )
}

// Folded-group summary: "1 … 0 → ★1–★10 · ` clears" without listing ten rows.
function summarise(actions, hotkeys) {
  const shown = actions
    .map(a => hotkeys[a.id])
    .filter(Boolean)
    .map(bindingToDisplay)
  if (!shown.length) return 'All unbound — click to set them'
  return `${shown.join('  ')}   ·   click to change`
}

function StepField({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2.5">
      <span className="text-[16px] text-white/50">{label}</span>
      <input
        type="number" min={1} max={300} value={value}
        onChange={e => {
          const n = parseInt(e.target.value, 10)
          if (!isNaN(n)) onChange(Math.max(1, Math.min(300, n)))
        }}
        className="w-[70px] px-2.5 py-1.5 rounded-[7px] text-[16px] text-center"
        style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
      />
      <span className="text-[16px] text-white/30">s</span>
    </label>
  )
}
