import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { systemApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import { useDeviceStore } from '../store/deviceStore'
import { useFunscriptPlayerStore } from '../store/funscriptPlayerStore'
import { readSurveyState, writeSurveyState, surveyIsDue } from '../lib/releaseSurvey'
import './release-survey.css'

function busy() {
  const vault = useVaultStore.getState()
  const device = useDeviceStore.getState()
  return vault.sessionActive || vault.staleSession || vault.viewerGalleryId != null
    || vault.multiPanelFullscreen || vault.climaxPromptOpen
    || device.mode !== 'off' || device.finisherActive
    || useFunscriptPlayerStore.getState().playing || document.fullscreenElement
    || document.querySelector('[data-vault-video]')
    || [...document.querySelectorAll('video')].some(video => !video.paused && !video.ended)
    || document.querySelector('[role="dialog"], [aria-modal="true"]')
    || document.body.style.overflow === 'hidden'
    || /^\/(multi-panel|playlists|device-control|collection\/room)(\/|$)/.test(location.pathname)
}

export default function ReleaseSurveyPrompt() {
  const t = useT()
  const [config, setConfig] = useState(null)
  const state = useRef(readSurveyState())
  const panel = useRef(null)
  const checked = useRef(false)

  function dismiss(done) {
    state.current = { ...state.current, done, laterUntil: done ? 0 : Date.now() + 24 * 60 * 60 * 1000 }
    writeSurveyState(state.current)
    checked.current = false
    setConfig(null)
  }

  useEffect(() => {
    let lastInput = Date.now(), lastTick = Date.now(), pending = false, cancelled = false
    const activity = () => { lastInput = Date.now() }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel']
    events.forEach(event => window.addEventListener(event, activity, { passive: true }))
    const timer = setInterval(async () => {
      const now = Date.now()
      const elapsed = Math.min(5000, Math.max(0, now - lastTick))
      lastTick = now
      state.current = readSurveyState()
      if (state.current.done) return
      const visible = document.visibilityState === 'visible' && document.hasFocus()
      const watching = document.querySelector('[data-vault-video]')
        || [...document.querySelectorAll('video')].some(video => !video.paused && !video.ended)
        || useVaultStore.getState().sessionActive
      if (visible && (now - lastInput < 60000 || watching)) {
        state.current.activeMs += elapsed
        writeSurveyState(state.current)
      }
      if (!visible || busy() || !surveyIsDue(state.current, now) || pending || checked.current) return
      pending = true
      try {
        const { data } = await systemApi.getReleaseSurvey()
        if (cancelled) return
        checked.current = true
        if (data.enabled && !busy() && document.hasFocus() && document.visibilityState === 'visible'
            && surveyIsDue(readSurveyState())) setConfig(data)
        else if (data.enabled) checked.current = false
      } catch { checked.current = true } finally { pending = false }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
      events.forEach(event => window.removeEventListener(event, activity))
    }
  }, [])

  useEffect(() => {
    if (!config) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector('button')?.focus()
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(false) }
      if (event.key === 'Tab') {
        const buttons = [...panel.current.querySelectorAll('button, a')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', key)
      previousFocus?.focus?.()
    }
  }, [config])

  if (!config) return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.78)', padding: 24 }} onClick={() => dismiss(false)}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="release-survey-title" onClick={event => event.stopPropagation()}
        style={{ background: 'var(--c-surface)', color: 'var(--c-text, rgba(255,255,255,0.9))', border: '1px solid var(--c-border, rgba(255,255,255,0.12))', borderRadius: 16, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 24, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
        <h2 id="release-survey-title" style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{t('Help shape the next version of Vault')}</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65 }}>{t('Would you like to answer a short, optional survey? It takes about five minutes and will help me improve the Vault for all its users.')}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
          <button className="release-survey-button" onClick={() => dismiss(true)}>{t('Don’t ask again')}</button>
          <button className="release-survey-button" onClick={() => dismiss(false)}>{t('Later')}</button>
          <a className="release-survey-button release-survey-primary" href={config.url} target="_blank" rel="noopener noreferrer" onClick={() => dismiss(true)}>{t('Open survey')}</a>
        </div>
      </div>
    </div>, document.body,
  )
}
