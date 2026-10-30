import { useT } from '../../i18n'
import { Html } from '@react-three/drei'
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const projected = new THREE.Vector3()
const HUD_GAP = 210

/**
 * World-attached name tag for the carried item, showing why a spot is not
 * valid.  It is pushed sideways in screen space so it never covers the item,
 * and flips to the item's left side when the item is near the right edge.
 */
export default function PlacementContextOverlay({ preview }) {
  const t = useT()
  const { camera } = useThree()
  const content = useRef(null)
  const anchor = useRef(null)
  const side = useRef(1)
  const definition = preview?.definition || {}
  const footprint = definition.footprint || {}
  const height = Math.max(.4, Number(footprint.height || 1))
  const position = preview?.transform?.position
  const wall = definition.placement_kind === 'wall'

  useFrame(() => {
    if (!content.current || !anchor.current) return
    anchor.current.getWorldPosition(projected).project(camera)
    const next = side.current > 0 ? (projected.x > .38 ? -1 : 1) : (projected.x < .1 ? 1 : -1)
    if (next !== side.current || !content.current.dataset.side) {
      side.current = next
      content.current.dataset.side = next > 0 ? 'right' : 'left'
      content.current.style.translate = `${next * HUD_GAP}px -20px`
    }
  })

  if (!position) return null

  return <group position={[position.x, position.y, position.z]}>
    <group ref={anchor} position={[0, wall ? 0 : height * .55, 0]}>
      <Html center occlude={false} zIndexRange={[80, 0]} className="placement-context-hud">
      <div ref={content} className="placement-context-hud__content" onPointerDown={event => event.stopPropagation()}>
        <section className="placement-context-hud__info" aria-label={t("Placement status")}>
          <strong>{definition.name || 'Furniture'}</strong>
          {!preview.valid && preview.reason && <small className="placement-context-hud__reason">{t(preview.reason)}</small>}
        </section>
      </div>
      </Html>
    </group>
  </group>
}
