import { LocalizedText, useT } from '../../i18n'
import { ACCENT_SWATCHES, LIGHTING_MOODS, MOOD_ORDER, ROOM_TINT_SWATCHES } from './roomLightingSettings'

const QUALITY_OPTIONS = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]

function Segmented({ label, options, value, onChange }) {
  const t = useT()
  return <div className="vault-hud__segmented" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
    {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} className={value === key ? 'is-selected' : ''} onClick={() => onChange(key)}>{t(text)}</button>)}
  </div>
}

function Toggle({ label, checked, onChange }) {
  return <button type="button" role="switch" aria-checked={checked} className={`room-settings__toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
    <span>{label}</span><i aria-hidden="true" />
  </button>
}

/**
 * Room settings: graphics budget, lighting mood, coloured accent lights and
 * how walking feels.  Lighting changes apply live behind the panel.
 */
export default function RoomSettingsPanel({ quality, onQuality, lighting, onLighting, look, onLook, onManage, onClose }) {
  const t = useT()
  const accent = lighting.accent
  const setAccent = patch => onLighting({ ...lighting, accent: { ...accent, ...patch } })
  const tint = lighting.tint
  const setTint = patch => onLighting({ ...lighting, tint: { ...tint, ...patch } })
  return <section className="vault-hud__modal room-settings" role="dialog" aria-labelledby="room-settings-title" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div>
      <h2 id="room-settings-title"><LocalizedText text={"Settings"} /></h2>
      <div className="room-settings__body">
        <div className="vault-hud__setting"><span><LocalizedText text={"Graphics quality"} /></span>
          <Segmented label={t('Graphics quality')} options={QUALITY_OPTIONS} value={quality} onChange={onQuality} />
        </div>

        <h3><LocalizedText text={"Lighting"} /></h3>
        <div className="vault-hud__setting"><span><LocalizedText text={"Mood"} /></span>
          <Segmented label={t('Lighting mood')} options={MOOD_ORDER.map(key => [key, LIGHTING_MOODS[key].label])} value={lighting.mood} onChange={mood => onLighting({ ...lighting, mood })} />
        </div>
        <Toggle label={t('Ceiling light')} checked={lighting.ceiling} onChange={ceiling => onLighting({ ...lighting, ceiling })} />
        <div className="vault-hud__setting"><span><LocalizedText text={"Room light"} /></span>
          <Segmented label={t('Room light')} options={[['natural', 'Natural'], ['color', 'Custom color'], ['led', 'Match LEDs']]} value={tint.mode} onChange={mode => setTint({ mode })} />
        </div>
        {tint.mode === 'color' && <div className="vault-hud__setting"><span><LocalizedText text={"Room light color"} /></span>
          <div className="room-settings__swatches">
            {ROOM_TINT_SWATCHES.map(([color, name]) => <button key={color} type="button" title={t(name)} aria-label={t(name)}
              className={tint.color.toLowerCase() === color ? 'is-selected' : ''} style={{ '--swatch': color }} onClick={() => setTint({ color })} />)}
            <label className="room-settings__custom" title={t('Custom color')} style={{ '--swatch': tint.color }}>
              <input type="color" value={tint.color} aria-label={t('Custom color')} onChange={event => setTint({ color: event.target.value })} />
            </label>
          </div>
        </div>}
        {tint.mode !== 'natural' && <label className="room-settings__slider"><span><LocalizedText text={"Tint strength"} /><b>{Math.round(tint.strength * 100)}%</b></span>
          <input type="range" min="0" max="100" value={Math.round(tint.strength * 100)} onChange={event => setTint({ strength: Number(event.target.value) / 100 })} />
        </label>}
        <Toggle label={t('Accent LED lights')} checked={accent.enabled} onChange={enabled => setAccent({ enabled })} />
        <fieldset className="room-settings__accent" disabled={!accent.enabled}>
          <div className="vault-hud__setting"><span><LocalizedText text={"LED color"} /></span>
            <div className="room-settings__swatches">
              {ACCENT_SWATCHES.map(([color, name]) => <button key={color} type="button" title={t(name)} aria-label={t(name)}
                className={accent.mode === 'solid' && accent.color.toLowerCase() === color ? 'is-selected' : ''}
                style={{ '--swatch': color }} onClick={() => setAccent({ color, mode: 'solid' })} />)}
              <label className="room-settings__custom" title={t('Custom color')} style={{ '--swatch': accent.color }}>
                <input type="color" value={accent.color} aria-label={t('Custom color')} onChange={event => setAccent({ color: event.target.value, mode: 'solid' })} />
              </label>
            </div>
          </div>
          <div className="vault-hud__setting"><span><LocalizedText text={"LED effect"} /></span>
            <Segmented label={t('LED effect')} options={[['solid', 'Solid'], ['cycle', 'Color cycle']]} value={accent.mode} onChange={mode => setAccent({ mode })} />
          </div>
          <label className="room-settings__slider"><span><LocalizedText text={"LED brightness"} /><b>{Math.round(accent.brightness * 100)}%</b></span>
            <input type="range" min="0" max="100" value={Math.round(accent.brightness * 100)} onChange={event => setAccent({ brightness: Number(event.target.value) / 100 })} />
          </label>
        </fieldset>

        <h3><LocalizedText text={"Movement"} /></h3>
        <label className="room-settings__slider"><span><LocalizedText text={"Mouse sensitivity"} /><b>{look.sensitivity.toFixed(1)}×</b></span>
          <input type="range" min="30" max="250" value={Math.round(look.sensitivity * 100)} onChange={event => onLook({ ...look, sensitivity: Number(event.target.value) / 100 })} />
        </label>
        <Toggle label={t('Head bob while walking')} checked={look.headBob} onChange={headBob => onLook({ ...look, headBob })} />
      </div>
      <button type="button" onClick={onManage}><LocalizedText text={"Manage room module"} /></button>
      <button type="button" onClick={onClose}><LocalizedText text={"Close"} /></button>
    </div>
  </section>
}
