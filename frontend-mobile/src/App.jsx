import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { hasServerBase, setServerBase } from './lib/server.js'
import { gamiApi, systemApi, tasksApi, refreshApiBase } from './lib/api.js'
import queryClient from './lib/queryClient.js'
import { createTaskRefreshTracker } from '../../shared/queryRefresh.mjs'
import { useVaultStore } from './store/vault.js'
import { useScrollMemory, closeTopOverlay, canGoBack, launchTabs, isFullscreenPath, TAB_ROOTS } from './lib/nav.js'

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
import Feed from './pages/Feed.jsx'
import Explore from './pages/Explore.jsx'
import Curate from './pages/Curate.jsx'
import Stats from './pages/Stats.jsx'

export default function App() {
  // 'verifying' → checking the saved address is reachable; 'setup' → ask for it;
  // 'ready' → connected, show the app.
  const [phase, setPhase] = useState(hasServerBase() ? 'verifying' : 'setup')
  const setProfile = useVaultStore(s => s.setProfile)

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => gamiApi.profile().then(r => r.data),
    enabled: phase === 'ready',
  })
  useEffect(() => { if (profile) setProfile(profile) }, [profile, setProfile])

  const { data: tasks } = useQuery({
    queryKey: ['task-queue'],
    queryFn: () => tasksApi.queue().then(r => r.data),
    enabled: phase === 'ready',
    retry: false,
    refetchInterval: query => query.state.data?.current || query.state.data?.queued?.length ? 1200 : 8000,
  })
  const taskRefresh = useRef(null)
  if (!taskRefresh.current) taskRefresh.current = createTaskRefreshTracker(queryClient)
  useEffect(() => { void taskRefresh.current(tasks).catch(() => {}) }, [tasks])

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
  }, [phase, setProfile])

  // Pairing QR from the desktop app (Settings → System) opens
  // thevault://connect?server=http://… — save that address and reconnect.
  useEffect(() => {
    let remove
    const pair = (raw) => {
      try {
        const server = new URL(raw).searchParams.get('server')
        if (!server || !/^https?:\/\//i.test(server)) return
        setServerBase(server)
        refreshApiBase()
        queryClient.clear()
        setPhase('verifying')
      } catch (_) {}
    }
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App: CapApp } = await import('@capacitor/app')
        const launch = await CapApp.getLaunchUrl()
        if (launch?.url) pair(launch.url)
        const h = await CapApp.addListener('appUrlOpen', ({ url }) => pair(url))
        remove = () => h.remove()
      } catch (_) {}
    })()
    return () => remove?.()
  }, [])

  // Reopening the app lands where you left off: the tab you were in, and the
  // page you had open inside it (with the tab's root underneath, so back works).
  const nav = useNavigate()
  const location = useLocation()
  const resumed = useRef(false)
  useEffect(() => {
    if (phase !== 'ready' || resumed.current) return
    resumed.current = true
    if (location.pathname !== '/' || location.search) return
    const { current, last } = launchTabs
    const root = TAB_ROOTS.includes(current) ? current : '/'
    const page = last?.[root]
    if (root !== '/') nav(root, { replace: true })
    if (page && page !== root && !isFullscreenPath(page.split('?')[0])) nav(page, { state: { tab: root } })
  }, [phase])

  // Android hardware back button: close the open sheet/viewer first, then go
  // back inside the app, then fall back to Home, and only exit from Home.
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  useEffect(() => {
    let remove
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App: CapApp } = await import('@capacitor/app')
        const h = await CapApp.addListener('backButton', () => {
          if (closeTopOverlay()) return
          if (canGoBack()) window.history.back()
          else if (pathRef.current !== '/') nav('/', { replace: true })
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
function AnimatedRoutes() {
  const location = useLocation()
  useScrollMemory()
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
      <Route path="/feed"                   element={<Feed />} />
      <Route path="/explore"                element={<Explore />} />
      <Route path="/curate"                 element={<Curate />} />
      <Route path="/stats"                  element={<Stats />} />
    </Routes>
  )

  if (isFullscreenPath(location.pathname)) return routes

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        data-route={location.pathname}
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
