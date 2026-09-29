import { Component, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import CharacterCard from './CharacterCard'
import CollabCard from './CollabCard'
import CosplayCard from './CosplayCard'
import CreatorCard from './CreatorCard'
import GalleryCard from './GalleryCard'
import BondCard from './BondCard'
import HallOfFameCard from './HallOfFameCard'
import SceneCard from './SceneCard'
import { resolveTCGV2CardFace } from './cardFaceResolver'
import { SignatureOverrideContext } from './SignatureLayer'
import './TCGV2CardFace.css'

const RENDERERS = Object.freeze({
  scene: SceneCard,
  character: CharacterCard,
  cosplay: CosplayCard,
  collab: CollabCard,
  creator: CreatorCard,
  gallery: GalleryCard,
  bond: BondCard,
  'hall-of-fame': HallOfFameCard,
})

class CardFaceBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    this.props.onRenderError?.(error)
  }

  componentDidUpdate(previousProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Routes a persisted card payload into its approved TCG V2 face.
 * It does not infer missing metadata, generate signatures, or alter recipes.
 */
const TCGV2CardFace = forwardRef(function TCGV2CardFace({
  card,
  width = 360,
  showEffects = false,
  interactive = showEffects,
  videoPresentation = 'preview',
  disablePointerTilt = false,
  idleEffects = false,
  signatureUrl = null,
  className = '',
  onClick,
  fallback = null,
  onRenderError,
}, ref) {
  const shellRef = useRef(null)
  const shellStyle = useMemo(() => ({
    width: typeof width === 'number' ? `${width}px` : width,
    ...(card?.foil_map_url ? { '--tcg-foil-map': `url("${card.foil_map_url}")` } : {}),
    ...(card?.presentation_override?.mask?.background_strength != null ? { '--tcg-mask-background-strength': card.presentation_override.mask.background_strength } : {}),
    ...(card?.presentation_override?.mask?.subject_strength != null ? { '--tcg-mask-subject-strength': card.presentation_override.mask.subject_strength } : {}),
  }), [card?.foil_map_url, card?.presentation_override, width])
  const setRestingLight = useCallback(() => {
    const element = shellRef.current
    if (!element) return
    if (!disablePointerTilt) {
      element.style.setProperty('--tcg-tilt-x', '0deg')
      element.style.setProperty('--tcg-tilt-y', '0deg')
    }
    element.style.setProperty('--tcg-pointer-x', '50%')
    element.style.setProperty('--tcg-pointer-y', '50%')
    element.style.setProperty('--tcg-pointer-from-top', '.5')
    element.style.setProperty('--tcg-cosmos-main-x', '50%')
    element.style.setProperty('--tcg-cosmos-main-y', '50%')
    element.style.setProperty('--tcg-cosmos-middle-x', '50%')
    element.style.setProperty('--tcg-cosmos-middle-y', '50%')
    element.style.setProperty('--tcg-cosmos-top-x', '50%')
    element.style.setProperty('--tcg-cosmos-top-y', '50%')
    element.style.setProperty('--tcg-sr-radial-x', '50%')
    element.style.setProperty('--tcg-sr-radial-y', '50%')
    element.style.setProperty('--tcg-background-x', '50%')
    element.style.setProperty('--tcg-background-y', '50%')
    element.style.setProperty('--tcg-background-slow-x', '50%')
    element.style.setProperty('--tcg-background-slow-y', '50%')
    element.style.setProperty('--tcg-background-ur-x', '50%')
    element.style.setProperty('--tcg-background-ur-y', '50%')
    element.style.setProperty('--tcg-frame-x', '50%')
    element.style.setProperty('--tcg-frame-y', '50%')
    element.style.setProperty('--tcg-pointer-distance', '0')
    element.style.setProperty('--tcg-card-opacity', idleEffects ? '1' : '0')
    element.style.setProperty('--tcg-frame-hue', '0deg')
    element.style.setProperty('--tcg-sr-brightness', '.36')
    element.style.setProperty('--tcg-sr-opacity', '.24')
    element.style.setProperty('--tcg-spr-brightness', '.48')
    element.style.setProperty('--tcg-ur-brightness', '1')
    element.style.setProperty('--tcg-effect-opacity', '.55')
    element.style.setProperty('--tcg-gallery-left-opacity', '0')
    element.style.setProperty('--tcg-gallery-right-opacity', '0')
  }, [disablePointerTilt, idleEffects])
  useEffect(() => {
    if (idleEffects) setRestingLight()
  }, [idleEffects, setRestingLight])
  const updatePointerVfx = useCallback((clientX, clientY, normalizedPosition = null) => {
    const element = shellRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.min(1, Math.max(0, normalizedPosition?.x ?? (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, normalizedPosition?.y ?? (clientY - rect.top) / rect.height))
    if (!disablePointerTilt) {
      element.style.setProperty('--tcg-tilt-x', `${((y - 0.5) * 28.57).toFixed(2)}deg`)
      element.style.setProperty('--tcg-tilt-y', `${((0.5 - x) * 28.57).toFixed(2)}deg`)
    }
    element.style.setProperty('--tcg-pointer-x', `${(x * 100).toFixed(2)}%`)
    element.style.setProperty('--tcg-pointer-y', `${(y * 100).toFixed(2)}%`)
    element.style.setProperty('--tcg-pointer-from-top', y.toFixed(3))
    element.style.setProperty('--tcg-cosmos-main-x', `${(10 + x * 80).toFixed(2)}%`)
    element.style.setProperty('--tcg-cosmos-main-y', `${(10 + y * 80).toFixed(2)}%`)
    element.style.setProperty('--tcg-cosmos-middle-x', `${(15 + x * 70).toFixed(2)}%`)
    element.style.setProperty('--tcg-cosmos-middle-y', `${(15 + y * 70).toFixed(2)}%`)
    element.style.setProperty('--tcg-cosmos-top-x', `${(20 + x * 60).toFixed(2)}%`)
    element.style.setProperty('--tcg-cosmos-top-y', `${(20 + y * 60).toFixed(2)}%`)
    element.style.setProperty('--tcg-sr-radial-x', `${(25 + x * 50).toFixed(2)}%`)
    element.style.setProperty('--tcg-sr-radial-y', `${(25 + y * 50).toFixed(2)}%`)
    element.style.setProperty('--tcg-background-x', `${(x * 100).toFixed(2)}%`)
    element.style.setProperty('--tcg-background-y', `${(y * 100).toFixed(2)}%`)
    element.style.setProperty('--tcg-background-slow-x', `${(50 + (x - 0.5) * 34).toFixed(2)}%`)
    element.style.setProperty('--tcg-background-slow-y', `${(50 + (y - 0.5) * 34).toFixed(2)}%`)
    element.style.setProperty('--tcg-background-ur-x', `${(37 + x * 26).toFixed(2)}%`)
    element.style.setProperty('--tcg-background-ur-y', `${(33 + y * 34).toFixed(2)}%`)
    element.style.setProperty('--tcg-frame-x', `${(50 - (x - 0.5) * 54).toFixed(2)}%`)
    element.style.setProperty('--tcg-frame-y', `${(50 + (y - 0.5) * 44).toFixed(2)}%`)
    const distance = Math.min(1, Math.hypot(x - 0.5, y - 0.5) / 0.5)
    element.style.setProperty('--tcg-pointer-distance', distance.toFixed(3))
    element.style.setProperty('--tcg-card-opacity', '1')
    element.style.setProperty('--tcg-frame-hue', `${((x - y) * 14).toFixed(2)}deg`)
    element.style.setProperty('--tcg-sr-brightness', `${(0.34 + distance * 0.64).toFixed(3)}`)
    element.style.setProperty('--tcg-sr-opacity', `${(0.2 + distance * 0.48).toFixed(3)}`)
    element.style.setProperty('--tcg-spr-brightness', `${(0.48 + distance * 0.35).toFixed(3)}`)
    element.style.setProperty('--tcg-ur-brightness', `${(1 + distance * 0.1).toFixed(3)}`)
    element.style.setProperty('--tcg-effect-opacity', `${(0.45 + distance * 0.38).toFixed(3)}`)
    element.style.setProperty('--tcg-gallery-left-opacity', `${Math.max(0, (0.42 - x) / 0.42).toFixed(3)}`)
    element.style.setProperty('--tcg-gallery-right-opacity', `${Math.max(0, (x - 0.58) / 0.42).toFixed(3)}`)
  }, [disablePointerTilt])
  const onPointerMove = useCallback(event => {
    updatePointerVfx(event.clientX, event.clientY)
  }, [updatePointerVfx])
  useImperativeHandle(ref, () => ({
    updatePointerVfx,
    resetPointerVfx: setRestingLight,
  }), [setRestingLight, updatePointerVfx])
  const face = resolveTCGV2CardFace(card)
  if (!face) return fallback

  const Renderer = RENDERERS[face.type]
  if (!Renderer) return fallback

  // Layered Scene cards already own their foil response inside the SVG. The
  // outer finish elements are intentionally reserved for flat/no-mask faces;
  // mounting them here would put an unmasked glare over the subject again.
  const sceneVisualMode = face.type === 'scene'
    ? String(face.recipe?.visualMode || face.visualMode || card?.mask_visual_mode || '').toLowerCase()
    : ''
  // SceneCard deliberately renders Common without its layered subject mask.
  // Match that decision here so the ordinary card glare is mounted as well.
  const isLayeredFace = sceneVisualMode === 'layered'
    && face.recipe?.rarity !== 'C'
    && Boolean(face.packedMaskUrl)
  // Commons keep the simple physical light reflection on hover even when
  // rarity foil effects are turned off. Their glare is the only VFX this
  // pointer tracking can affect while the effects preference is disabled.
  const tracksCommonLight = face.recipe?.rarity === 'C'
  const resetKey = `${card?.id ?? 'card'}:${face.type}:${face.recipe?.templateId ?? ''}`

  return (
    <div ref={shellRef} className="tcg-v2-card-shell" style={shellStyle}
         data-card-type={face.type} data-rarity={face.recipe?.rarity}
         data-foil-map={card?.foil_map_url ? 'true' : 'false'}
         data-mask-override={card?.presentation_override?.mask ? 'true' : 'false'}
         data-mask-mode={isLayeredFace ? 'layered' : 'flat'}
         data-effects={showEffects ? 'on' : 'off'}
         onPointerMove={interactive || tracksCommonLight ? onPointerMove : undefined}
         onPointerLeave={interactive || tracksCommonLight ? setRestingLight : undefined}>
      <div className="tcg-v2-card-stage">
        <CardFaceBoundary fallback={fallback} onRenderError={onRenderError} resetKey={resetKey}>
          <SignatureOverrideContext.Provider value={card?.presentation_override || null}>
            <Renderer
              recipe={face.recipe}
              artUrl={face.artUrl}
              mediaType={face.mediaType}
              posterUrl={face.posterUrl}
              previewUrl={face.previewUrl}
              videoPresentation={videoPresentation}
              stackArtUrls={face.stackArtUrls}
              packedMaskUrl={face.packedMaskUrl}
              signatureUrl={signatureUrl || face.signatureUrl}
              signatureUrls={face.signatureUrls}
              width="100%"
              showEffects={showEffects}
              className={className}
              onClick={onClick}
            />
          </SignatureOverrideContext.Provider>
        </CardFaceBoundary>
        {!isLayeredFace && (
          <>
            <span className="tcg-v2-card-finish tcg-v2-card-shine" aria-hidden="true" />
            <span className="tcg-v2-card-finish tcg-v2-card-glare" aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  )
})

export default TCGV2CardFace
