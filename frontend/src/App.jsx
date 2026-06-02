import React, { useEffect, useRef, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Layout from './components/layout/Layout'
import { gamiApi } from './lib/api'
import { useVaultStore } from './store/vault'
import { xpEvents } from './lib/xpEvents'
import queryClient from './lib/queryClient'

// ── Route-level code splitting ────────────────────────────────────────────────
// Each page becomes its own chunk — only downloaded when first visited.
const Dashboard     = lazy(() => import('./pages/Dashboard'))
const GalleryList   = lazy(() => import('./pages/GalleryList'))
const GalleryView   = lazy(() => import('./pages/GalleryView'))
const CreatorList   = lazy(() => import('./pages/CreatorList'))
const CreatorProfile = lazy(() => import('./pages/CreatorProfile'))
const ImageList     = lazy(() => import('./pages/ImageList'))
const TagManager    = lazy(() => import('./pages/TagManager'))
const MultiPanel    = lazy(() => import('./pages/MultiPanel'))
const DeviceControl = lazy(() => import('./pages/DeviceControl'))
const Collection    = lazy(() => import('./pages/Collection'))
const Profile       = lazy(() => import('./pages/Profile'))
const PlaylistView  = lazy(() => import('./pages/PlaylistView'))
const HallOfFame    = lazy(() => import('./pages/HallOfFame'))
const Duplicates    = lazy(() => import('./pages/Duplicates'))
const TaskQueue     = lazy(() => import('./pages/TaskQueue'))
// Named exports need a .then() shim
const Quests     = lazy(() => import('./pages/pages').then(m => ({ default: m.Quests })))
const Stats      = lazy(() => import('./pages/pages').then(m => ({ default: m.Stats })))
const Settings   = lazy(() => import('./pages/pages').then(m => ({ default: m.Settings })))
const XPHistory  = lazy(() => import('./pages/pages').then(m => ({ default: m.XPHistory })))
const ScanLog    = lazy(() => import('./pages/pages').then(m => ({ default: m.ScanLog })))
const Console    = lazy(() => import('./pages/Console'))
const Help       = lazy(() => import('./pages/Help'))

export default function App() {
  const setProfile         = useVaultStore(s => s.setProfile)
  const setAccentColor     = useVaultStore(s => s.setAccentColor)
  const applyStoredPalette = useVaultStore(s => s.applyStoredPalette)
  const loginFiredRef      = useRef(false)
  const testOverlayRef     = useRef(false)   // set by URL param, consumed on first profile load

  // Apply saved palette immediately on mount
  useEffect(() => {
    applyStoredPalette()
  }, [])

  // Dev shortcut: open /?_testlevelup=1 to preview the level-up overlay
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('_testlevelup')) {
      window.history.replaceState({}, '', window.location.pathname)
      testOverlayRef.current = true
    }
  }, [])

  // Level-up overlay — fires when the interceptor emits a level_up event
  useEffect(() => {
    return xpEvents.subscribe(({ xpEvt }) => {
      if (xpEvt?.level_up) {
        useVaultStore.getState().triggerLevelUp(xpEvt.level, xpEvt.title || '')
      }
    })
  }, [])

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => gamiApi.profile().then(r => r.data),
    staleTime: 5 * 60 * 1000,  // profile rarely changes — don't refetch on every route change
  })

  useEffect(() => {
    if (profile) {
      setProfile(profile)
      if (profile.theme_accent) setAccentColor(profile.theme_accent)
      if (!loginFiredRef.current) {
        loginFiredRef.current = true
        gamiApi.login()
      }
      // Fire overlay test if bat opened /?_testlevelup=1
      if (testOverlayRef.current) {
        testOverlayRef.current = false
        useVaultStore.getState().triggerLevelUp(
          (profile.level ?? 0) + 1,
          profile.level_title ?? 'Level Up!'
        )
      }
    }
  }, [profile])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          {/* All routes are lazy — Suspense in Layout catches the loading state */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"    element={<Dashboard />} />
          <Route path="galleries"    element={<GalleryList />} />
          <Route path="galleries/:id" element={<GalleryView />} />
          <Route path="images"       element={<ImageList />} />
          <Route path="videos"       element={<ImageList onlyVideos />} />
          <Route path="creators"     element={<CreatorList />} />
          <Route path="creators/:id" element={<CreatorProfile />} />
          <Route path="multi-panel"     element={<MultiPanel />} />
          <Route path="device-control"  element={<DeviceControl />} />
          <Route path="quests"       element={<Quests />} />
          <Route path="stats"        element={<Stats />} />
          <Route path="xp-history"   element={<XPHistory />} />
          <Route path="settings"     element={<Settings />} />
          <Route path="scan-log"     element={<ScanLog />} />
          <Route path="collection"   element={<Collection />} />
          <Route path="profile"      element={<Profile />} />
          <Route path="playlists/:id"  element={<PlaylistView />} />
          <Route path="hall-of-fame"  element={<HallOfFame />} />
          <Route path="tags"          element={<TagManager />} />
          <Route path="duplicates"    element={<Duplicates />} />
          <Route path="task-queue"    element={<TaskQueue />} />
          <Route path="scan-log"      element={<TaskQueue />} />
          <Route path="console"       element={<Console />} />
          <Route path="help"          element={<Help />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
