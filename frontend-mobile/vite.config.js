import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

// The Android build number (versionCode) identifies app-only updates, which
// keep the same version name as the desktop release.
const APP_BUILD = Number((fs.readFileSync(path.resolve(__dirname, 'android/app/build.gradle'), 'utf8')
  .match(/versionCode\s+(\d+)/) || [])[1] || 0)

// The TCG card faces are shared with the desktop app (frontend/src/components/
// tcg-v2) so mobile cards look exactly like desktop ones. Two desktop-only
// imports inside them are swapped for small mobile versions: the desktop
// translation layer and the Windows VLC video player.
const DESKTOP_SRC = path.resolve(__dirname, '../frontend/src')
const DESKTOP_SWAPS = {
  [path.join(DESKTOP_SRC, 'i18n')]: path.resolve(__dirname, 'src/desktop-shims/i18n.jsx'),
  [path.join(DESKTOP_SRC, 'components', 'VaultVideo')]: path.resolve(__dirname, 'src/desktop-shims/VaultVideo.jsx'),
}
function desktopShims() {
  return {
    name: 'vault-desktop-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const clean = importer.split('?')[0]
      if (!path.resolve(clean).startsWith(DESKTOP_SRC)) return null
      const target = path.resolve(path.dirname(clean), source).replace(/\.(jsx?|tsx?)$/, '').replace(/[\\/]index$/, '')
      return DESKTOP_SWAPS[target] || null
    },
  }
}

// The mobile app is a standalone SPA. It never proxies to the backend — every
// request uses an absolute URL pointing at the user's PC (configured at runtime,
// stored in localStorage). See src/lib/server.js.
export default defineConfig({
  plugins: [
    desktopShims(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The app is bundled inside the APK, so a service-worker cache buys us
      // nothing — and it actively breaks things: when you install a new APK over
      // an old one, Android keeps the old cache and the worker keeps serving the
      // OLD code, so updates appear to do "nothing". selfDestroying ships a tiny
      // worker that UNREGISTERS any existing one and wipes its cache, cleaning up
      // phones that already got poisoned. After everyone's updated once, this is
      // just a no-op.
      selfDestroying: true,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'The Vault',
        short_name: 'Vault',
        description: 'The Vault — mobile browser',
        theme_color: '#0e0e0e',
        background_color: '#0e0e0e',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Never cache API or media responses — they're served from a LAN address
        // that changes between users. Only cache the app shell.
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
  ],
  define: { __APP_BUILD__: JSON.stringify(APP_BUILD) },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src'), '@desktop': DESKTOP_SRC },
    // Desktop files must use mobile's single copy of React, never their own.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared'), DESKTOP_SRC] },
    host: true,   // bind 0.0.0.0 so a phone on the same WiFi can open the dev server
    port: 5174,
  },
})
