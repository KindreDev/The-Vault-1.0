// Resolves and persists the Vault server base URL (the user's PC on the LAN).
//
// In the Capacitor APK and the iOS PWA the app has no backend of its own — every
// request points at an absolute address like http://192.168.1.42:8000, entered
// once on first launch and stored in localStorage.
//
// One exception: when the app is being served *by the backend itself* (the iOS
// PWA opened at http://192.168.x.x:8000), the origin already IS the server, so we
// default to same-origin and skip the setup screen.

const KEY = 'vault_server_base'

function sameOriginIsBackend() {
  // The Vite dev server (5174) and Capacitor (localhost) are NOT the backend.
  // Any other http(s) origin that isn't localhost:5174 is assumed to be the
  // backend serving this PWA.
  const { protocol, hostname, port, origin } = window.location
  if (protocol === 'capacitor:' || protocol === 'ionic:') return null
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // dev server or capacitor local — not the backend
    return null
  }
  // The Vite dev server (used for the WiFi live-test) is NOT the backend, even
  // when reached over a LAN IP. The backend serves the PWA on port 8000.
  if (port === '5174' || port === '5173' || port === '4173') return null
  // Served from a real host (LAN IP / domain) on the backend port → that origin
  // is the backend (the iOS PWA case, opened at http://<pc-ip>:8000).
  return origin
}

let _base = localStorage.getItem(KEY) || sameOriginIsBackend() || ''

export function getServerBase() {
  return _base
}

export function hasServerBase() {
  return !!_base
}

export function setServerBase(raw) {
  let v = (raw || '').trim().replace(/\/+$/, '')
  if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v
  _base = v
  if (v) localStorage.setItem(KEY, v)
  else localStorage.removeItem(KEY)
  return _base
}

// Build an absolute URL for any backend path (e.g. '/thumbs/x.jpg', '/api/...').
export function abs(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/i.test(path)) return path
  const p = path.startsWith('/') ? path : '/' + path
  return _base + p
}
