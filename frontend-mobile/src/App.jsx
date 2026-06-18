import { useState, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { hasServerBase } from './lib/server.js'
import { gamiApi, systemApi } from './lib/api.js'
import { useVaultStore } from './store/vault.js'

import ServerSetup from './components/ServerSetup.jsx'
import MobileLayout from './components/MobileLayout.jsx'
import ToastLayer from './components/ToastLayer.jsx'
import PlaylistPicker from './components/PlaylistPicker.jsx'

import Dashboard from './pages/Dashboard.jsx'
import GalleryList from './pages/GalleryList.jsx'
import GalleryView from './pages/GalleryView.jsx'
import ImageViewer from './pages/ImageViewer.jsx'
import VideoPlayer from './pages/VideoPlayer.jsx'
import CreatorList from './pages/CreatorList.jsx'
import CreatorProfile from './pages/CreatorProfile.jsx'
import Cards from './pages/Cards.jsx'
import Playlists from './pages/Playlists.jsx'
import PlaylistView from './pages/PlaylistView.jsx'
import Profile from './pages/Profile.jsx'

export default function App() {
  // 'verifying' → checking the saved address is reachable; 'setup' → ask for it;
  // 'ready' → connected, show the app.
  const [phase, setPhase] = useState(hasServerBase() ? 'verifying' : 'setup')
  const setProfile = useVaultStore(s => s.setProfile)

  // On launch, confirm the stored server is actually reachable. If the PC is off
  // or its IP changed, this fails fast (6s timeout) and drops to the setup screen
  // so the user can re-enter the address instead of staring at a dead app.
  useEffect(() => {
    if (phase !== 'verifying') return
    let alive = true
    systemApi.health()
      .then(() => { if (alive) setPhase('ready') })
      .catch(() => { if (alive) setPhase('setup') })
    return () => { alive = false }
  }, [phase])

  // Daily login + profile load once connected (login bonus is auto-granted).
  useEffect(() => {
    if (phase !== 'ready') return
    gamiApi.login().catch(() => {})
    gamiApi.profile().then(r => setProfile(r.data)).catch(() => {})
  }, [phase, setProfile])

  // Android hardware back button → browser history back.
  useEffect(() => {
    let remove
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App: CapApp } = await import('@capacitor/app')
        const h = await CapApp.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack || window.history.length > 1) window.history.back()
          else CapApp.exitApp()
        })
        remove = () => h.remove()
      } catch (_) {}
    })()
    return () => remove?.()
  }, [])

  if (phase === 'verifying') {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3"
           style={{ background: 'var(--c-bg)' }}>
        <Loader2 size={30} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <span className="text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Connecting to The Vault…</span>
      </div>
    )
  }
  if (phase !== 'ready') return <ServerSetup onConnected={() => setPhase('ready')} />

  return (
    <>
      <ToastLayer />
      <PlaylistPicker />
      <MobileLayout>
        <AnimatedRoutes />
      </MobileLayout>
    </>
  )
}

// Fullscreen overlay routes are exempt from the page crossfade — they manage
// their own entrance and a transform-based transition would break their
// `position: fixed` layering. Everything else gets a quick opacity crossfade.
const FULLSCREEN = ['/view/', '/video/', '/photo/']
const isFullscreen = (p) => FULLSCREEN.some(f => p.startsWith(f)) || p.endsWith('/view')

function AnimatedRoutes() {
  const location = useLocation()
  const routes = (
    <Routes location={location}>
      <Route path="/"                       element={<Dashboard />} />
      <Route path="/galleries"              element={<GalleryList />} />
      <Route path="/gallery/:id"            element={<GalleryView />} />
      <Route path="/view/:galleryId"        element={<ImageViewer />} />
      <Route path="/photo/:imageId"         element={<ImageViewer />} />
      <Route path="/playlist/:playlistId/view" element={<ImageViewer />} />
      <Route path="/video/:imageId"         element={<VideoPlayer />} />
      <Route path="/creators"               element={<CreatorList />} />
      <Route path="/creator/:id"            element={<CreatorProfile />} />
      <Route path="/cards"                  element={<Cards />} />
      <Route path="/playlists"              element={<Playlists />} />
      <Route path="/playlist/:id"           element={<PlaylistView />} />
      <Route path="/profile"                element={<Profile />} />
    </Routes>
  )

  if (isFullscreen(location.pathname)) return routes

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        {routes}
      </motion.div>
    </AnimatePresence>
  )
}
