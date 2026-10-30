import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LIGHTING_MOODS } from './roomLightingSettings'
import { roomQualityProfile } from './roomQuality'

// Ceiling cove LED runs on the inner faces of the main room's walls.
// [start, end, inward normal] in world XZ; the ceiling underside is y≈2.96.
const LED_RUNS = Object.freeze([
  [[-4.97, -4.97], [-4.97, 1.9], [1, 0]],
  [[3.97, -4.97], [3.97, 1.9], [-1, 0]],
  [[-4.97, -4.97], [3.97, -4.97], [0, 1]],
  [[-4.97, 1.9], [1.93, 1.9], [0, -1]],
])
const STRIP_Y = 2.9
const WASH_HEIGHT = .75
const ACCENT_LIGHTS = Object.freeze([[-4.2, 2.55, -.2], [3.2, 2.55, -.2], [-.4, 2.55, -4.2]])
const LAMP_LIGHTS = Object.freeze([[-.5, 2.4, 0], [-1.2, 2.4, -3.6]])
const TRANSITION_RATE = 3.2
const SHADOW_REFRESH_SECONDS = 1.5

function washTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createLinearGradient(0, 0, 0, 128)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(.18, 'rgba(255,255,255,.55)')
  gradient.addColorStop(.55, 'rgba(255,255,255,.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 4, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// One merged mesh for every LED strip and one for every glow wash, so the
// whole accent installation costs two draw calls.
function buildLedGeometry() {
  const strips = []
  const washes = []
  for (const [[ax, az], [bx, bz], [nx, nz]] of LED_RUNS) {
    const length = Math.hypot(bx - ax, bz - az)
    const cx = (ax + bx) / 2
    const cz = (az + bz) / 2
    const yaw = Math.atan2(nx, nz)
    const strip = new THREE.BoxGeometry(length, .022, .018)
    // BoxGeometry's length runs along X; turn it to follow the wall.
    strip.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.abs(nx) > 0 ? Math.PI / 2 : 0))
    strip.applyMatrix4(new THREE.Matrix4().makeTranslation(cx + nx * .02, STRIP_Y, cz + nz * .02))
    strips.push(strip)
    const wall = new THREE.PlaneGeometry(length, WASH_HEIGHT)
    wall.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw))
    wall.applyMatrix4(new THREE.Matrix4().makeTranslation(cx + nx * .012, STRIP_Y - WASH_HEIGHT / 2 + .02, cz + nz * .012))
    washes.push(wall)
    const ceiling = new THREE.PlaneGeometry(length, .55)
    // Lie flat; the gradient's bright (top) edge ends up against the wall.
    ceiling.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
    ceiling.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw))
    ceiling.applyMatrix4(new THREE.Matrix4().makeTranslation(cx + nx * .285, 2.952, cz + nz * .285))
    washes.push(ceiling)
  }
  const stripGeometry = mergeGeometries(strips, false)
  const washGeometry = mergeGeometries(washes, false)
  strips.forEach(item => item.dispose())
  washes.forEach(item => item.dispose())
  return { stripGeometry, washGeometry }
}

/**
 * A procedural studio environment: generated once, no network, no per-frame
 * cost.  It gives metal, glass and varnish something to reflect.  Call it
 * when the WebGL context is created, before anything else renders: built
 * later, textures already uploaded (poster prints) could render blank white.
 */
export function installRoomEnvironment(gl, scene) {
  if (scene.userData.vaultEnvironment) return
  const generator = new THREE.PMREMGenerator(gl)
  const source = new RoomEnvironment()
  const target = generator.fromScene(source, .04)
  source.traverse(node => { node.geometry?.dispose?.(); node.material?.dispose?.() })
  generator.dispose()
  scene.environment = target.texture
  scene.userData.vaultEnvironment = target
}

function useRoomEnvironmentCleanup() {
  const { scene } = useThree()
  useEffect(() => () => {
    const target = scene.userData.vaultEnvironment
    if (target && scene.environment === target.texture) scene.environment = null
    target?.dispose()
    delete scene.userData.vaultEnvironment
  }, [scene])
}

/**
 * The room's light rig.  Shadows come from one directional light and are
 * rendered into a static shadow map that only refreshes when the room changes
 * (plus a slow safety refresh), instead of re-rendering every frame.
 */
export default function RoomLighting({ quality, lighting, shadowToken }) {
  const profile = roomQualityProfile(quality)
  const { gl, scene } = useThree()
  const mood = LIGHTING_MOODS[lighting.mood] || LIGHTING_MOODS.day
  const sun = useRef(null)
  const fill = useRef(null)
  const hemisphere = useRef(null)
  const ambient = useRef(null)
  const lamps = useRef([])
  const accents = useRef([])
  const shadowFrames = useRef(120)
  const shadowClock = useRef(0)
  const live = useRef(null)
  const initial = useRef({ mood, lighting })
  const scratch = useMemo(() => new THREE.Color(), [])
  const accentColor = useMemo(() => new THREE.Color(), [])
  const tintColor = useMemo(() => new THREE.Color(), [])
  const tintTarget = useMemo(() => new THREE.Color(), [])
  const led = useMemo(buildLedGeometry, [])
  const wash = useMemo(washTexture, [])
  const stripMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), [])
  const washMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff', map: wash, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }), [wash])
  useRoomEnvironmentCleanup()

  useEffect(() => () => {
    led.stripGeometry.dispose(); led.washGeometry.dispose()
    wash.dispose(); stripMaterial.dispose(); washMaterial.dispose()
  }, [led, stripMaterial, wash, washMaterial])

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => { gl.shadowMap.autoUpdate = true }
  }, [gl])
  useEffect(() => { shadowFrames.current = 45 }, [shadowToken, lighting.mood, quality])

  useFrame((state, delta) => {
    const step = 1 - Math.exp(-TRANSITION_RATE * Math.min(delta, .1))
    if (!live.current) {
      live.current = { sky: new THREE.Color(mood.sky), exposure: mood.exposure, environment: mood.environment, sunPosition: new THREE.Vector3(...mood.sun.position) }
      scene.background = live.current.sky
    }
    const current = live.current
    current.sky.lerp(scratch.set(mood.sky), step)
    scene.background = current.sky
    current.exposure += (mood.exposure - current.exposure) * step
    gl.toneMappingExposure = current.exposure
    current.environment += (mood.environment - current.environment) * step
    scene.environmentIntensity = current.environment

    if (sun.current) {
      sun.current.intensity += (mood.sun.intensity - sun.current.intensity) * step
      const target = current.sunPosition
      const goal = mood.sun.position
      if (Math.abs(target.x - goal[0]) + Math.abs(target.y - goal[1]) + Math.abs(target.z - goal[2]) > .01) {
        target.x += (goal[0] - target.x) * step; target.y += (goal[1] - target.y) * step; target.z += (goal[2] - target.z) * step
        sun.current.position.copy(target)
        shadowFrames.current = Math.max(shadowFrames.current, 2)
      }
    }
    // Room tint: blend each light's mood colour towards the chosen colour.
    // Window daylight takes only a little of it so day still reads as day.
    const accentNow = lighting.accent
    if (accentNow.mode === 'cycle') accentColor.setHSL((state.clock.elapsedTime * .035) % 1, .85, .58)
    else accentColor.set(accentNow.color)
    const tint = lighting.tint || {}
    const tintAmount = tint.mode === 'natural' || !tint.mode ? 0 : (tint.strength ?? .5)
    if (tintAmount) tintColor.copy(tint.mode === 'led' ? accentColor : scratch.set(tint.color))
    const tinted = (base, share = 1) => {
      tintTarget.set(base)
      return tintAmount ? tintTarget.lerp(tintColor, tintAmount * share) : tintTarget
    }
    const follow = tint.mode === 'led' && accentNow.mode === 'cycle' ? 1 : step
    if (sun.current) sun.current.color.lerp(tinted(mood.sun.color, .2), follow)
    if (ambient.current) ambient.current.color.lerp(tinted('#fff7e8'), follow)
    if (fill.current) {
      fill.current.color.lerp(tinted(mood.fill.color, .7), follow)
      fill.current.intensity += (mood.fill.intensity - fill.current.intensity) * step
    }
    if (hemisphere.current) {
      hemisphere.current.color.lerp(tinted(mood.hemisphere.sky, .85), follow)
      hemisphere.current.groundColor.lerp(tinted(mood.hemisphere.ground, .6), follow)
      hemisphere.current.intensity += (mood.hemisphere.intensity - hemisphere.current.intensity) * step
    }
    if (ambient.current) ambient.current.intensity += (mood.ambient - ambient.current.intensity) * step
    const lampGoal = lighting.ceiling ? mood.lamp.intensity : 0
    lamps.current.forEach(lamp => {
      if (!lamp) return
      lamp.color.lerp(tinted(mood.lamp.color), follow)
      lamp.intensity += (lampGoal - lamp.intensity) * step
    })

    const accent = accentNow
    const level = accent.enabled ? accent.brightness : 0
    const accentGoal = level * mood.accentBoost * 2.4
    accents.current.forEach(light => {
      if (!light) return
      light.color.lerp(accentColor, accent.mode === 'cycle' ? 1 : step)
      light.intensity += (accentGoal - light.intensity) * step
    })
    stripMaterial.color.copy(accentColor).multiplyScalar(.25 + level * 1.15)
    const washGoal = level * (.32 + mood.accentBoost * .28)
    washMaterial.color.copy(accentColor)
    washMaterial.opacity += (washGoal - washMaterial.opacity) * step

    if (profile.shadows) {
      shadowClock.current += delta
      if (shadowFrames.current > 0 || shadowClock.current > SHADOW_REFRESH_SECONDS) {
        gl.shadowMap.needsUpdate = true
        shadowClock.current = 0
        if (shadowFrames.current > 0) shadowFrames.current -= 1
      }
    }
  })

  // JSX props only seed the lights; useFrame animates every change so a new
  // mood fades in instead of snapping.
  const seed = initial.current
  const size = profile.shadowMapSize
  return <>
    <hemisphereLight ref={hemisphere} intensity={seed.mood.hemisphere.intensity} color={seed.mood.hemisphere.sky} groundColor={seed.mood.hemisphere.ground} />
    <ambientLight ref={ambient} intensity={seed.mood.ambient} color="#fff7e8" />
    <directionalLight ref={sun} position={seed.mood.sun.position} intensity={seed.mood.sun.intensity} color={seed.mood.sun.color}
      castShadow={profile.shadows} shadow-mapSize-width={size} shadow-mapSize-height={size} shadow-bias={-.0004} shadow-normalBias={.025} shadow-radius={3}
      shadow-camera-near={1} shadow-camera-far={28} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <directionalLight ref={fill} position={[0, 4.8, -7]} intensity={seed.mood.fill.intensity} color={seed.mood.fill.color} />
    {LAMP_LIGHTS.map((position, index) => <pointLight key={`lamp-${index}`} ref={node => { lamps.current[index] = node }} position={position}
      intensity={seed.lighting.ceiling ? seed.mood.lamp.intensity : 0} distance={9} decay={1.6} color={seed.mood.lamp.color} />)}
    {ACCENT_LIGHTS.map((position, index) => <pointLight key={`accent-${index}`} ref={node => { accents.current[index] = node }} position={position}
      intensity={0} distance={6.5} decay={1.7} color={seed.lighting.accent.color} />)}
    <mesh geometry={led.stripGeometry} material={stripMaterial} frustumCulled={false} />
    <mesh geometry={led.washGeometry} material={washMaterial} frustumCulled={false} renderOrder={2} />
  </>
}
