import React, { useEffect, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './Sidebar'
import XPToastLayer from '../gamification/XPToastLayer'
import LevelUpOverlay from '../LevelUpOverlay'
import ErrorBoundary from '../ErrorBoundary'
import CompanionBubble from '../companion/CompanionBubble'
import { useVaultStore, loadGlassBackground } from '../../store/vault'

export default function Layout() {
  const sessionActive          = useVaultStore(s => s.sessionActive)
  const showGoonBorder         = useVaultStore(s => s.showGoonBorder)
  const applyStoredPalette     = useVaultStore(s => s.applyStoredPalette)
  const multiPanelFullscreen   = useVaultStore(s => s.multiPanelFullscreen)
  const location = useLocation()

  // Apply saved palette on first mount so colors are correct immediately
  useEffect(() => {
    applyStoredPalette()
    loadGlassBackground()
  }, [])

  // F11 — true OS-level fullscreen (hides taskbar + title bar)
  // In EXE mode (PyWebView) we call the native window API exposed via js_api.
  // In dev mode (browser) we fall back to the web Fullscreen API.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'F11') return
      e.preventDefault()
      if (window.pywebview?.api?.toggle_fullscreen) {
        window.pywebview.api.toggle_fullscreen()
      } else {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {})
        } else {
          document.exitFullscreen().catch(() => {})
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Global image fade-in: mark images as loaded so they transition opacity 0→1
  useEffect(() => {
    function onImgLoad(e) {
      const img = e.target
      if (img.tagName === 'IMG' && !img.dataset.noFade) {
        img.classList.add('img-loaded')
      }
    }
    // Capture phase so we catch load from every nested img in the tree
    document.addEventListener('load', onImgLoad, true)
    // Mark already-cached images immediately
    const markCached = () => {
      document.querySelectorAll('img:not([data-no-fade])').forEach(img => {
        if (img.complete && img.naturalWidth > 0) img.classList.add('img-loaded')
      })
    }
    markCached()
    const t = setTimeout(markCached, 80) // catch late-mounting components
    return () => {
      document.removeEventListener('load', onImgLoad, true)
      clearTimeout(t)
    }
  }, [])

  // Use the primary path segment to trigger animations when switching pages
  const pageKey = location.pathname.split('/')[1] || '/'

  // Multi-panel viewer must not have a scrollable main — scroll events
  // need to reach the panels uninterrupted so wheel zoom works.
  const isMultiPanel = location.pathname.startsWith('/multi-panel')

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--c-bg)' }}>
      {!multiPanelFullscreen && <Sidebar />}
      <main className={`flex-1 min-w-0 bg-[var(--c-bg)] ${isMultiPanel ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pageKey}
            initial={{ y: 10 }}
            animate={{ y: 0 }}
            exit={{ y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="h-full min-h-full"
          >
            {/* ErrorBoundary: a JS crash in one page won't white-screen the app */}
            <ErrorBoundary>
              {/* Suspense catches lazy-loaded page chunks */}
              <Suspense fallback={
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col gap-3 items-center" style={{ opacity: 0.3 }}>
                    <div className="skeleton" style={{ width: 160, height: 16, borderRadius: 8 }} />
                    <div className="skeleton" style={{ width: 100, height: 12, borderRadius: 8 }} />
                  </div>
                </div>
              }>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>
      <XPToastLayer />
      <LevelUpOverlay />
      <CompanionBubble />

      {/* Neon goon-mode border — fixed overlay, pointer-events none */}
      {sessionActive && showGoonBorder && (
        <div className="fixed inset-0 z-[9998] goon-border" />
      )}
    </div>
  )
}
