import { useEffect, useState } from 'react'
import { Flame, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { insightsApi } from '../../lib/api'
import { useDeviceStore } from '../../store/deviceStore'
import { useT } from '../../i18n'

const PACING_KEY = 'vault.spicePacing'
// Spice level → freestyle stroke preset (see deviceStore PRESETS).
const PRESET_FOR_SPICE = { safe: 'tease', suggestive: 'edge', explicit: 'build', hardcore: 'pound' }
const SPICE_ORDER = ['safe', 'suggestive', 'explicit', 'hardcore']

export function readPacing() {
  try { return localStorage.getItem(PACING_KEY) === '1' } catch { return false }
}

function spiceOf(tags) {
  const names = new Set((tags || []).filter(tag => tag.category === 'rating').map(tag => tag.name))
  return [...SPICE_ORDER].reverse().find(level => names.has(level)) || null
}

// While freestyle runs, the stroke pattern follows the Spice of the file on
// screen: a tease on Safe, full strokes on Hardcore.
export function useSpicePacing(enabled, tags) {
  const status = useDeviceStore(s => s.status)
  const mode = useDeviceStore(s => s.mode)
  const setActivePreset = useDeviceStore(s => s.setActivePreset)
  const spice = spiceOf(tags)
  useEffect(() => {
    if (!enabled || status !== 'connected' || mode !== 'freestyle' || !spice) return
    setActivePreset(PRESET_FOR_SPICE[spice])
  }, [enabled, status, mode, spice, setActivePreset])
}

// Viewer toolbar: Spice ramp (replay this set from Safe up to Hardcore) and
// Spice pacing (device follows each file's Spice). Pacing only shows while a
// device is connected.
export default function SpiceControls({ images, currentTags, onRamp }) {
  const t = useT()
  const [pacing, setPacing] = useState(readPacing)
  const [busy, setBusy] = useState(false)
  const connected = useDeviceStore(s => s.status === 'connected')
  useSpicePacing(pacing, currentTags)

  const togglePacing = () => {
    const next = !pacing
    setPacing(next)
    try { localStorage.setItem(PACING_KEY, next ? '1' : '0') } catch { /* private mode */ }
    toast.success(next ? t('Spice pacing on: the device follows each file\'s Spice in freestyle') : t('Spice pacing off'))
  }

  const ramp = async () => {
    if (!images?.length || busy) return
    setBusy(true)
    try {
      const { data } = await insightsApi.spiceOrder(images.map(img => img.id))
      const byId = new Map(images.map(img => [img.id, img]))
      onRamp(data.map(row => byId.get(row.id)).filter(Boolean))
    } catch {
      toast.error(t('Could not build the Spice ramp'))
    } finally {
      setBusy(false)
    }
  }

  const pill = active => ({
    fontSize: 18,
    background: active ? 'color-mix(in srgb, var(--c-pink) 20%, transparent)' : 'rgba(255,255,255,0.07)',
    color: active ? 'var(--c-pink-text)' : 'rgba(255,255,255,0.65)',
    border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-pink) 40%, transparent)' : 'rgba(255,255,255,0.12)'}`,
  })

  return (
    <>
      <button type="button" onMouseDown={ramp} disabled={busy || !images?.length}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer disabled:opacity-50"
              style={pill(false)} title={t('Replay this set from Safe up to Hardcore as a slideshow')}>
        <TrendingUp size={15} /> {t('Spice ramp')}
      </button>
      {connected && (
        <button type="button" onMouseDown={togglePacing}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer"
                style={pill(pacing)} title={t('In freestyle, stroke speed follows the Spice of the file on screen')}>
          <Flame size={15} /> {t('Spice pacing')}
        </button>
      )}
    </>
  )
}
