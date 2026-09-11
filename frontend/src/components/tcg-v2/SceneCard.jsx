import { useId, useMemo } from 'react'

import sceneFrameUrl from '../../assets/tcg-v2/templates/scene/frame-over.png'
import sceneClipUrl from '../../assets/tcg-v2/templates/scene/card-clip-mask.png'
import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/scene/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/scene/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/scene/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/scene/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/scene/spr.png'
import {
  createSceneRecipe,
  sceneCoverGeometry,
  sceneMetadata,
  sceneTextLayout,
} from './sceneRecipe'
import {
  FrameFoilSurface,
  PackedFoilSurfaces,
  PackedMaskDefs,
  RarityFoilSurface,
  packedMaskChannelUrl,
  packedMaskIds,
} from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './SceneCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

function SvgImage({ href, geometry, ...props }) {
  return <image href={href} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height}
                preserveAspectRatio="none" {...props} />
}

function StackedSubjectName({ text, fontSize }) {
  const letters = [...text.toUpperCase().replace(/\s+/g, '')]
  const available = 560
  const step = letters.length > 1 ? Math.min(72, available / (letters.length - 1)) : 0
  const startY = 410 + (available - step * Math.max(0, letters.length - 1)) / 2
  return letters.map((letter, index) => (
    <text key={`${letter}-${index}`} x="84" y={startY + index * step} textAnchor="middle"
          className="scene-card-v2__subject-name" fontSize={fontSize}>{letter}</text>
  ))
}

export default function SceneCard({
  recipe: recipeInput,
  artUrl,
  packedMaskUrl,
  signatureUrl = null,
  width = 360,
  showEffects = false,
  className = '',
  onClick,
}) {
  const recipe = useMemo(() => createSceneRecipe(recipeInput), [recipeInput])
  const geometry = useMemo(() => sceneCoverGeometry(recipe), [recipe])
  const textLayout = useMemo(() => sceneTextLayout(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const ids = {
    clip: `scene-clip-${rawId}`,
    separator: `scene-separator-${rawId}`,
    color: `scene-color-${rawId}`,
    bloom: `scene-bloom-${rawId}`,
    dilate2: `scene-dilate2-${rawId}`,
    dilate6: `scene-dilate6-${rawId}`,
    dilate12: `scene-dilate12-${rawId}`,
    gradient: `scene-gradient-${rawId}`,
    textShadow: `scene-text-shadow-${rawId}`,
    ...packedMaskIds(`scene-${rawId}`),
  }
  const raritySlug = recipe.rarity.toLowerCase()
  const rarityBox = rarityBounds.scene[raritySlug]
  const metadata = sceneMetadata(recipe)
  const subjectName = recipe.snapshot.subjectName
  const subjectMaskUrl = packedMaskChannelUrl(packedMaskUrl, 'subject')
  const isLayered = recipe.visualMode === 'layered' && Boolean(subjectMaskUrl)
  const ariaLabel = `${recipe.rarity} Scene card, ${subjectName}, ${recipe.snapshot.creatorName}`

  return (
    <div className={`scene-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'} aria-label={ariaLabel}
         data-card-type="scene" data-rarity={recipe.rarity}
         data-visual-mode={isLayered ? 'layered' : 'flat'}>
      <svg className="scene-card-v2__surface" viewBox="0 0 1024 1536" aria-hidden="true">
        <defs>
          <linearGradient id={ids.gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={recipe.outline.primary} />
            <stop offset="1" stopColor={recipe.outline.secondary} />
          </linearGradient>
          <PackedMaskDefs ids={ids} packedMaskUrl={packedMaskUrl} geometry={geometry} />
          {[2, 6, 12].map(radius => (
            <filter key={radius} id={ids[`dilate${radius}`]} x="-8%" y="-8%" width="116%" height="116%"
                    colorInterpolationFilters="sRGB">
              <feMorphology operator="dilate" radius={radius} />
              {radius === 12 && <feGaussianBlur stdDeviation="10" />}
            </filter>
          ))}
          <filter id={ids.textShadow} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="3" stdDeviation="2" floodColor="#102b3a" floodOpacity="0.88" />
          </filter>
          <mask id={ids.clip} maskUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}>
            <image href={sceneClipUrl} width="1024" height="1536" />
          </mask>
          {isLayered && [
            [ids.separator, ids.dilate2],
            [ids.color, ids.dilate6],
            [ids.bloom, ids.dilate12],
          ].map(([maskId, filterId]) => (
            <mask key={maskId} id={maskId} maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
              <SvgImage href={subjectMaskUrl} geometry={geometry} filter={`url(#${filterId})`} />
            </mask>
          ))}
        </defs>

        <g mask={`url(#${ids.clip})`}>
          <rect width="1024" height="1536" fill="#10161d" />
          <SvgImage href={artUrl} geometry={geometry} />
          <PackedFoilSurfaces ids={ids} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                              rarity={recipe.rarity} layer={isLayered ? 'background' : 'all'} />
          {isLayered && (
            <>
              <rect width="1024" height="1536" fill={`url(#${ids.gradient})`} opacity="0.54"
                    mask={`url(#${ids.bloom})`} />
              <rect width="1024" height="1536" fill={`url(#${ids.gradient})`}
                    mask={`url(#${ids.color})`} />
              <rect width="1024" height="1536" fill={recipe.outline.secondary} opacity="0.94"
                    mask={`url(#${ids.separator})`} />
              <SvgImage href={artUrl} geometry={geometry} mask={`url(#${ids.subjectMask})`}
                        className="scene-card-v2__subject-art" />
              <PackedFoilSurfaces ids={ids} hasMask showEffects={showEffects}
                                  rarity={recipe.rarity} layer="subject" />
            </>
          )}

          <image href={sceneFrameUrl} width="1024" height="1536" data-effect-layer="frame" />
          <FrameFoilSurface frameUrl={sceneFrameUrl} id={`scene-${rawId}`} showEffects={showEffects}
                            rarity={recipe.rarity} />

          <svg x="28" y="48" width="176" height="116" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}>
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth}
                   height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`scene-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          <g filter={`url(#${ids.textShadow})`}>
            <text x="676" y="67" textAnchor="middle" className="scene-card-v2__creator"
                  fontSize={textLayout.creatorFontSize}
                  textLength={textLayout.creatorCompress ? 548 : undefined}
                  lengthAdjust={textLayout.creatorCompress ? 'spacingAndGlyphs' : undefined}>
              {recipe.snapshot.creatorName.toUpperCase()}
            </text>
            <line x1="410" y1="108" x2="515" y2="108" className="scene-card-v2__identity-rule" />
            <text x="676" y="119" textAnchor="middle" className="scene-card-v2__role"
                  fontSize={textLayout.roleFontSize}>{recipe.snapshot.creatorType.toUpperCase()}</text>
            <line x1="838" y1="108" x2="943" y2="108" className="scene-card-v2__identity-rule" />

            {textLayout.subjectMode === 'stacked' ? (
              <StackedSubjectName text={subjectName} fontSize={textLayout.subjectFontSize} />
            ) : (
              <text transform="translate(84 970) rotate(-90)" className="scene-card-v2__subject-name"
                    fontSize={textLayout.subjectFontSize} textLength="570" lengthAdjust="spacingAndGlyphs">
                {subjectName.toUpperCase()}
              </text>
            )}

            <text x="978" y="1499" textAnchor="end" className="scene-card-v2__metadata"
                  fontSize={textLayout.metadataFontSize}
                  textLength={textLayout.metadataCompress ? 650 : undefined}
                  lengthAdjust={textLayout.metadataCompress ? 'spacingAndGlyphs' : undefined}>
              {metadata}
            </text>
          </g>

          {recipe.rarity === 'SPR' && (
            <SignatureLayer imageUrl={signatureUrl} names={recipe.snapshot.creatorName}
                            palette={[recipe.outline.primary, recipe.outline.secondary]}
                            x="430" y="835" width="520" height="250"
                            className="scene-card-v2__signature" />
          )}
        </g>
      </svg>
    </div>
  )
}
