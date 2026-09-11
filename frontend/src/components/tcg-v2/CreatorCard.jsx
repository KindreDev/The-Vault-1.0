import { useId, useMemo } from 'react'

import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/creator/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/creator/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/creator/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/creator/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/creator/spr.png'
import { createCreatorRecipe, creatorCoverGeometry } from './creatorRecipe'
import { PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './CreatorCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

export default function CreatorCard({ recipe: input, artUrl, packedMaskUrl = null, signatureUrl = null,
                                      width = 360, showEffects = false, className = '', onClick }) {
  const recipe = useMemo(() => createCreatorRecipe(input), [input])
  const geometry = useMemo(() => creatorCoverGeometry(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const clipId = `creator-clip-${rawId}`
  const photoClipId = `creator-photo-${rawId}`
  const shadeId = `creator-shade-${rawId}`
  const railId = `creator-rail-${rawId}`
  const diamondId = `creator-diamond-${rawId}`
  const maskIds = packedMaskIds(`creator-${rawId}`)
  const rarityBox = rarityBounds.creator[recipe.rarity.toLowerCase()]
  const { snapshot, palette } = recipe
  const creatorName = snapshot.creatorName.toUpperCase()
  const metadata = ['CREATOR', snapshot.creatorTypeLabel, snapshot.cardId]
    .filter(Boolean).join(' · ').toUpperCase()
  const serial = `No.${String(snapshot.creatorId).padStart(4, '0')}`

  return (
    <div className={`creator-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'}
         aria-label={`${recipe.rarity} Creator card, ${snapshot.creatorName}`}
         data-card-type="creator" data-rarity={recipe.rarity}>
      <svg viewBox="0 0 1024 1536" className="creator-card-v2__surface" aria-hidden="true">
        <defs>
          <clipPath id={clipId}><rect x="8" y="8" width="1008" height="1520" rx="54" /></clipPath>
          <clipPath id={photoClipId}><rect x="148" y="8" width="868" height="1520" /></clipPath>
          <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#07131b" stopOpacity=".1" />
            <stop offset=".64" stopColor="#07131b" stopOpacity="0" />
            <stop offset="1" stopColor="#07131b" stopOpacity=".74" />
          </linearGradient>
          <linearGradient id={railId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#EEF6E9" />
            <stop offset="1" stopColor="#B7D9D0" />
          </linearGradient>
          <pattern id={diamondId} width="92" height="92" patternUnits="userSpaceOnUse">
            <path d="M46 4L88 46 46 88 4 46Z" fill="none" stroke={palette.secondary}
                  strokeWidth="3" opacity=".42" />
          </pattern>
          <PackedMaskDefs ids={maskIds} packedMaskUrl={packedMaskUrl} geometry={geometry} />
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <g clipPath={`url(#${photoClipId})`} data-effect-layer="photograph">
            <rect x="148" width="876" height="1536" fill={palette.background} />
            <image href={artUrl} x={geometry.x} y={geometry.y} width={geometry.width}
                   height={geometry.height} preserveAspectRatio="none" />
            <PackedFoilSurfaces ids={maskIds} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                                rarity={recipe.rarity}
                                x={148} width={876} />
            <rect x="148" width="876" height="1536" fill={`url(#${shadeId})`} />
          </g>

          <g data-effect-layer="editorial-pattern"
             mask={packedMaskUrl ? `url(#${maskIds.backgroundMask})` : undefined}
             opacity={packedMaskUrl ? 1 : 0}>
            <path d="M650 0H1024V1536H560C720 1220 752 790 650 0Z"
                  fill={`url(#${diamondId})`} opacity=".42" />
          </g>

          <g data-effect-layer="rail">
            <rect width="148" height="1536" fill={`url(#${railId})`} />
            <rect width="148" height="1536" fill={`url(#${diamondId})`} opacity=".2" />
            <path d="M146 0V1536" stroke="#D9B56D" strokeWidth="6" />
            <path d="M26 1328H120" stroke="#51746F" strokeWidth="2" opacity=".45" />
            <path d="M26 1500H120" stroke="#51746F" strokeWidth="2" opacity=".45" />
          </g>

          <svg x="33" y="46" width="96" height="96" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`creator-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          <g className="creator-card-v2__identity">
            <text transform="translate(65 170) rotate(90)" className="creator-card-v2__name"
                  textLength={creatorName.length > 16 ? 590 : undefined}
                  lengthAdjust="spacingAndGlyphs">{creatorName}</text>
            <text transform="translate(88 790) rotate(90)" className="creator-card-v2__metadata"
                  textLength={metadata.length > 30 ? 530 : undefined}
                  lengthAdjust="spacingAndGlyphs">{metadata}</text>
            {snapshot.originLabel && (
              <g className="creator-card-v2__origin">
                <rect x="770" y="44" width="206" height="62" rx="31" />
                <text x="873" y="85" textAnchor="middle">{snapshot.originLabel.toUpperCase()}</text>
              </g>
            )}
            <text x="963" y="1470" textAnchor="end" className="creator-card-v2__serial">{serial}</text>
          </g>

          {recipe.rarity === 'SPR' && (
            <SignatureLayer imageUrl={signatureUrl} names={snapshot.creatorName}
                            palette={palette}
                            x="250" y="700" width="700" height="270"
                            className="creator-card-v2__signature" />
          )}
        </g>
        <rect x="8" y="8" width="1008" height="1520" rx="54" fill="none"
              stroke="#E7C27A" strokeWidth="7" data-effect-layer="frame" />
      </svg>
    </div>
  )
}
