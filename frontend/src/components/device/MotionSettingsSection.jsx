import React from 'react'
import { useDeviceStore } from '../../store/deviceStore'
import { LocalizedText, useT } from '../../i18n'
import { Card, Slider, Toggle, Segmented } from './deviceUi'
import AxisTuning from './AxisTuning'

const PROVIDER_NAMES = { intiface: 'Intiface', handy: 'The Handy', serial: 'Serial' }
const DEFAULT_SPEED_LIMIT = 600

// Script playback tuning modelled on MultiFunPlayer: soft start, speed limit,
// auto-home, per-device latency and (for T-Code) per-axis mapping. Every
// setting persists and applies live to whatever is playing.
export default function MotionSettingsSection() {
  const t = useT()
  const provider  = useDeviceStore(s => s.provider)
  const motion    = useDeviceStore(s => s.motion)
  const setMotion = useDeviceStore(s => s.setMotion)
  const latency   = motion.latencyMs[provider] ?? 0
  const isHandy   = provider === 'handy'

  return (
    <Card title={t('Script Playback')}>
      <div className="space-y-5">
        {/* The Handy limits its own speed between streamed points. */}
        {!isHandy && (
          <Slider
            label={t('Soft start')}
            value={motion.syncSeconds} min={0} max={3} step={0.25} unit=" s"
            onChange={v => setMotion({ syncSeconds: v })}
            hint={motion.syncSeconds > 0
              ? t('After a seek, play or loop the device eases into the script instead of jumping.')
              : t('Off: the device jumps straight to the script position.')}
          />
        )}

        <Slider
          label={t('{provider} latency', { provider: t(PROVIDER_NAMES[provider] || provider || '') })}
          value={latency} min={-300} max={500} step={10} unit=" ms"
          onChange={v => setMotion({ latencyMs: { ...motion.latencyMs, [provider]: v } })}
          hint={t('Raise it if this device moves after the video. Added to each video’s own Sync offset.')}
        />

        {!isHandy && (
          <div className="space-y-3">
            <Toggle
              label={t('Speed limit')}
              checked={motion.speedLimit > 0}
              onChange={on => setMotion({ speedLimit: on ? DEFAULT_SPEED_LIMIT : 0 })}
              desc={t('Caps how fast the device may travel, even if the script asks for more.')}
            />
            {motion.speedLimit > 0 && (
              <Slider
                label={t('Maximum speed')}
                value={motion.speedLimit} min={100} max={2000} step={50} unit=" %/s"
                onChange={v => setMotion({ speedLimit: v })}
                hint={t('Percent of full travel per second. 500 = one full stroke in 0.2 s.')}
              />
            )}
          </div>
        )}

        {!isHandy && (
          <div className="space-y-3">
            <Toggle
              label={t('Auto-home after pause')}
              checked={motion.autoHome.enabled}
              onChange={on => setMotion({ autoHome: { ...motion.autoHome, enabled: on } })}
              desc={t('Eases every axis back to centre once playback has been paused for a while. Stop never moves the device.')}
            />
            {motion.autoHome.enabled && (
              <>
                <Slider
                  label={t('Wait before homing')}
                  value={motion.autoHome.delay} min={0} max={30} step={1} unit=" s"
                  onChange={v => setMotion({ autoHome: { ...motion.autoHome, delay: v } })}
                />
                <Slider
                  label={t('Homing duration')}
                  value={motion.autoHome.duration} min={0.5} max={10} step={0.5} unit=" s"
                  onChange={v => setMotion({ autoHome: { ...motion.autoHome, duration: v } })}
                />
              </>
            )}
          </div>
        )}

        {provider === 'intiface' && (
          <div>
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-[16px] text-[rgba(255,255,255,0.6)]"><LocalizedText text="Stroker output" /></span>
              <Segmented
                value={motion.intifaceMode}
                onChange={v => setMotion({ intifaceMode: v })}
                options={[{ value: 'stream', label: t('Stream') }, { value: 'keyframe', label: t('Keyframes') }]}
              />
            </div>
            <div className="text-[16px] text-[rgba(255,255,255,0.3)]">
              {motion.intifaceMode === 'keyframe'
                ? t('Sends each script point once with the time to reach it. Smoother for devices that move on their own, and on slow connections.')
                : t('Sends the script curve 20 times a second.')}
            </div>
          </div>
        )}

        {provider === 'serial' && <AxisTuning />}
      </div>
    </Card>
  )
}
