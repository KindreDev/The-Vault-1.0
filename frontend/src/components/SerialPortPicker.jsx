import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Usb, X } from 'lucide-react'
import { useT } from '../i18n'

import ModalLayer from './ModalLayer'
export default function SerialPortPicker() {
  const t = useT()
  const [request, setRequest] = useState(null)
  useEffect(() => {
    let pending = null
    const listener = event => {
      pending?.reject(new Error('Port selection cancelled'))
      pending = event.detail
      setRequest(pending)
    }
    window.addEventListener('vault:choose-serial-port', listener)
    return () => {
      window.removeEventListener('vault:choose-serial-port', listener)
      pending?.reject(new Error('Port selection cancelled'))
    }
  }, [])
  useEffect(() => {
    if (!request) return
    const previous = document.body.style.overflow
    const previousFocus = document.activeElement
    document.body.style.overflow = 'hidden'
    const keydown = event => {
      if (event.key === 'Escape') { request.reject(new Error('Port selection cancelled')); setRequest(null) }
      if (event.key === 'Tab') {
        const buttons = [...document.querySelectorAll('[aria-labelledby="serial-port-title"] button')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', keydown); previousFocus?.focus() }
  }, [request])
  if (!request) return null
  const close = () => { request.reject(new Error('Port selection cancelled')); setRequest(null) }
  return createPortal(
    <ModalLayer><div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 12000, background: 'rgba(0,0,0,.75)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="serial-port-title" onClick={event => event.stopPropagation()}
        style={{ width: 'min(520px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border)', borderRadius: 16, boxShadow: '0 16px 70px #0008', fontSize: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 20, borderBottom: '1px solid var(--c-border)' }}>
          <Usb size={22} /><h2 id="serial-port-title" style={{ flex: 1, fontSize: 20 }}>{t('Select serial port')}</h2>
          <button autoFocus onClick={close} aria-label={t('Close')} style={{ color: 'var(--c-text)' }}><X size={22} /></button>
        </header>
        <div style={{ overflowY: 'auto', padding: 16, display: 'grid', gap: 10 }}>
          {request.ports.map(port => <button key={port.device} onClick={() => { request.resolve(port); setRequest(null) }}
            className="hover:brightness-125 transition-all" style={{ textAlign: 'left', padding: 16, borderRadius: 10, border: '1px solid var(--c-border)', background: 'color-mix(in srgb, var(--c-accent) 12%, var(--c-surface))', color: 'var(--c-text)', fontSize: 16 }}>
            <strong>{port.device}</strong><div>{port.description}</div>
          </button>)}
        </div>
        <footer style={{ padding: 16, borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={close} style={{ fontSize: 16, padding: '8px 16px', border: '1px solid var(--c-border)', borderRadius: 8 }}>{t('Cancel')}</button>
        </footer>
      </section>
    </div></ModalLayer>, document.body,
  )
}
