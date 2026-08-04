/**
 * <HotkeySettings /> — the Settings → Hotkeys panel.
 *
 * Renders straight from HOTKEY_ACTIONS, so adding an action to the registry
 * makes a row appear here with no changes in this file.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { Keyboard, RotateCcw, X, AlertTriangle } from 'lucide-react'
import { useVaultStore } from '../../store/vault'
import { HOTKEY_ACTIONS, eventToBinding, bindingToDisplay } from '../../lib/hotkeys'
import { useT } from '../../i18n'

export default function HotkeySettings() {
  const hotkeys      = useVaultStore(s => s.hotkeys)
  const setHotkey    = useVaultStore(s => s.setHotkey)
  const resetHotkeys = useVaultStore(s => s.resetHotkeys)
  const [capturing, setCapturing] = useState(null)   // actionId being rebound
  const t = useT()

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
    // Capture phase, so the global dispatcher never sees these keystrokes.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, setHotkey])

  // Bindings assigned to more than one action — flagged inline.
  const conflicts = useMemo(() => {
    const seen = {}
    const dupes = new Set()
    for (const a of HOTKEY_ACTIONS) {
      const b = hotkeys[a.id]
      if (!b) continue
      if (seen[b]) dupes.add(b)
      seen[b] = true
    }
    return dupes
  }, [hotkeys])

  const groups = useMemo(() => {
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

      {Object.entries(groups).map(([group, actions]) => (
        <div key={group} className="mb-5 last:mb-0">
          <div className="text-[15px] uppercase tracking-wider text-white/25 mb-2.5">{t(group)}</div>
          <div className="flex flex-col gap-2">
            {actions.map(action => {
              const binding    = hotkeys[action.id] || ''
              const isCapturing = capturing === action.id
              const conflicted = binding && conflicts.has(binding)
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
                      <span title={t('Another action uses this shortcut')}>
                        <AlertTriangle size={15} style={{ color: 'var(--c-amber, #BA7517)' }} />
                      </span>
                    )}
                    <button
                      onClick={() => setCapturing(isCapturing ? null : action.id)}
                      className="px-3 py-1.5 rounded-[7px] text-[16px] font-mono cursor-pointer transition-all min-w-[120px] text-center"
                      style={{
                        background: isCapturing ? 'rgba(127,119,221,0.22)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${isCapturing ? 'var(--c-accent)' : conflicted ? 'rgba(186,117,23,0.5)' : 'rgba(255,255,255,0.1)'}`,
                        color: isCapturing ? '#CECBF6' : binding ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
                      }}>
                      {isCapturing ? t('Press a key…') : bindingToDisplay(binding)}
                    </button>
                    {binding && !isCapturing && (
                      <button
                        onClick={() => setHotkey(action.id, '')}
                        title={t('Unbind')}
                        className="p-2 rounded-[7px] cursor-pointer transition-colors hover:text-[#D4537E]"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex items-start gap-2 mt-5 pt-4 text-[15px] text-white/30"
           style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
        <Keyboard size={15} className="flex-shrink-0 mt-0.5" />
        <span>
          {t('Shortcuts are ignored while you are typing — except Emergency stop, which always fires. Viewer keys (arrows, space, Esc) are not affected.')}
        </span>
      </div>
    </div>
  )
}
