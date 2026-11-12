import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, MonitorUp, X } from 'lucide-react'
import { systemApi } from '../lib/api.js'
import pkg from '../../package.json'

// The installed APK doesn't update itself. Two checks:
//   1. mobile.json on the download server: catches app-only updates, which
//      keep the desktop version name but raise the build number.
//   2. The PC's version: catches a newer desktop release (app is behind), or
//      a PC that's older than the app.
// The browser (PWA) version is served by the PC and is always current.
export const APK_URL = 'https://downloads.vault-app.site/TheVault.apk'
const MANIFEST_URL = 'https://downloads.vault-app.site/mobile.json'
export const APP_VERSION = pkg.version
export const APP_BUILD = typeof __APP_BUILD__ === 'number' ? __APP_BUILD__ : 0

const parts = (v) => String(v || '0').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0)
function compare(a, b) {
  const x = parts(a), y = parts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  return 0
}

// The download server sends no CORS headers, so read it through Capacitor's
// native HTTP (APK only), never the WebView's fetch.
async function fetchManifest() {
  const { CapacitorHttp } = await import('@capacitor/core')
  const res = await CapacitorHttp.get({ url: `${MANIFEST_URL}?t=${Date.now()}`, headers: { 'Cache-Control': 'no-cache' } })
  const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
  return data && typeof data === 'object' ? data : null
}

export function useIsNative() {
  const [native, setNative] = useState(false)
  useEffect(() => {
    import('@capacitor/core').then(({ Capacitor }) => setNative(Capacitor.isNativePlatform())).catch(() => {})
  }, [])
  return native
}

export default function UpdateBanner() {
  const native = useIsNative()
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('vault.m.updateDismissed') || '' } catch { return '' }
  })
  const { data: pc } = useQuery({
    queryKey: ['server-version'],
    queryFn: () => systemApi.getVersion().then(r => r.data),
    enabled: native, staleTime: 10 * 60 * 1000,
  })
  const { data: latest } = useQuery({
    queryKey: ['mobile-manifest'],
    queryFn: fetchManifest,
    enabled: native, staleTime: 10 * 60 * 1000, retry: false,
  })
  if (!native) return null

  const pcVersion = pc?.version
  const newerBuild = latest && (compare(latest.version, APP_VERSION) > 0 ||
    (compare(latest.version, APP_VERSION) === 0 && Number(latest.build) > APP_BUILD))
  const pcAhead = pcVersion && compare(pcVersion, APP_VERSION) > 0
  const pcBehind = pcVersion && compare(pcVersion, APP_VERSION) < 0

  let banner = null
  if (newerBuild || pcAhead) {
    const label = newerBuild ? `${latest.version} (build ${latest.build})` : pcVersion
    banner = {
      key: `app-${label}`, icon: Download,
      title: `App update available: ${label}`,
      body: latest?.notes && newerBuild ? latest.notes
        : `This app is ${APP_VERSION} (build ${APP_BUILD}). Install the new APK over it; nothing is lost.`,
      action: { label: 'Get it', href: `${(newerBuild && latest.url) || APK_URL}?b=${latest?.build || Date.now()}` },
    }
  } else if (pcBehind) {
    banner = {
      key: `pc-${pcVersion}`, icon: MonitorUp,
      title: 'Your PC is on an older version',
      body: `The PC runs ${pcVersion} and this app is ${APP_VERSION}. Update The Vault on your PC.`,
    }
  }
  if (!banner || dismissed === banner.key) return null

  const dismiss = () => {
    setDismissed(banner.key)
    try { sessionStorage.setItem('vault.m.updateDismissed', banner.key) } catch {}
  }
  const Icon = banner.icon
  return (
    <div className="mx-4 mb-3 rounded-vault p-3 flex items-center gap-3"
         style={{ background: 'color-mix(in srgb, var(--c-green) 14%, var(--c-card))', border: '1px solid color-mix(in srgb, var(--c-green) 35%, transparent)' }}>
      <Icon size={20} style={{ color: '#6FD3AE' }} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold">{banner.title}</div>
        <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{banner.body}</div>
      </div>
      {banner.action && (
        <button onClick={() => { window.location.href = banner.action.href }}
                className="px-3 py-2 rounded-full text-[13px] font-semibold shrink-0" style={{ background: 'var(--c-green)' }}>
          {banner.action.label}
        </button>
      )}
      <button onClick={dismiss} className="p-1 shrink-0" aria-label="Dismiss"><X size={16} style={{ opacity: 0.5 }} /></button>
    </div>
  )
}
