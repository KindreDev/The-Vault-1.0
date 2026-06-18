import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// The mobile app is a standalone SPA. It never proxies to the backend — every
// request uses an absolute URL pointing at the user's PC (configured at runtime,
// stored in localStorage). See src/lib/server.js.
export default defineConfig({
  plugins: [
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
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: true,   // bind 0.0.0.0 so a phone on the same WiFi can open the dev server
    port: 5174,
  },
})
