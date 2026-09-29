import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { themePacksApi } from '../../lib/api'
import { FONTS, themePackFontOption, useVaultStore } from '../../store/vault'

function pageFor(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/dashboard'
  if (path === '/collection/room') return 'collection-room'
  if (/^\/galleries\/[^/]+/.test(path)) return 'gallery-detail'
  if (/^\/creators\/[^/]+/.test(path)) return 'creator-detail'
  if (/^\/playlists\/[^/]+/.test(path)) return 'playlist-detail'
  return path.slice(1)
}

function placementFor(layer, size, bounds, ratio, page, scope = 'page') {
  if (layer.placements?.[size]) return layer.placements[size]
  const base = { x: layer.x, y: layer.y, width: layer.width }
  if (size === 'standard') return base
  const remainingHeight = Math.max(0, bounds.height * (1 - base.y) - 16)
  let width = Math.min(base.width * bounds.width, remainingHeight / ratio)
  if (page === 'help') {
    const content = document.querySelector('.vault-main .max-w-4xl')
    if (content) width = Math.min(width, bounds.width - (content.getBoundingClientRect().right - bounds.left) - 28)
    if (width < 160) return null
    return { x: (bounds.width - width - 16) / bounds.width, y: base.y, width: width / bounds.width }
  }
  width = Math.min(width, bounds.width - 32)
  if (width < (scope === 'page' ? 160 : 40)) return null
  return { x: Math.max(0, Math.min(base.x, (bounds.width - width) / bounds.width)),
    y: base.y, width: width / bounds.width }
}

function openModalHost() {
  const candidates = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .fixed.inset-0')]
    .map(element => element.closest('.fixed.inset-0') || element)
    .filter(element => !element.classList.contains('goon-border') &&
      !element.classList.contains('vault-theme-pack-layer') &&
      element.getBoundingClientRect().width > innerWidth * 0.4 &&
      element.getBoundingClientRect().height > innerHeight * 0.4 &&
      getComputedStyle(element).display !== 'none')
  return candidates.at(-1) || null
}

export default function ThemePackLayer() {
  const palette = useVaultStore(state => state.palette)
  const setFont = useVaultStore(state => state.setFont)
  const location = useLocation()
  const packId = palette.id.startsWith('pack:') && palette.id !== 'pack:private-preview' ? palette.id.slice(5) : null
  const { data } = useQuery({
    queryKey: ['theme-pack', packId],
    queryFn: () => themePacksApi.get(packId).then(response => response.data),
    enabled: !!packId,
    staleTime: 60_000,
  })
  const [bounds, setBounds] = useState(null)
  const [aspects, setAspects] = useState({})
  const [isQueueEmpty, setIsQueueEmpty] = useState(false)
  const [modalHost, setModalHost] = useState(null)

  useEffect(() => {
    if (!packId || !data?.ui?.textures) return
    const textures = data.ui.textures
    const root = document.documentElement
    const slots = ['panel', 'button', 'sidebar']
    const hasTexture = slots.some(slot => !!textures[slot])
    if (!hasTexture) return
    for (const slot of slots) {
      const asset = textures[slot]
      if (asset) root.style.setProperty(`--vault-pack-${slot}-texture`,
        `url("/theme-packs/${encodeURIComponent(packId)}/${asset}")`)
      else root.style.removeProperty(`--vault-pack-${slot}-texture`)
      if (asset) document.body.dataset[`themePack${slot[0].toUpperCase()}${slot.slice(1)}`] = 'true'
      else delete document.body.dataset[`themePack${slot[0].toUpperCase()}${slot.slice(1)}`]
    }
    root.style.setProperty('--vault-pack-edge', data.ui.edge || 'var(--c-amber)')
    document.body.dataset.themePackUi = 'textured'
    return () => {
      slots.forEach(slot => root.style.removeProperty(`--vault-pack-${slot}-texture`))
      slots.forEach(slot => delete document.body.dataset[`themePack${slot[0].toUpperCase()}${slot.slice(1)}`])
      root.style.removeProperty('--vault-pack-edge')
      delete document.body.dataset.themePackUi
    }
  }, [packId, data])

  useEffect(() => {
    const colors = data?.ui?.text || {}
    const root = document.documentElement
    const keys = ['primary', 'secondary', 'muted']
    if (packId && keys.some(key => colors[key])) {
      keys.forEach(key => {
        if (colors[key]) root.style.setProperty(`--vault-pack-text-${key}`, colors[key])
      })
      document.body.dataset.themePackText = 'true'
    }
    return () => {
      keys.forEach(key => root.style.removeProperty(`--vault-pack-text-${key}`))
      delete document.body.dataset.themePackText
    }
  }, [packId, data])

  useEffect(() => {
    if (!packId || !data) return
    const font = data.ui?.font
    const selectedId = `pack:${packId}`
    if (!font) {
      if (localStorage.getItem('vault_font') === selectedId) setFont(FONTS[0])
      return
    }
    const face = document.createElement('style')
    face.id = 'vault-pack-font-face'
    face.textContent = `@font-face { font-family: "VaultPack-${packId}"; src: url("/theme-packs/${encodeURIComponent(packId)}/${font.asset}"); font-style: normal; font-weight: 100 1000; font-display: swap; }`
    document.head.appendChild(face)
    if (localStorage.getItem('vault_font') === selectedId) {
      const option = themePackFontOption(packId, font.label)
      if (useVaultStore.getState().font.label !== option.label) setFont(option)
    }
    return () => face.remove()
  }, [packId, data, setFont])

  useEffect(() => {
    if (!packId) return
    const main = document.querySelector('.vault-main')
    if (!main) return
    const update = () => {
      const rect = main.getBoundingClientRect()
      setBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right })
      setIsQueueEmpty(!!document.querySelector('.vault-theme-task-queue-empty'))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(main)
    window.addEventListener('resize', update)
    const queueObserver = new MutationObserver(update)
    queueObserver.observe(main, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      queueObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [packId, location.pathname])

  useEffect(() => {
    if (!packId) return
    const update = () => setModalHost(previous => {
      const next = openModalHost()
      return previous === next ? previous : next
    })
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [packId, location.pathname])

  useEffect(() => {
    if (!modalHost) return
    modalHost.classList.add('vault-theme-pack-modal-host')
    return () => modalHost.classList.remove('vault-theme-pack-modal-host')
  }, [modalHost])

  if (!packId || !data || !bounds) return null
  const page = pageFor(location.pathname)
  const size = bounds.width < 1500 ? 'compact' : bounds.width >= 3000 ? '4k' : bounds.width >= 1900 ? 'wide' : 'standard'
  const visible = scope => data.layers.filter(layer => (layer.page === page || layer.page === 'all') &&
    (layer.scope || 'page') === scope &&
    (layer.state === 'default' ||
      (page === 'task-queue' && !isQueueEmpty && layer.state === 'busy') ||
      (page === 'erika' && !!document.querySelector('.vault-theme-erika-chat') && layer.state === 'chat') ||
      (page === 'task-queue' && isQueueEmpty && layer.state === 'empty') ||
      (page === 'playlists' && !!document.querySelector('.vault-theme-playlists-empty') && layer.state === 'empty') ||
      (page === 'funscripts' && !!document.querySelector('.fs-playlists') &&
        !document.querySelector('.fs-queue-item') && layer.state === 'empty')))
  const behind = layers => layers.filter(layer => Number(layer.z) <= 0 || !Number.isFinite(Number(layer.z)))
  const inFront = layers => layers.filter(layer => Number(layer.z) > 0)
  const draw = (layers, canvas, scope = 'page') => layers.map(layer => {
    const ratio = aspects[layer.asset] || (page === 'help' ? 1.5 : 0.563)
    const placement = placementFor(layer, size, canvas, ratio, scope === 'page' ? page : null, scope)
    if (!placement) return null
    return <img key={layer.id} alt="" draggable="false"
      src={`/theme-packs/${encodeURIComponent(packId)}/${layer.asset}`}
      onLoad={event => {
        const image = event.currentTarget
        const next = image.naturalHeight / image.naturalWidth
        if (next && aspects[layer.asset] !== next) setAspects(previous => ({ ...previous, [layer.asset]: next }))
      }}
      style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`,
        width: `${placement.width * 100}%`, opacity: layer.opacity,
        zIndex: layer.z || 0,
        transform: `rotate(${layer.rotate || 0}deg) scaleX(${layer.mirror ? -1 : 1})` }} />
  })
  const anchors = [
    ['sidebar-brand', document.querySelector('.vault-app-shell > aside > div:first-child')],
    ['page-heading', (() => {
      const heading = document.querySelector('.vault-main h1:not(.vault-theme-media-header h1)')
      return heading?.closest('[data-theme-heading], header') || heading
    })()],
    ['dashboard-curation', document.querySelector('.vault-theme-dashboard-curation')],
    ['dashboard-session', document.querySelector('.vault-theme-dashboard-session')],
    ['dashboard-tools', document.querySelector('.vault-theme-dashboard-tools')],
  ]
  return (
    <>
    <div className="vault-theme-pack-layer" aria-hidden="true" style={{
      left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
    }}>
      {draw(behind(visible('page')), bounds)}
    </div>
    <div className="vault-theme-pack-front-layer" aria-hidden="true" style={{
      left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
    }}>
      {draw(inFront(visible('page')), bounds)}
    </div>
    {modalHost && visible('modal').length > 0 && createPortal(
      <>
        <div className="vault-theme-pack-modal-layer" aria-hidden="true">
          {draw(behind(visible('modal')), modalHost.getBoundingClientRect(), 'modal')}
        </div>
        <div className="vault-theme-pack-modal-front-layer" aria-hidden="true">
          {draw(inFront(visible('modal')), modalHost.getBoundingClientRect(), 'modal')}
        </div>
      </>, modalHost)}
    {anchors.map(([scope, host]) => host && visible(scope).length > 0 &&
      createPortal(<>
        <span className="vault-theme-pack-anchor-layer" aria-hidden="true">
          {draw(behind(visible(scope)), host.getBoundingClientRect(), scope)}
        </span>
        {inFront(visible(scope)).length > 0 &&
          <span className="vault-theme-pack-anchor-front-layer" aria-hidden="true">
            {draw(inFront(visible(scope)), host.getBoundingClientRect(), scope)}
          </span>}
      </>, host, scope))}
    </>
  )
}
