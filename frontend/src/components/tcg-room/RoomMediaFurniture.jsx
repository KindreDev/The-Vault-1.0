import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { tcgV2Api } from '../../lib/api'
import RoomCardSurface from './RoomCardSurface'
import { FLIP_BIN, LECTERN, SCREEN_FRAMES } from './roomLayout'
import { loadSourceImages, savedSource, sourceKey, useFlipBinImages } from './roomMedia'
import { posterImageUrl, textureFromImage, usePosterTexture } from './RoomPosterDisplays'

/** World placement of a room item as a group. */
function Placed({ placement, children }) {
  const p = placement.transform?.position || {}
  const r = placement.transform?.rotation || {}
  return <group position={[p.x || 0, p.y || 0, p.z || 0]} rotation={[r.x || 0, r.y || 0, r.z || 0]}>{children}</group>
}

// ── Screens ────────────────────────────────────────────────────────────────

const FADE_SECONDS = .8

function loadTexture(imageId, frame, fit) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => { try { resolve(textureFromImage(image, frame, fit)) } catch (error) { reject(error) } }
    image.onerror = reject
    image.src = posterImageUrl(imageId)
  })
}

function shuffled(items) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

/** Photos from the screen's source cross-fading every few seconds. */
function Slideshow({ frame, source, interval, fit }) {
  const { data: photos = [] } = useQuery({
    queryKey: ['room-screen-photos', sourceKey(source)],
    queryFn: async () => shuffled(await loadSourceImages(source)),
    staleTime: 10 * 60_000,
  })
  const [slides, setSlides] = useState({ current: null, previous: null })
  // Every texture this screen made; anything older than the two on show is
  // released, and all of them when the screen goes away.
  const made = useRef([])
  const fade = useRef(1)
  const currentMaterial = useRef(null)
  const previousMaterial = useRef(null)
  useEffect(() => {
    if (!photos.length) return undefined
    let index = 0
    let cancelled = false
    const show = async () => {
      const photo = photos[index % photos.length]
      index += 1
      try {
        const texture = await loadTexture(photo.id, frame, fit)
        if (cancelled) { texture.dispose(); return }
        fade.current = 0
        made.current.push(texture)
        while (made.current.length > 2) made.current.shift().dispose()
        setSlides(state => ({ current: texture, previous: state.current }))
      } catch { /* skip a photo that fails to load */ }
    }
    show()
    const timer = window.setInterval(show, Math.max(3, interval || 8) * 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [photos, frame, fit, interval])
  useEffect(() => () => { made.current.forEach(texture => texture.dispose()); made.current = [] }, [])
  useFrame((_, delta) => {
    if (fade.current >= 1) return
    fade.current = Math.min(1, fade.current + delta / FADE_SECONDS)
    if (currentMaterial.current) currentMaterial.current.opacity = fade.current
    if (previousMaterial.current) previousMaterial.current.opacity = 1 - fade.current
  })
  return <>
    {slides.previous && <mesh renderOrder={3}>
      <planeGeometry args={[frame.width, frame.height]} />
      <meshBasicMaterial ref={previousMaterial} key={slides.previous.uuid} map={slides.previous} transparent toneMapped={false} depthWrite={false} />
    </mesh>}
    {slides.current && <mesh position={[0, 0, .0004]} renderOrder={4}>
      <planeGeometry args={[frame.width, frame.height]} />
      <meshBasicMaterial ref={currentMaterial} key={slides.current.uuid} map={slides.current} transparent opacity={0} toneMapped={false} />
    </mesh>}
  </>
}

/** One Vault video, muted and looping, fitted inside the screen. */
function ScreenVideo({ frame, videoId }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = `/api/images/${encodeURIComponent(videoId)}/file`
    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    const ready = () => {
      const aspect = (video.videoWidth || 16) / (video.videoHeight || 9)
      const scale = Math.min(frame.width / aspect, frame.height)
      setState({ texture, width: scale * aspect, height: scale })
      video.play().catch(() => {})
    }
    video.addEventListener('loadedmetadata', ready)
    video.load()
    return () => {
      video.removeEventListener('loadedmetadata', ready)
      video.pause()
      video.removeAttribute('src')
      video.load()
      texture.dispose()
      setState(null)
    }
  }, [frame, videoId])
  if (!state) return null
  return <mesh position={[0, 0, .0004]} renderOrder={4}>
    <planeGeometry args={[state.width, state.height]} />
    <meshBasicMaterial map={state.texture} toneMapped={false} />
  </mesh>
}

function Screen({ placement, assetId }) {
  const frame = SCREEN_FRAMES[assetId]
  const content = placement.transform?.content || {}
  const fit = content.fit || frame.fit
  return <Placed placement={placement}>
    <group position={[0, frame.y, frame.z + .0006]}>
      {/* Black picture area behind letterboxed photos and videos. */}
      <mesh renderOrder={2}>
        <planeGeometry args={[frame.width, frame.height]} />
        <meshBasicMaterial color="#020203" toneMapped={false} />
      </mesh>
      {content.screen_mode === 'video' && content.video_id
        ? <ScreenVideo frame={frame} videoId={content.video_id} />
        : <Slideshow frame={frame} source={savedSource(content)} interval={content.interval || 8} fit={fit} />}
    </group>
  </Placed>
}

// ── Poster flip bin ────────────────────────────────────────────────────────

const BOARD_FRAME = Object.freeze({ width: FLIP_BIN.width, height: FLIP_BIN.height, fit: 'cover' })

function FlipBoard({ index, imageId }) {
  const texture = usePosterTexture(imageId, BOARD_FRAME, 'cover')
  const bottomZ = FLIP_BIN.frontZ - index * FLIP_BIN.spacing
  const half = FLIP_BIN.height / 2
  return <group
    position={[0, FLIP_BIN.floorY + half * Math.cos(FLIP_BIN.lean), bottomZ - half * Math.sin(FLIP_BIN.lean)]}
    rotation={[-FLIP_BIN.lean, 0, 0]}>
    <mesh position={[0, 0, -.003]}>
      <boxGeometry args={[FLIP_BIN.width, FLIP_BIN.height, .004]} />
      <meshStandardMaterial color="#1b1820" roughness={.8} />
    </mesh>
    {texture && <mesh renderOrder={3}>
      <planeGeometry args={[FLIP_BIN.width, FLIP_BIN.height]} />
      <meshBasicMaterial key={texture.uuid} map={texture} toneMapped={false} />
    </mesh>}
  </group>
}

function FlipBin({ placement }) {
  const content = placement.transform?.content || {}
  const ids = useFlipBinImages(content)
  const front = ids.length ? (content.front || 0) % ids.length : 0
  // Only the three front posters are visible enough to need their photo.
  return <Placed placement={placement}>
    {Array.from({ length: FLIP_BIN.boards }, (_, index) => {
      const imageId = index < 3 && index < ids.length ? ids[(front + index) % ids.length] : null
      return <FlipBoard key={index} index={index} imageId={imageId} />
    })}
  </Placed>
}

// ── Binder lectern ─────────────────────────────────────────────────────────

function LecternBinder({ placement, instanceId, quality }) {
  const content = placement.transform?.content || {}
  const { data: binders = [] } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(r => r.data), staleTime: 60_000 })
  const binderId = content.binder_id || binders[0]?.id
  const { data: binder } = useQuery({ queryKey: ['tcg-v2-binder', binderId], queryFn: () => tcgV2Api.binder(binderId).then(r => r.data), enabled: Boolean(binderId), staleTime: 30_000 })
  const spread = content.spread || 0
  const cards = useMemo(() => (binder?.slots || []).filter(slot => slot.card && (slot.page_number === spread * 2 + 1 || slot.page_number === spread * 2 + 2)).map(slot => {
    const side = slot.page_number === spread * 2 + 1 ? -1 : 1
    const row = Math.floor((slot.slot_number - 1) / 3)
    const col = (slot.slot_number - 1) % 3
    return {
      key: `${slot.page_number}-${slot.slot_number}`,
      position: [side * LECTERN.pageX + (col - 1) * LECTERN.pocketX, LECTERN.cardY, (row - 1) * LECTERN.pocketZ],
      item: {
        copy: { id: `lectern-${instanceId}-${slot.page_number}-${slot.slot_number}`, location_kind: 'binder' },
        card: slot.card, surface: 'lectern',
        preview: { card_id: slot.card.id, title: slot.card.display_name },
      },
    }
  }), [binder, instanceId, spread])
  return <Placed placement={placement}>
    <group position={LECTERN.pivot} rotation={[LECTERN.tilt, 0, 0]}>
      {cards.map(card => <RoomCardSurface key={card.key} item={card.item} position={card.position} rotation={[-Math.PI / 2, 0, 0]}
        distance={1.6} quality={quality} facePlanePosition={-.0032} />)}
    </group>
  </Placed>
}

// ── All of them ────────────────────────────────────────────────────────────

export default function RoomMediaFurniture({ bootstrap, activeInstanceId = null, quality = 'high' }) {
  const placed = useMemo(() => {
    const definitions = new Map((bootstrap?.catalog || []).map(item => [item.id, item]))
    return (bootstrap?.room?.placements || []).map(row => {
      if (row.instance_id === activeInstanceId) return null
      const instance = bootstrap?.owned_instances?.find(value => value.id === row.instance_id)
      const assetId = definitions.get(instance?.definition_id)?.asset_id
      return assetId && (SCREEN_FRAMES[assetId] || assetId === 'poster_flip_bin' || assetId === 'binder_lectern') ? { row, assetId } : null
    }).filter(Boolean)
  }, [activeInstanceId, bootstrap])
  return <group name="room-media-furniture">
    {placed.map(({ row, assetId }) => {
      if (SCREEN_FRAMES[assetId]) return <Screen key={row.instance_id} placement={row} assetId={assetId} />
      if (assetId === 'poster_flip_bin') return <FlipBin key={row.instance_id} placement={row} />
      return <LecternBinder key={row.instance_id} placement={row} instanceId={row.instance_id} quality={quality} />
    })}
  </group>
}
