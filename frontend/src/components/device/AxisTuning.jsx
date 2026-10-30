import React, { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useDeviceStore, MOTION_AXES } from '../../store/deviceStore'
import { LocalizedText, useT } from '../../i18n'
import { Slider, Toggle } from './deviceUi'

const AXIS_NAMES = {
  L0: 'Stroke', L1: 'Surge', L2: 'Sway', R0: 'Twist', R1: 'Roll', R2: 'Pitch',
}
const DEFAULT_AXIS = { invert: false, offsetMs: 0, min: 0, max: 100 }

// Per-axis T-Code mapping (MultiFunPlayer's invert / axis offset / output
// range). L0's travel window stays on the Stroke Range card.
function AxisRow({ axis }) {
  const t = useT()
  const settings = useDeviceStore(s => s.motion.axisSettings[axis]) || DEFAULT_AXIS
  const setAxisMotion = useDeviceStore(s => s.setAxisMotion)
  const update = patch => setAxisMotion(axis, patch)

  return (
    <div className="space-y-3 pt-3" style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[16px] font-medium text-[rgba(255,255,255,0.85)]">
          {axis} · {t(AXIS_NAMES[axis])}
        </span>
        <Toggle label={t('Invert')} checked={settings.invert} onChange={v => update({ invert: v })} />
      </div>
      <Slider
        label={t('Axis offset')} value={settings.offsetMs} min={-300} max={300} step={10} unit=" ms"
        onChange={v => update({ offsetMs: v })}
      />
      {axis !== 'L0' && (
        <>
          <Slider
            label={t('Minimum')} value={settings.min} min={0} max={100} step={1} unit="%"
            onChange={v => update({ min: Math.min(v, settings.max - 5) })}
          />
          <Slider
            label={t('Maximum')} value={settings.max} min={0} max={100} step={1} unit="%"
            onChange={v => update({ max: Math.max(v, settings.min + 5) })}
          />
        </>
      )}
    </div>
  )
}

export default function AxisTuning() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const detected = useDeviceStore(s => s.detectedAxes)
  // Show the axes the current script uses first, then the rest.
  const axes = [...MOTION_AXES].sort((a, b) => Number(detected.includes(b)) - Number(detected.includes(a)))

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between cursor-pointer text-[16px] text-[rgba(255,255,255,0.6)]"
      >
        <LocalizedText text="Axis settings" />
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {!open && (
        <div className="text-[16px] text-[rgba(255,255,255,0.3)] mt-0.5">
          {t('Invert, time offset and travel range for each T-Code axis.')}
        </div>
      )}
      {open && (
        <div className="space-y-3 mt-2">
          {axes.map(axis => <AxisRow key={axis} axis={axis} />)}
        </div>
      )}
    </div>
  )
}
