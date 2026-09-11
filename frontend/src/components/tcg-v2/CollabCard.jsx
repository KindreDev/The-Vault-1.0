import { useId, useMemo } from 'react'

import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/collab/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/collab/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/collab/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/collab/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/collab/spr.png'
import { collabCoverGeometry, createCollabRecipe } from './collabRecipe'
import { PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './CollabCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

export default function CollabCard({ recipe: input, artUrl, packedMaskUrl = null, signatureUrl = null, signatureUrls = [],
                                    width = 360, showEffects = false, className = '', onClick }) {
  const recipe = useMemo(() => createCollabRecipe(input), [input])
  const geometry = useMemo(() => collabCoverGeometry(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const clipId = `collab-clip-${rawId}`
  const shadeId = `collab-shade-${rawId}`
  const maskIds = packedMaskIds(`collab-${rawId}`)
  const rarityBox = rarityBounds.collab[recipe.rarity.toLowerCase()]
  const { snapshot } = recipe
  const topLabel = snapshot.topLabel?.toUpperCase() || ''
  const bannerLabel = snapshot.bannerLabel.toUpperCase()
  const realSignatures = signatureUrls.filter(Boolean).slice(0, 2)
  const metadata = ['COLLAB', snapshot.periodLabel, snapshot.cardId].filter(Boolean).join(' · ')

  return (
    <div className={`collab-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'} aria-label={`${recipe.rarity} Collab card, ${bannerLabel}`}
         data-card-type="collab" data-rarity={recipe.rarity}>
      <svg viewBox="0 0 1024 1536" className="collab-card-v2__surface" aria-hidden="true">
        <defs>
          <clipPath id={clipId}><rect x="14" y="14" width="996" height="1508" rx="42" /></clipPath>
          <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#06111b" stopOpacity=".62" />
            <stop offset=".18" stopColor="#06111b" stopOpacity="0" />
            <stop offset=".72" stopColor="#06111b" stopOpacity="0" />
            <stop offset="1" stopColor="#06111b" stopOpacity=".72" />
          </linearGradient>
          <PackedMaskDefs ids={maskIds} packedMaskUrl={packedMaskUrl} geometry={geometry} />
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <g data-effect-layer="photograph">
            <rect width="1024" height="1536" fill="#101820" />
            <image href={artUrl} x={geometry.x} y={geometry.y} width={geometry.width}
                   height={geometry.height} preserveAspectRatio="none" />
            <PackedFoilSurfaces ids={maskIds} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                                rarity={recipe.rarity} />
            <rect width="1024" height="1536" fill={`url(#${shadeId})`} />
          </g>

          <g data-effect-layer="frame">
            <image href="/relic.png" x="0" y="0" width="1024" height="1536" preserveAspectRatio="none" />
            <path d="M187 1284H837L872 1320V1444L837 1480H187L152 1444V1320Z"
                  fill="#07151D" fillOpacity=".78" stroke="#F5C74C" strokeWidth="5" />
            <path d="M204 1302H820" stroke="#F5C74C" strokeWidth="2" opacity=".75" />
            <path d="M204 1460H820" stroke="#F5C74C" strokeWidth="2" opacity=".75" />
          </g>

          <svg x="52" y="122" width="170" height="118" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`collab-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          <g className="collab-card-v2__identity">
            {topLabel && (
              <text x="512" y="126" textAnchor="middle" className="collab-card-v2__top"
                    textLength={topLabel.length > 19 ? 520 : undefined}
                    lengthAdjust="spacingAndGlyphs">{topLabel}</text>
            )}
            <text x="512" y="1391" textAnchor="middle" className="collab-card-v2__participants"
                  textLength={bannerLabel.length > 24 ? 630 : undefined}
                  lengthAdjust="spacingAndGlyphs">{bannerLabel}</text>
            <text x="512" y="1436" textAnchor="middle" className="collab-card-v2__metadata">{metadata}</text>
          </g>

          {recipe.rarity === 'SPR' && (
            <g data-effect-layer="signature">
              <SignatureLayer imageUrl={realSignatures[0] || signatureUrl}
                              names={snapshot.creatorNames?.[0]}
                              palette={recipe.palette}
                              x="105" y="610" width="420" height="270"
                              className="collab-card-v2__signature" transform="rotate(-7 315 745)" />
              <SignatureLayer imageUrl={realSignatures[1]}
                              names={snapshot.creatorNames?.[1]}
                              palette={recipe.palette}
                              x="500" y="710" width="420" height="270"
                              className="collab-card-v2__signature" transform="rotate(6 710 845)" />
            </g>
          )}
        </g>
      </svg>
    </div>
  )
}
