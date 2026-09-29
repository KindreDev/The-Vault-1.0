import { LocalizedText, useT } from '../../i18n'
import { Html } from '@react-three/drei'
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Check, RotateCw, Undo2, X } from 'lucide-react'

/**
 * World-attached placement controls. The DOM is projected by drei from the
 * same transform that drives PlacementGhost, so the controls follow the real
 * item instead of becoming a second screen-pinned placement UI.
 */
export default function PlacementContextOverlay({ preview, onPlace, onReturn, onRotate, onDeselect }) {
  const t = useT()
  const { camera } = useThree()
  const hudAnchor = useRef(null)
  const cameraRight = useRef(new THREE.Vector3())
  const definition = preview?.definition || {}
  const footprint = definition.footprint || {}
  const height = Math.max(.5, Number(footprint.height || 1))
  const position = preview?.transform?.position
  const offsetX = Math.max(1.15, Number(footprint.width || .6) * .72 + .55)
  const offsetY = Math.max(.62, height * .58)

  useFrame(() => {
    if (!hudAnchor.current || !position) return
    cameraRight.current.set(1, 0, 0).applyQuaternion(camera.quaternion)
    cameraRight.current.y = 0
    if (cameraRight.current.lengthSq() < .0001) cameraRight.current.set(1, 0, 0)
    else cameraRight.current.normalize()
    hudAnchor.current.position.set(cameraRight.current.x * offsetX, offsetY, cameraRight.current.z * offsetX)
  })

  if (!position) return null

  return <group position={[position.x, position.y, position.z]}>
    <group ref={hudAnchor} position={[offsetX, offsetY, 0]}>
      <Html center occlude={false} zIndexRange={[80, 0]} className="placement-context-hud">
      <div className="placement-context-hud__content" onPointerDown={event => event.stopPropagation()}>
        <section className="placement-context-hud__info" aria-label={t("Placement status")}>
          <strong>{definition.name || 'Furniture'}</strong>
        </section>

        <section className="placement-context-hud__wheel" aria-label={t("Placement actions")}>
          <button
            type="button"
            className="placement-context-hud__action placement-context-hud__action--place"
            onClick={onPlace}
            disabled={!preview.valid || !preview.locked}
            aria-label={t("Place")}
            title={!preview.valid ? 'This position is not valid' : preview.locked ? 'Place furniture' : 'Click the scene to lock this position first'}
          >
            <Check size={25} />
          </button>
          <span className="placement-context-hud__action-label placement-context-hud__action-label--place" aria-hidden="true"><LocalizedText text={"Place"} /></span>
          <button type="button" className="placement-context-hud__action placement-context-hud__action--return" onClick={onReturn} aria-label={t("Return")} title={t("Return to inventory")}>
            <Undo2 size={25} />
          </button>
          <span className="placement-context-hud__action-label placement-context-hud__action-label--return" aria-hidden="true"><LocalizedText text={"Return"} /></span>
          <button type="button" className="placement-context-hud__action placement-context-hud__action--rotate" onClick={onRotate} aria-label={t("Rotate")} title={t("Rotate furniture")}>
            <RotateCw size={25} />
          </button>
          <span className="placement-context-hud__action-label placement-context-hud__action-label--rotate" aria-hidden="true"><LocalizedText text={"Rotate"} /></span>
          <button type="button" className="placement-context-hud__action placement-context-hud__action--deselect" onClick={onDeselect} aria-label={t("Deselect")} title={t("Deselect furniture")}>
            <X size={25} />
          </button>
          <span className="placement-context-hud__action-label placement-context-hud__action-label--deselect" aria-hidden="true"><LocalizedText text={"Deselect"} /></span>
        </section>
      </div>
      </Html>
    </group>
  </group>
}
