import React, { useState, useRef, useEffect } from 'react'
import {
  Wifi, WifiOff, RefreshCw, Activity, Square,
  Plus, Trash2, ChevronUp, ChevronDown, Save,
  Usb, Radio, Play,
} from 'lucide-react'
import { useDeviceStore, PRESETS } from '../store/deviceStore'
import { useVaultStore } from '../store/vault'
import { bindingToDisplay } from '../lib/hotkeys'
import { deviceService } from '../services/device'
import toast from 'react-hot-toast'

// ── Dual-range slider CSS (injected once per component mount) ─────────────────
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
    width: 18px; height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--c-accent);
    cursor: grab;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    transition: transform 0.1s;
  }
  .dvr-input::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.15); }
  .dvr-input::-webkit-slider-runnable-track { background: transparent; }
  .dvr-input::-moz-range-thumb {
    pointer-events: all;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--c-accent);
    cursor: grab;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  .dvr-input::-moz-range-track { background: transparent; height: 0; }
`

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build options array for PatternSelect.
 * Built-in presets come first; saved patterns (with 'saved_' prefix) follow.
 */
function buildPatternOptions(savedPatterns, { excludeCum = false } = {}) {
  const builtins = PRESETS
    .filter(p => !excludeCum || p.id !== 'cum')
    .map(p => ({ value: p.id, label: p.name }))
  const saved = (savedPatterns || []).map(p => ({
    value: `saved_${p.name}`,
    label: p.name,
  }))
  return [...builtins, ...saved]
}

/** Resolve a presetId (including 'saved_*') to a display name. */
function getPresetLabel(presetId, savedPatterns) {
  const b = PRESETS.find(p => p.id === presetId)
  if (b) return b.name
  if (presetId?.startsWith('saved_')) {
    const name = presetId.slice(6)
    return (savedPatterns || []).find(p => p.name === name)?.name ?? name
  }
  return presetId || '—'
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Card({ title, children, className = '' }) {
  return (
    <div className={`vault-card p-5 ${className}`}>
      {title && (
        <div className="text-[13px] font-semibold text-[rgba(255,255,255,0.5)] mb-4 uppercase tracking-wider">
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '', hint }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{label}</span>
        <span className="text-[12px] font-mono text-[rgba(255,255,255,0.85)]">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[var(--c-accent)] cursor-pointer" />
      {hint && <div className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">{hint}</div>}
    </div>
  )
}

function Toggle({ label, checked, onChange, desc }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-[var(--c-accent)]' : 'bg-[rgba(255,255,255,0.1)]'
        }`}
        onClick={() => onChange(!checked)}>
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <div>
        <div className="text-[13px] text-[rgba(255,255,255,0.85)] font-medium">{label}</div>
        {desc && <div className="text-[11px] text-[rgba(255,255,255,0.35)]">{desc}</div>}
      </div>
    </label>
  )
}

// ── Custom pattern dropdown ───────────────────────────────────────────────────

function PatternSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = options.find(o => o.value === value)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const builtins = options.filter(o => !o.value.startsWith('saved_'))
  const saved    = options.filter(o =>  o.value.startsWith('saved_'))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[12px] text-[rgba(255,255,255,0.85)] hover:border-[rgba(255,255,255,0.2)] transition-all">
        <span>{selected?.label ?? '—'}</span>
        <ChevronDown
          size={13}
          className={`text-[rgba(255,255,255,0.4)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1c1c1c] border border-[rgba(255,255,255,0.12)] rounded-lg overflow-hidden z-50 shadow-2xl animate-fade-in">
          {builtins.map(opt => (
            <button key={opt.value} type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                opt.value === value
                  ? 'bg-[color-mix(in_srgb,_var(--c-accent)_20%,_transparent)] text-[var(--c-accent)]'
                  : 'text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.06)]'
              }`}>
              {opt.label}
            </button>
          ))}
          {saved.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-wider border-t border-[rgba(255,255,255,0.06)]">
                Saved
              </div>
              {saved.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                    opt.value === value
                      ? 'bg-[color-mix(in_srgb,_var(--c-accent)_20%,_transparent)] text-[var(--c-accent)]'
                      : 'text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.06)]'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Dual-handle range slider ──────────────────────────────────────────────────

function DualRangeSlider({ floor, ceiling, onFloorChange, onCeilChange }) {
  return (
    <div>
      <style>{DUAL_RANGE_CSS}</style>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[12px] text-[rgba(255,255,255,0.6)]">Stroke Range</span>
        <span className="text-[12px] font-mono text-[rgba(255,255,255,0.85)]">
          {floor}% – {ceiling}%
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        {/* Background track */}
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-[rgba(255,255,255,0.08)]" />
        {/* Active fill between handles */}
        <div
          className="absolute h-1.5 rounded-full pointer-events-none"
          style={{
            left:  `${floor}%`,
            right: `${100 - ceiling}%`,
            background: 'var(--c-accent)',
          }}
        />
        {/* Floor handle — boost z-index when it's all the way to the right */}
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
      <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.25)] mt-1.5">
        <span>Low bound</span>
        <span>High bound</span>
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  disconnected: 'rgba(255,255,255,0.25)',
  connecting:   '#BA7517',
  connected:    '#1D9E75',
  error:        '#D4537E',
}
const STATUS_LABELS = {
  disconnected: 'Disconnected',
  connecting:   'Connecting…',
  connected:    'Connected',
  error:        'Error',
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status]
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2 h-2 rounded-full"
        style={{ background: color, boxShadow: status === 'connected' ? `0 0 6px ${color}` : 'none' }}
      />
      <span className="text-[12px]" style={{ color }}>{STATUS_LABELS[status]}</span>
    </div>
  )
}

// ── Preset card ───────────────────────────────────────────────────────────────

function PresetCard({ id, name, desc, strokeMin, strokeMax, spm, active, onClick, onDelete }) {
  return (
    <div
      className={`relative p-3 rounded-lg border text-left transition-all cursor-pointer ${
        active
          ? 'border-[var(--c-accent)] bg-[color-mix(in_srgb,_var(--c-accent)_12%,_transparent)]'
          : 'border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]'
      }`}
      onClick={onClick}>
      <div
        className="text-[13px] font-semibold pr-5"
        style={{ color: active ? 'var(--c-accent)' : 'rgba(255,255,255,0.85)' }}>
        {name}
      </div>
      {desc && <div className="text-[10px] text-[rgba(255,255,255,0.4)] mt-0.5">{desc}</div>}
      <div className="mt-2 text-[10px] font-mono text-[rgba(255,255,255,0.3)] space-y-0.5">
        <div>{strokeMin}%–{strokeMax}%</div>
        <div>{spm} spm</div>
      </div>
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="absolute top-2 right-2 p-1 text-[color-mix(in_srgb,_var(--c-pink)_50%,_transparent)] hover:text-[var(--c-pink)] transition-colors">
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

// ── Shared: device list display ───────────────────────────────────────────────

function DeviceList({ devices, scanning }) {
  if (devices.length > 0) return (
    <div className="space-y-1">
      <div className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1">Devices ({devices.length})</div>
      {devices.map(d => (
        <div key={d.index} className="text-[12px] text-[rgba(255,255,255,0.7)] bg-[rgba(255,255,255,0.04)] rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-[var(--c-green)] flex-shrink-0" />
            <span className="flex-1">{d.name}</span>
            <span className={`text-[10px] font-medium ${d.canLinear ? 'text-[var(--c-green)]' : (d.canVibrate || d.canRotate || d.canOscillate) ? 'text-[var(--c-accent)]' : 'text-[var(--c-pink)]'}`}>
              {d.canLinear ? 'Linear ✓' : d.canVibrate ? 'Vibrate' : d.canRotate ? 'Rotate ✓' : d.canOscillate ? 'Oscillate ✓' : 'Unknown type'}
            </span>
          </div>
          {d.outputTypes?.length > 0 && (
            <div className="text-[10px] text-[rgba(255,255,255,0.25)] mt-0.5 ml-5">
              {d.outputTypes.join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  )
  if (scanning) return (
    <div className="text-[12px] text-[rgba(255,255,255,0.35)]">
      Scanning for devices… Make sure your device is paired in Intiface Central.
    </div>
  )
  return null
}

// ── Shared: test stroke + disconnect buttons ──────────────────────────────────

function ConnectedActions({ onDisconnect }) {
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    try {
      await deviceService.testStroke()
      toast.success('Test stroke sent!')
    } catch (err) {
      toast.error(err.message || 'Test stroke failed', { duration: 6000 })
    }
    setTesting(false)
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={onDisconnect}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-[color-mix(in_srgb,_var(--c-pink)_15%,_transparent)] border border-[color-mix(in_srgb,_var(--c-pink)_30%,_transparent)] text-[var(--c-pink)] hover:bg-[color-mix(in_srgb,_var(--c-pink)_25%,_transparent)]">
        <WifiOff size={14} />
        Disconnect
      </button>
      <button
        onClick={handleTest}
        disabled={testing}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.6)] hover:text-white hover:border-[rgba(255,255,255,0.25)] transition-all">
        <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />
        Test Stroke
      </button>
    </div>
  )
}

// ── Intiface Central section ──────────────────────────────────────────────────

function IntifaceSection() {
  const status      = useDeviceStore(s => s.status)
  const provider    = useDeviceStore(s => s.provider)
  const wsUrl       = useDeviceStore(s => s.wsUrl)
  const errorMsg    = useDeviceStore(s => s.errorMsg)
  const devices     = useDeviceStore(s => s.devices)
  const setWsUrl    = useDeviceStore(s => s.setWsUrl)
  const isActive    = provider === 'intiface'
  const isConnected = isActive && status === 'connected'
  const isConnecting = isActive && status === 'connecting'

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 block">
          Intiface Central WebSocket URL
        </label>
        <input
          value={wsUrl}
          onChange={e => setWsUrl(e.target.value)}
          disabled={isConnected}
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-[rgba(255,255,255,0.85)] disabled:opacity-40"
          placeholder="ws://localhost:12345"
        />
        <div className="text-[10px] text-[rgba(255,255,255,0.25)] mt-1">
          In Intiface Central → Settings, enable{' '}
          <strong className="text-[rgba(255,255,255,0.4)]">WebSocket Server</strong> on port 12345.
        </div>
      </div>

      {!isConnected && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => deviceService.connect()}
            disabled={isConnecting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--c-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-all">
            <Wifi size={14} />
            {isConnecting ? 'Connecting…' : 'Connect'}
          </button>
          <StatusBadge status={isActive ? status : 'disconnected'} />
        </div>
      )}

      {isConnected && <ConnectedActions onDisconnect={() => deviceService.disconnect()} />}

      {isActive && errorMsg && (
        <div className="text-[12px] text-[var(--c-pink)] bg-[color-mix(in_srgb,_var(--c-pink)_8%,_transparent)] border border-[color-mix(in_srgb,_var(--c-pink)_20%,_transparent)] rounded-lg px-3 py-2 space-y-1">
          <div>{errorMsg}</div>
          <div className="text-[10px] text-[color-mix(in_srgb,_var(--c-pink)_60%,_transparent)]">
            Check that Intiface Central is running and WebSocket Server is enabled.
          </div>
        </div>
      )}

      {isConnected && <DeviceList devices={devices} scanning={devices.length === 0} />}
    </div>
  )
}

// ── The Handy section ─────────────────────────────────────────────────────────

function HandySection() {
  const status      = useDeviceStore(s => s.status)
  const provider    = useDeviceStore(s => s.provider)
  const errorMsg    = useDeviceStore(s => s.errorMsg)
  const devices     = useDeviceStore(s => s.devices)
  const handyKey    = useDeviceStore(s => s.handyKey)
  const setHandyKey = useDeviceStore(s => s.setHandyKey)
  const isActive    = provider === 'handy'
  const isConnected = isActive && status === 'connected'
  const isConnecting = isActive && status === 'connecting'
  const [showKey, setShowKey] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 block">
          Connection Key
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={handyKey}
            onChange={e => setHandyKey(e.target.value)}
            disabled={isConnected}
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 pr-20 text-[13px] text-[rgba(255,255,255,0.85)] disabled:opacity-40 font-mono"
            placeholder="XXXXXXXX"
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[rgba(255,255,255,0.35)] hover:text-white transition-colors">
            {showKey ? 'hide' : 'show'}
          </button>
        </div>
        <div className="text-[10px] text-[rgba(255,255,255,0.25)] mt-1">
          Find your key in The Handy app → Settings → Connection Key. Your device must be connected to The Handy app via Bluetooth or WiFi first.
        </div>
      </div>

      {!isConnected && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => deviceService.connectHandy()}
            disabled={isConnecting || !handyKey.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--c-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-all">
            <Wifi size={14} />
            {isConnecting ? 'Connecting…' : 'Connect'}
          </button>
          <StatusBadge status={isActive ? status : 'disconnected'} />
        </div>
      )}

      {isConnected && <ConnectedActions onDisconnect={() => deviceService.disconnectHandy()} />}

      {isActive && errorMsg && (
        <div className="text-[12px] text-[var(--c-pink)] bg-[color-mix(in_srgb,_var(--c-pink)_8%,_transparent)] border border-[color-mix(in_srgb,_var(--c-pink)_20%,_transparent)] rounded-lg px-3 py-2">
          {errorMsg}
        </div>
      )}

      {isConnected && <DeviceList devices={devices} scanning={false} />}

      <div className="p-3 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] space-y-1">
        <div className="text-[11px] text-[rgba(255,255,255,0.5)] font-medium">How it works</div>
        <div className="text-[10px] text-[rgba(255,255,255,0.3)] leading-relaxed">
          Uses The Handy REST API v3 (HSP streaming protocol, cloud relay) — no Intiface needed. Requires firmware 4+; this is a firmware requirement, not a hardware one, so an original Handy 1 works fine once updated via the Handy Connect app. Devices still on firmware 3 or earlier can't connect until updated.
        </div>
      </div>
    </div>
  )
}

// ── Direct serial section (FUNSR1 2.0) ────────────────────────────────────────

function SerialSection() {
  const status        = useDeviceStore(s => s.status)
  const provider      = useDeviceStore(s => s.provider)
  const errorMsg      = useDeviceStore(s => s.errorMsg)
  const devices       = useDeviceStore(s => s.devices)
  const serialPortInfo = useDeviceStore(s => s.serialPortInfo)
  const isActive      = provider === 'serial'
  const isConnected   = isActive && status === 'connected'
  const isConnecting  = isActive && status === 'connecting'
  const hasWebSerial  = typeof navigator !== 'undefined' && 'serial' in navigator

  return (
    <div className="space-y-4">
      {!hasWebSerial && (
        <div className="text-[12px] text-[var(--c-amber)] bg-[color-mix(in_srgb,_var(--c-amber)_8%,_transparent)] border border-[color-mix(in_srgb,_var(--c-amber)_25%,_transparent)] rounded-lg px-3 py-2">
          Web Serial API not available. Use Chrome or Edge (not Firefox).
        </div>
      )}

      <div className="text-[12px] text-[rgba(255,255,255,0.6)]">
        {isConnected
          ? <span>Connected to: <span className="font-mono text-[var(--c-green)]">{serialPortInfo}</span></span>
          : 'Connect your device via USB, then click Connect to select the port.'}
      </div>

      {!isConnected && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => deviceService.connectSerial()}
            disabled={isConnecting || !hasWebSerial}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--c-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-all">
            <Usb size={14} />
            {isConnecting ? 'Selecting port…' : 'Connect'}
          </button>
          <StatusBadge status={isActive ? status : 'disconnected'} />
        </div>
      )}

      {isConnected && <ConnectedActions onDisconnect={() => deviceService.disconnectSerial()} />}

      {isActive && errorMsg && (
        <div className="text-[12px] text-[var(--c-pink)] bg-[color-mix(in_srgb,_var(--c-pink)_8%,_transparent)] border border-[color-mix(in_srgb,_var(--c-pink)_20%,_transparent)] rounded-lg px-3 py-2">
          {errorMsg}
        </div>
      )}

      {isConnected && <DeviceList devices={devices} scanning={false} />}

      <div className="p-3 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] space-y-1">
        <div className="text-[11px] text-[rgba(255,255,255,0.5)] font-medium">Serial setup</div>
        <div className="text-[10px] text-[rgba(255,255,255,0.3)] leading-relaxed">
          Connect your device via USB. No drivers needed on Windows 10/11 — it appears as a COM port. Uses T-Code L0 protocol at 115200 baud. No Intiface required.
        </div>
      </div>
    </div>
  )
}

// ── Provider tabs + connection panel ─────────────────────────────────────────

const PROVIDER_TABS = [
  { id: 'intiface', label: 'Intiface', icon: Wifi  },
  { id: 'handy',   label: 'The Handy', icon: Radio },
  { id: 'serial',  label: 'Serial',    icon: Usb   },
]

function ConnectionSection() {
  const provider    = useDeviceStore(s => s.provider)
  const [tab, setTab] = useState('intiface')

  // When a connection is established, jump to that provider's tab
  useEffect(() => {
    if (provider) setTab(provider)
  }, [provider])

  return (
    <Card title="Connection">
      {/* Provider tabs */}
      <div className="flex gap-1 mb-5 p-1 bg-[rgba(255,255,255,0.04)] rounded-lg">
        {PROVIDER_TABS.map(({ id, label, icon: Icon }) => {
          const isActiveProvider = provider === id
          const isSelected = tab === id
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                isSelected
                  ? 'bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.9)]'
                  : 'text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]'
              }`}>
              <Icon size={12} />
              {label}
              {isActiveProvider && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--c-green)] flex-shrink-0" />
              )}
            </button>
          )
        })}
      </div>

      {tab === 'intiface' && <IntifaceSection />}
      {tab === 'handy'    && <HandySection />}
      {tab === 'serial'   && <SerialSection />}
    </Card>
  )
}

// ── Funscript auto-sync ───────────────────────────────────────────────────────

function AutoSyncSection() {
  const autoSync    = useDeviceStore(s => s.autoSyncFunscript)
  const setAutoSync = useDeviceStore(s => s.setAutoSyncFunscript)

  return (
    <Card title="Funscript Sync">
      <button
        type="button"
        onMouseDown={() => setAutoSync(!autoSync)}
        className="w-full flex items-center gap-3 cursor-pointer text-left"
      >
        <span
          className="relative flex-shrink-0 rounded-full transition-colors"
          style={{
            width: 34, height: 19,
            background: autoSync ? 'color-mix(in srgb, var(--c-accent) 55%, transparent)' : 'rgba(255,255,255,0.12)',
            border: `0.5px solid ${autoSync ? 'color-mix(in srgb, var(--c-accent) 80%, transparent)' : 'rgba(255,255,255,0.18)'}`,
          }}
        >
          <span
            className="absolute rounded-full transition-all"
            style={{
              width: 15, height: 15, top: 1.5, left: autoSync ? 17 : 1.5,
              background: autoSync ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.55)',
            }}
          />
        </span>
        <span className="flex-1">
          <span className="block text-[13px]" style={{ color: 'rgba(255,255,255,0.8)' }}>
            Auto-sync to funscripted videos
          </span>
          <span className="block text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
            {autoSync
              ? 'Videos with a script take over the device as soon as they open.'
              : 'Press Sync on the player each time you want the device to follow a script.'}
          </span>
        </span>
      </button>
    </Card>
  )
}

// ── Stroke range limiter ──────────────────────────────────────────────────────

function StrokeLimiterSection() {
  const floor    = useDeviceStore(s => s.strokeFloor)
  const ceiling  = useDeviceStore(s => s.strokeCeiling)
  const setFloor = useDeviceStore(s => s.setStrokeFloor)
  const setCeil  = useDeviceStore(s => s.setStrokeCeiling)

  return (
    <Card title="Stroke Range">
      <div className="space-y-3">
        <DualRangeSlider
          floor={floor} ceiling={ceiling}
          onFloorChange={setFloor} onCeilChange={setCeil}
        />
        <div className="text-[10px] text-[rgba(255,255,255,0.25)]">
          Limits how far the device physically travels in either direction. Applies globally to freestyle and funscript modes.
        </div>
      </div>
    </Card>
  )
}

// ── Freestyle + patterns section ──────────────────────────────────────────────

function FreestyleSection() {
  const mode          = useDeviceStore(s => s.mode)
  const activeId      = useDeviceStore(s => s.activePresetId)
  const customPattern = useDeviceStore(s => s.customPattern)
  const intensity     = useDeviceStore(s => s.intensity)
  const glansShift    = useDeviceStore(s => s.glansShift)
  const variance      = useDeviceStore(s => s.variance)
  const savedPatterns = useDeviceStore(s => s.savedPatterns)
  const setIntensity  = useDeviceStore(s => s.setIntensity)
  const setGlansShift = useDeviceStore(s => s.setGlansShift)
  const setVariance   = useDeviceStore(s => s.setVariance)
  const setCustom     = useDeviceStore(s => s.setCustomPattern)
  const setPreset     = useDeviceStore(s => s.setActivePreset)
  const savePattern   = useDeviceStore(s => s.savePattern)
  const deletePattern = useDeviceStore(s => s.deleteSavedPattern)

  const finisherPattern    = useDeviceStore(s => s.finisherPatternName)
  const finisherActive     = useDeviceStore(s => s.finisherActive)
  const setFinisherPattern = useDeviceStore(s => s.setFinisherPattern)
  // Binding is owned by the shared hotkey map; shown here read-only for context.
  const finisherHotkey     = useVaultStore(s => s.hotkeys.finisher)

  const [saveName, setSaveName] = useState('')
  const isFreestyle = mode === 'freestyle'

  // Display intensity as a multiplier (e.g. "1.5×") so the value is intuitive
  const intensityPct = Math.round(intensity * 100)

  const handleSave = () => {
    const name = saveName.trim()
    if (!name) { toast.error('Enter a name first'); return }
    savePattern(name, customPattern)
    toast.success(`Pattern "${name}" saved`)
    setSaveName('')
  }

  return (
    <div className="space-y-4">
      {/* Freestyle toggle */}
      <Card title="Freestyle Mode">
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Toggle
              label="Freestyle / Gooning Mode"
              desc="Device runs continuously while you browse"
              checked={isFreestyle}
              onChange={v => v ? deviceService.startFreestyle() : deviceService.stopFreestyle()}
            />
            {isFreestyle && (
              <button
                onClick={() => deviceService.stop()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[color-mix(in_srgb,_var(--c-pink)_15%,_transparent)] border border-[color-mix(in_srgb,_var(--c-pink)_30%,_transparent)] text-[var(--c-pink)] text-[12px] hover:bg-[color-mix(in_srgb,_var(--c-pink)_25%,_transparent)] transition-all flex-shrink-0">
                <Square size={11} />
                Stop
              </button>
            )}
          </div>

          <div className="space-y-3">
            <Slider
              label="Intensity"
              value={intensityPct}
              min={10} max={500} step={5}
              onChange={v => setIntensity(v / 100)}
              unit="%"
              hint={`Speed multiplier — ${intensity.toFixed(2)}× active preset. Above 200% is very aggressive.`}
            />
            <Slider
              label="Glans Focus"
              value={Math.round(glansShift * 100)}
              min={0} max={100}
              onChange={v => setGlansShift(v / 100)}
              unit="%"
              hint="Shifts stroke window upward — more tip stimulation"
            />
            <Slider
              label="Stroke Variance"
              value={variance}
              min={0} max={100}
              onChange={setVariance}
              unit="%"
              hint={variance === 0
                ? 'Deterministic — strokes always hit exact range endpoints'
                : variance < 40
                  ? 'Slight randomness — strokes wander near endpoints'
                  : variance < 75
                    ? 'Moderate variance — strokes land freely within range'
                    : 'High variance — each stroke is largely unpredictable'}
            />
          </div>

          {isFreestyle && (
            <button
              onClick={() => deviceService.triggerCumPattern(30)}
              className="w-full py-2.5 rounded-lg font-semibold text-[13px] transition-all"
              style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--c-pink) 35%, transparent)', color: 'var(--c-pink)' }}>
              💦 Cum
            </button>
          )}
        </div>
      </Card>

      {/* Preset library */}
      <Card title="Patterns">
        <div className="space-y-4">
          {/* Built-in presets */}
          <div>
            <div className="text-[11px] text-[rgba(255,255,255,0.3)] mb-2">Built-in</div>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map(p => (
                <PresetCard key={p.id} {...p} active={activeId === p.id} onClick={() => setPreset(p.id)} />
              ))}
            </div>
          </div>

          {/* Saved patterns */}
          {savedPatterns.length > 0 && (
            <div>
              <div className="text-[11px] text-[rgba(255,255,255,0.3)] mb-2">Saved</div>
              <div className="grid grid-cols-3 gap-2">
                {savedPatterns.map(p => (
                  <PresetCard
                    key={p.name}
                    id={`saved_${p.name}`}
                    name={p.name}
                    strokeMin={p.strokeMin}
                    strokeMax={p.strokeMax}
                    spm={p.spm}
                    active={activeId === `saved_${p.name}`}
                    onClick={() => {
                      setCustom({ strokeMin: p.strokeMin, strokeMax: p.strokeMax, spm: p.spm, waveform: p.waveform })
                      setPreset(`saved_${p.name}`)
                    }}
                    onDelete={() => {
                      if (activeId === `saved_${p.name}`) setPreset('tease')
                      deletePattern(p.name)
                      toast(`Pattern "${p.name}" deleted`)
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom pattern builder */}
          <div>
            <div className="text-[11px] text-[rgba(255,255,255,0.3)] mb-2">Custom</div>
            <div
              className={`p-3 rounded-lg border cursor-pointer mb-3 ${
                activeId === 'custom'
                  ? 'border-[var(--c-accent)] bg-[color-mix(in_srgb,_var(--c-accent)_8%,_transparent)]'
                  : 'border-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.15)]'
              }`}
              onClick={() => setPreset('custom')}>
              <div
                className="text-[12px] font-medium"
                style={{ color: activeId === 'custom' ? 'var(--c-accent)' : 'rgba(255,255,255,0.6)' }}>
                {activeId === 'custom' ? 'Editing custom pattern' : 'Click to create a custom pattern'}
              </div>
            </div>

            <div className="space-y-3 p-3 bg-[rgba(255,255,255,0.03)] rounded-lg border border-[rgba(255,255,255,0.06)]">
              <Slider label="Stroke Min" value={customPattern.strokeMin}
                min={0} max={customPattern.strokeMax - 5}
                onChange={v => { setCustom({ strokeMin: v }); setPreset('custom') }}
                unit="%" hint="Lower = deeper strokes" />
              <Slider label="Stroke Max" value={customPattern.strokeMax}
                min={customPattern.strokeMin + 5} max={100}
                onChange={v => { setCustom({ strokeMax: v }); setPreset('custom') }}
                unit="%" hint="Higher = more glans stimulation" />
              <Slider label="Speed" value={customPattern.spm}
                min={5} max={120}
                onChange={v => { setCustom({ spm: v }); setPreset('custom') }}
                unit=" spm" />

              <div className="flex gap-2 pt-1">
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  placeholder="Pattern name…"
                  className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-[12px] text-[rgba(255,255,255,0.85)] placeholder:text-[rgba(255,255,255,0.25)]"
                />
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-accent)] text-white text-[12px] font-medium hover:opacity-90 transition-all">
                  <Save size={12} />
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Finisher — bind a saved pattern to a hotkey/button that overrides the device */}
      <Card title="Finisher">
        <div className="space-y-3">
          <div className="text-[12px] text-[rgba(255,255,255,0.45)] leading-relaxed">
            Bind a saved pattern to a hotkey. Press it during a funscript video to instantly
            override the device and loop that pattern until you stop it.
          </div>
          {savedPatterns.length === 0 ? (
            <div className="text-[12px] text-[rgba(255,255,255,0.35)]">
              Save a custom pattern above first — the finisher plays one of your saved patterns.
            </div>
          ) : (
            <>
              <div>
                <div className="text-[11px] text-[rgba(255,255,255,0.3)] mb-1.5">Finisher pattern</div>
                <select
                  value={finisherPattern}
                  onChange={e => setFinisherPattern(e.target.value)}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-[rgba(255,255,255,0.85)]">
                  <option value="">— none —</option>
                  {savedPatterns.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <div className="text-[11px] text-[rgba(255,255,255,0.3)] mb-1.5">Hotkey</div>
                <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2">
                  <span className="text-[13px] font-mono text-[rgba(255,255,255,0.85)]">
                    {bindingToDisplay(finisherHotkey)}
                  </span>
                  <span className="text-[11px] text-[rgba(255,255,255,0.3)] ml-auto">
                    Rebind in Settings → Hotkeys
                  </span>
                </div>
              </div>

              <button
                disabled={!finisherPattern}
                onClick={() => deviceService.toggleFinisher(finisherPattern)}
                className="w-full py-2.5 rounded-lg font-semibold text-[13px] transition-all disabled:opacity-40"
                style={{
                  background: finisherActive ? 'color-mix(in srgb, var(--c-pink) 30%, transparent)' : 'color-mix(in srgb, var(--c-pink) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--c-pink) 35%, transparent)', color: 'var(--c-pink)',
                }}>
                {finisherActive
                  ? <span className="inline-flex items-center gap-1.5"><Square size={11} /> Stop finisher</span>
                  : '🏁 Test finisher'}
              </button>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

// ── Ramp section ──────────────────────────────────────────────────────────────

function RampSection() {
  const rampEnabled      = useDeviceStore(s => s.rampEnabled)
  const schedulerEnabled = useDeviceStore(s => s.schedulerEnabled)
  const rampDuration     = useDeviceStore(s => s.rampDurationMin)
  const rampStart        = useDeviceStore(s => s.rampStartPreset)
  const rampEnd          = useDeviceStore(s => s.rampEndPreset)
  const rampProgress     = useDeviceStore(s => s.rampProgress)
  const savedPatterns    = useDeviceStore(s => s.savedPatterns)
  const setEnabled       = useDeviceStore(s => s.setRampEnabled)
  const setDuration      = useDeviceStore(s => s.setRampDuration)
  const setStart         = useDeviceStore(s => s.setRampStartPreset)
  const setEnd           = useDeviceStore(s => s.setRampEndPreset)

  const opts = buildPatternOptions(savedPatterns, { excludeCum: true })

  return (
    <Card title="Ramp Mode">
      <div className="space-y-4">
        <Toggle
          label="Ramp Mode"
          desc={schedulerEnabled
            ? 'Disabled — Pattern Scheduler is active'
            : 'Smoothly escalates from one pattern to another over time'}
          checked={rampEnabled}
          onChange={setEnabled}
        />

        {rampEnabled && (
          <div className="space-y-3">
            <Slider label="Duration" value={rampDuration} min={1} max={120} onChange={setDuration} unit=" min" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 block">Start Pattern</label>
                <PatternSelect value={rampStart} onChange={setStart} options={opts} />
              </div>
              <div>
                <label className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 block">End Pattern</label>
                <PatternSelect value={rampEnd} onChange={setEnd} options={opts} />
              </div>
            </div>

            {rampProgress > 0 && (
              <div>
                <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.3)] mb-1">
                  <span>{getPresetLabel(rampStart, savedPatterns)}</span>
                  <span>{Math.round(rampProgress * 100)}%</span>
                  <span>{getPresetLabel(rampEnd, savedPatterns)}</span>
                </div>
                <div className="h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${rampProgress * 100}%`, background: 'var(--c-accent)' }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Scheduler section ─────────────────────────────────────────────────────────

function SchedulerSection() {
  const enabled        = useDeviceStore(s => s.schedulerEnabled)
  const running        = useDeviceStore(s => s.schedulerRunningOnce)
  const rampEnabled    = useDeviceStore(s => s.rampEnabled)
  const steps          = useDeviceStore(s => s.schedulerSteps)
  const currentStep    = useDeviceStore(s => s.schedulerStep)
  const savedPatterns  = useDeviceStore(s => s.savedPatterns)
  const setEnabled     = useDeviceStore(s => s.setSchedulerEnabled)
  const addStep        = useDeviceStore(s => s.addSchedulerStep)
  const removeStep     = useDeviceStore(s => s.removeSchedulerStep)
  const moveStep       = useDeviceStore(s => s.moveSchedulerStep)
  const status         = useDeviceStore(s => s.status)
  const isConnected    = status === 'connected'

  const [newPreset, setNewPreset] = useState('tease')
  const [newDur, setNewDur]       = useState(5)

  const opts         = buildPatternOptions(savedPatterns)
  const totalMinutes = steps.reduce((sum, s) => sum + s.durationMin, 0)

  return (
    <Card title="Pattern Scheduler">
      <div className="space-y-4">
        <Toggle
          label="Loop with Freestyle"
          desc={rampEnabled
            ? 'Disabled — Ramp Mode is active'
            : 'Cycles through steps automatically when Freestyle mode is on'}
          checked={enabled}
          onChange={setEnabled}
        />

        {/* Step list — always visible */}
        <div className="space-y-1.5">
          {steps.length === 0 && (
            <div className="text-[12px] text-[rgba(255,255,255,0.3)] py-2">No steps yet — add one below.</div>
          )}
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] border transition-all ${
                running && i === currentStep
                  ? 'bg-[color-mix(in_srgb,_var(--c-accent)_10%,_transparent)] border-[color-mix(in_srgb,_var(--c-accent)_30%,_transparent)]'
                  : 'bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.06)]'
              }`}>
              {running && i === currentStep && (
                <Activity size={10} className="text-[var(--c-accent)] flex-shrink-0 animate-pulse" />
              )}
              <span className="text-[rgba(255,255,255,0.85)] font-medium w-20 truncate">
                {getPresetLabel(step.presetId, savedPatterns)}
              </span>
              <span className="text-[rgba(255,255,255,0.35)] flex-1">{step.durationMin} min</span>
              <div className="flex gap-1">
                {i > 0 && (
                  <button onClick={() => moveStep(i, i - 1)}
                    className="p-1 text-[rgba(255,255,255,0.35)] hover:text-white">
                    <ChevronUp size={12} />
                  </button>
                )}
                {i < steps.length - 1 && (
                  <button onClick={() => moveStep(i, i + 1)}
                    className="p-1 text-[rgba(255,255,255,0.35)] hover:text-white">
                    <ChevronDown size={12} />
                  </button>
                )}
                <button onClick={() => removeStep(i)}
                  className="p-1 text-[color-mix(in_srgb,_var(--c-pink)_60%,_transparent)] hover:text-[var(--c-pink)]">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Play / Stop controls */}
        {steps.length > 0 && (
          <div className="flex items-center gap-3">
            {!running ? (
              <button
                onClick={() => deviceService.playSchedulerOnce()}
                disabled={!isConnected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--c-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-all">
                <Play size={13} fill="currentColor" />
                Play Queue
              </button>
            ) : (
              <button
                onClick={() => deviceService.stopSchedulerOnce()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[color-mix(in_srgb,_var(--c-pink)_15%,_transparent)] border border-[color-mix(in_srgb,_var(--c-pink)_30%,_transparent)] text-[var(--c-pink)] hover:bg-[color-mix(in_srgb,_var(--c-pink)_25%,_transparent)] transition-all">
                <Square size={13} />
                Stop
              </button>
            )}
            {running && (
              <span className="text-[12px] text-[var(--c-accent)]">
                Step {currentStep + 1} / {steps.length} · {getPresetLabel(steps[currentStep]?.presetId, savedPatterns)}
              </span>
            )}
            {!running && totalMinutes > 0 && (
              <span className="text-[11px] text-[rgba(255,255,255,0.3)]">
                {totalMinutes} min total
              </span>
            )}
          </div>
        )}

        {/* Add step */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 block">Pattern</label>
            <PatternSelect value={newPreset} onChange={setNewPreset} options={opts} />
          </div>
          <div className="w-24">
            <label className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 block">Duration (min)</label>
            <input
              type="number" min={1} max={60} value={newDur}
              onChange={e => setNewDur(Number(e.target.value))}
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[12px] text-[rgba(255,255,255,0.85)]"
            />
          </div>
          <button
            onClick={() => addStep({ presetId: newPreset, durationMin: newDur })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--c-accent)] text-white text-[12px] font-medium hover:opacity-90 transition-all">
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </Card>
  )
}

// ── Edge Mode section ─────────────────────────────────────────────────────────

// Small segmented control for the fixed/random and stop/slow choices.
function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 text-[12px] cursor-pointer transition-colors"
          style={{
            background: value === opt.value ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'transparent',
            color: value === opt.value ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function EdgeSection() {
  const s   = useDeviceStore()
  const set = useDeviceStore(st => st.setEdgeSetting)

  const isRandomInterval = s.edgeIntervalMode === 'random'
  const isRandomDuration = s.edgeDurationMode === 'random'

  return (
    <Card title="Edge Mode">
      <div className="space-y-4">
        <Toggle
          label="Edge Mode"
          desc="Periodically cuts or slows the device mid-session. Works in freestyle and funscript alike."
          checked={s.edgeModeEnabled}
          onChange={(v) => deviceService.setEdgeMode(v)}
        />

        {s.edgeModeEnabled && (
          <div className="space-y-4">
            {/* Live state */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                 style={{ background: s.edgeActive ? 'color-mix(in srgb, var(--c-pink) 15%, transparent)' : 'rgba(255,255,255,0.03)',
                          border: `0.5px solid ${s.edgeActive ? 'color-mix(in srgb, var(--c-pink) 35%, transparent)' : 'rgba(255,255,255,0.08)'}` }}>
              <span className="text-[12px]" style={{ color: s.edgeActive ? 'var(--c-pink-text)' : 'rgba(255,255,255,0.45)' }}>
                {s.edgeActive ? '🌊 Edging right now…' : 'Armed — waiting'}
              </span>
              <span className="text-[12px] font-mono text-[rgba(255,255,255,0.4)]">
                {s.edgeSessionCount} this session
              </span>
            </div>

            {/* How often */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-[rgba(255,255,255,0.4)]">How often</label>
                <Segmented
                  value={s.edgeIntervalMode}
                  onChange={(v) => set('edgeIntervalMode', v)}
                  options={[{ value: 'random', label: 'Random' }, { value: 'fixed', label: 'Fixed' }]}
                />
              </div>
              <Slider
                label={isRandomInterval ? 'Shortest gap' : 'Every'} value={s.edgeIntervalMinSec}
                min={10} max={600} onChange={(v) => set('edgeIntervalMinSec', v)} unit="s"
              />
              {isRandomInterval && (
                <Slider
                  label="Longest gap" value={s.edgeIntervalMaxSec}
                  min={10} max={600} onChange={(v) => set('edgeIntervalMaxSec', v)} unit="s"
                  hint="Each edge picks a fresh random gap in this range"
                />
              )}
            </div>

            {/* What it does */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-[rgba(255,255,255,0.4)]">What happens</label>
                <Segmented
                  value={s.edgeActionMode}
                  onChange={(v) => set('edgeActionMode', v)}
                  options={[{ value: 'stop', label: 'Full stop' }, { value: 'slow', label: 'Slow down' }]}
                />
              </div>
              {s.edgeActionMode === 'slow' && (
                <Slider
                  label="Slow to" value={s.edgeSlowPercent} min={5} max={90}
                  onChange={(v) => set('edgeSlowPercent', v)} unit="%"
                  hint="Freestyle slows to this speed; a funscript keeps its timing but strokes this much smaller"
                />
              )}
            </div>

            {/* How long */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-[rgba(255,255,255,0.4)]">How long</label>
                <Segmented
                  value={s.edgeDurationMode}
                  onChange={(v) => set('edgeDurationMode', v)}
                  options={[{ value: 'random', label: 'Random' }, { value: 'fixed', label: 'Fixed' }]}
                />
              </div>
              <Slider
                label={isRandomDuration ? 'Shortest hold' : 'Hold for'} value={s.edgeDurationMinSec}
                min={2} max={180} onChange={(v) => set('edgeDurationMinSec', v)} unit="s"
              />
              {isRandomDuration && (
                <Slider
                  label="Longest hold" value={s.edgeDurationMaxSec}
                  min={2} max={180} onChange={(v) => set('edgeDurationMaxSec', v)} unit="s"
                />
              )}
            </div>

            <Slider
              label="Ease back over" value={s.edgeRampBackSec} min={0} max={30}
              onChange={(v) => set('edgeRampBackSec', v)} unit="s"
              hint="0 snaps straight back to full output"
            />

            <div className="text-[11px] text-[rgba(255,255,255,0.3)] leading-relaxed">
              Every edge adds +1 to the edge count of whatever is on screen, and earns XP.
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PROVIDER_SUBTITLES = {
  intiface: 'Intiface Central · Buttplug.io',
  handy:    'The Handy · REST API v2',
  serial:   'Serial Connection',
}

export default function DeviceControl() {
  const status      = useDeviceStore(s => s.status)
  const provider    = useDeviceStore(s => s.provider)
  const isConnected = status === 'connected'
  const subtitle    = provider ? PROVIDER_SUBTITLES[provider] : 'Intiface · The Handy · Direct Serial'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4" style={{ zoom: 1.25 }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-[rgba(255,255,255,0.9)]">Device Control</h1>
          <p className="text-[12px] text-[rgba(255,255,255,0.35)] mt-0.5">{subtitle}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <ConnectionSection />

      {isConnected && (
        <>
          <AutoSyncSection />
          <StrokeLimiterSection />
          <FreestyleSection />
          <RampSection />
          <SchedulerSection />
          <EdgeSection />
        </>
      )}

      {!isConnected && (
        <div className="vault-card p-8 text-center text-[rgba(255,255,255,0.25)] text-[13px]">
          Connect a device to access controls
        </div>
      )}
    </div>
  )
}
