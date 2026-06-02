/**
 * <DeviceControls />
 *
 * Compact device control panel designed to be embedded in:
 *   - Image viewer right panel
 *   - Video viewer right panel
 *   - Multi-Panel bottom bar
 *
 * Shows nothing when no device is connected.
 * Contains: pattern picker · intensity · glans · stroke limiter · 💦 Cum · ⏹ Stop
 */
import React, { useState, useRef, useEffect } from 'react'
import { Square, Droplets, ChevronDown } from 'lucide-react'
import { useDeviceStore, PRESETS } from '../store/deviceStore'
import { deviceService } from '../services/device'

// ── Dual-range slider CSS (shared with DeviceControl page) ───────────────────
const DUAL_RANGE_CSS = `
  .dvr-input {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .dvr-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    pointer-events: all;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--c-accent);
    cursor: grab;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  .dvr-input::-webkit-slider-thumb:active { cursor: grabbing; }
  .dvr-input::-webkit-slider-runnable-track { background: transparent; }
  .dvr-input::-moz-range-thumb {
    pointer-events: all;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--c-accent);
    cursor: grab;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  .dvr-input::-moz-range-track { background: transparent; height: 0; }
`

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOptions(savedPatterns) {
  const builtins = PRESETS.map(p => ({ value: p.id, label: p.name }))
  const saved    = (savedPatterns || []).map(p => ({ value: `saved_${p.name}`, label: p.name }))
  return [...builtins, ...saved]
}

// Compact pattern dropdown — flips direction based on available viewport space
function CompactPatternSelect({ value, onChange, options }) {
  const [open, setOpen]       = useState(false)
  const [dropUp, setDropUp]   = useState(false)
  const [maxH, setMaxH]       = useState(240)
  const btnRef                = useRef(null)
  const wrapRef               = useRef(null)
  const selected              = options.find(o => o.value === value)

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function handleOpen() {
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const rect     = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      if (spaceBelow >= 160) {
        // enough room below — drop down
        setDropUp(false)
        setMaxH(Math.min(spaceBelow, 260))
      } else {
        // not enough below — drop up
        setDropUp(true)
        setMaxH(Math.min(spaceAbove, 260))
      }
    }
    setOpen(true)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[rgba(255,255,255,0.8)] hover:text-white transition-colors"
        style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        {selected?.label ?? '—'}
        <ChevronDown size={10} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                     style={{ color: 'rgba(255,255,255,0.4)' }} />
      </button>

      {open && (
        <div
          className="absolute left-0 bg-[#1c1c1c] border border-[rgba(255,255,255,0.12)] rounded-lg overflow-y-auto z-[200] shadow-2xl"
          style={{
            minWidth: 140,
            maxHeight: maxH,
            ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
          }}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                opt.value === value
                  ? 'bg-[rgba(127,119,221,0.2)] text-[var(--c-accent)]'
                  : 'text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.06)]'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Compact dual-range stroke limiter
function StrokeLimiter({ floor, ceiling, onFloorChange, onCeilChange }) {
  return (
    <div className="w-full">
      <style>{DUAL_RANGE_CSS}</style>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-[rgba(255,255,255,0.4)]">Stroke range</span>
        <span className="text-[10px] font-mono text-[rgba(255,255,255,0.55)]">{floor}% – {ceiling}%</span>
      </div>
      <div className="relative h-5 flex items-center">
        {/* Background track */}
        <div className="absolute left-0 right-0 h-1 rounded-full bg-[rgba(255,255,255,0.08)]" />
        {/* Active fill */}
        <div
          className="absolute h-1 rounded-full pointer-events-none"
          style={{ left: `${floor}%`, right: `${100 - ceiling}%`, background: 'var(--c-accent)' }}
        />
        {/* Floor handle */}
        <input
          type="range" min={0} max={100} step={1} value={floor}
          onChange={e => onFloorChange(Math.min(Number(e.target.value), ceiling - 5))}
          className="dvr-input"
          style={{ zIndex: floor >= ceiling - 5 ? 5 : 3 }}
        />
        {/* Ceiling handle */}
        <input
          type="range" min={0} max={100} step={1} value={ceiling}
          onChange={e => onCeilChange(Math.max(Number(e.target.value), floor + 5))}
          className="dvr-input"
          style={{ zIndex: floor >= ceiling - 5 ? 3 : 5 }}
        />
      </div>
    </div>
  )
}

// ── DeviceControls ────────────────────────────────────────────────────────────

export default function DeviceControls({ className = '' }) {
  const status        = useDeviceStore(s => s.status)
  const mode          = useDeviceStore(s => s.mode)
  const activeId      = useDeviceStore(s => s.activePresetId)
  const intensity     = useDeviceStore(s => s.intensity)
  const glansShift    = useDeviceStore(s => s.glansShift)
  const floor         = useDeviceStore(s => s.strokeFloor)
  const ceiling       = useDeviceStore(s => s.strokeCeiling)
  const savedPatterns = useDeviceStore(s => s.savedPatterns)
  const setPreset     = useDeviceStore(s => s.setActivePreset)
  const setCustom     = useDeviceStore(s => s.setCustomPattern)
  const setIntensity  = useDeviceStore(s => s.setIntensity)
  const setGlansShift = useDeviceStore(s => s.setGlansShift)
  const setFloor      = useDeviceStore(s => s.setStrokeFloor)
  const setCeiling    = useDeviceStore(s => s.setStrokeCeiling)

  if (status !== 'connected') return null

  const options     = buildOptions(savedPatterns)
  const isFreestyle = mode === 'freestyle'

  const handlePresetChange = (val) => {
    if (val.startsWith('saved_')) {
      const name = val.slice(6)
      const sp   = savedPatterns.find(p => p.name === name)
      if (sp) setCustom({ strokeMin: sp.strokeMin, strokeMax: sp.strokeMax, spm: sp.spm, waveform: sp.waveform })
    }
    setPreset(val)
  }

  return (
    <div
      className={`flex flex-col gap-2.5 px-3 py-2.5 rounded-lg ${className}`}
      style={{ background: 'rgba(0,0,0,0.45)', border: '0.5px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}>

      {/* Row 1: pattern + action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <CompactPatternSelect value={activeId} onChange={handlePresetChange} options={options} />

        {isFreestyle && (
          <button
            onClick={() => deviceService.triggerCumPattern(30)}
            title="Cum pattern for 30s"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold cursor-pointer transition-all"
            style={{ background: 'rgba(212,83,126,0.2)', color: '#F4A8C0', border: '0.5px solid rgba(212,83,126,0.35)' }}>
            <Droplets size={11} />
            Cum
          </button>
        )}

        <button
          onClick={() => deviceService.stop()}
          title="Emergency stop"
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold cursor-pointer transition-all"
          style={{ background: 'rgba(212,83,126,0.1)', color: 'rgba(212,83,126,0.7)', border: '0.5px solid rgba(212,83,126,0.2)' }}>
          <Square size={10} />
          Stop
        </button>
      </div>

      {/* Row 2: intensity */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[rgba(255,255,255,0.4)] w-10 flex-shrink-0">Speed</span>
        <input
          type="range" min={10} max={500} step={5}
          value={Math.round(intensity * 100)}
          onChange={e => setIntensity(Number(e.target.value) / 100)}
          className="flex-1 h-1 cursor-pointer accent-[var(--c-accent)]"
        />
        <span className="text-[10px] font-mono text-[rgba(255,255,255,0.5)] w-8 text-right">
          {Math.round(intensity * 100)}%
        </span>
      </div>

      {/* Row 3: glans */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[rgba(255,255,255,0.4)] w-10 flex-shrink-0">Glans</span>
        <input
          type="range" min={0} max={100} step={5}
          value={Math.round(glansShift * 100)}
          onChange={e => setGlansShift(Number(e.target.value) / 100)}
          className="flex-1 h-1 cursor-pointer accent-[var(--c-accent)]"
        />
        <span className="text-[10px] font-mono text-[rgba(255,255,255,0.5)] w-8 text-right">
          {Math.round(glansShift * 100)}%
        </span>
      </div>

      {/* Row 4: stroke range limiter */}
      <StrokeLimiter
        floor={floor}
        ceiling={ceiling}
        onFloorChange={setFloor}
        onCeilChange={setCeiling}
      />
    </div>
  )
}
