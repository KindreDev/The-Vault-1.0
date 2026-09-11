import { useId, useMemo } from 'react'

import popBackground from '../../assets/tcg-v2/templates/character/pop-art-v1/background-base.png'
import popFrame from '../../assets/tcg-v2/templates/character/pop-art-v1/frame-over.png'
import popMotifs from '../../assets/tcg-v2/templates/character/pop-art-v1/motif-layout-stars-hearts.png'
import popClip from '../../assets/tcg-v2/templates/character/pop-art-v1/card-clip-mask.png'
import popBackgroundMask from '../../assets/tcg-v2/templates/character/pop-art-v1/palette-background-mask.png'
import popPrimaryMask from '../../assets/tcg-v2/templates/character/pop-art-v1/palette-primary-mask.png'
import popSecondaryMask from '../../assets/tcg-v2/templates/character/pop-art-v1/palette-secondary-mask.png'
import fullFrame from '../../assets/tcg-v2/templates/character/full-bleed-v1/frame-over.png'
import fullClip from '../../assets/tcg-v2/templates/character/full-bleed-v1/card-clip-mask.png'
import orbHousing from '../../assets/tcg-v2/shared/orb/orb-housing-gold.png'
import apertureIcon from '../../assets/tcg-v2/shared/orb/icons/camera-aperture.png'
import blossomIcon from '../../assets/tcg-v2/shared/orb/icons/cherry-blossom.png'
import moonIcon from '../../assets/tcg-v2/shared/orb/icons/crescent-moon.png'
import crownIcon from '../../assets/tcg-v2/shared/orb/icons/crown.png'
import flameIcon from '../../assets/tcg-v2/shared/orb/icons/flame.png'
import heartIcon from '../../assets/tcg-v2/shared/orb/icons/heart.png'
import noteIcon from '../../assets/tcg-v2/shared/orb/icons/musical-note.png'
import pawIcon from '../../assets/tcg-v2/shared/orb/icons/paw.png'
import starIcon from '../../assets/tcg-v2/shared/orb/icons/star.png'
import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/character/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/character/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/character/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/character/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/character/spr.png'
import { characterCoverGeometry, createCharacterRecipe } from './characterRecipe'
import { FrameFoilSurface, PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './CharacterCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }
const orbIcons = {
  aperture: apertureIcon, blossom: blossomIcon, moon: moonIcon, crown: crownIcon,
  flame: flameIcon, heart: heartIcon, note: noteIcon, paw: pawIcon, star: starIcon,
}

function Art({ href, geometry, ...props }) {
  return <image href={href} x={geometry.x} y={geometry.y} width={geometry.width}
                height={geometry.height} preserveAspectRatio="none" {...props} />
}

export default function CharacterCard({ recipe: input, artUrl, packedMaskUrl, signatureUrl = null,
                                        width = 360, showEffects = false, className = '', onClick }) {
  const recipe = useMemo(() => createCharacterRecipe(input), [input])
  const geometry = useMemo(() => characterCoverGeometry(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const ids = { clip: `character-clip-${rawId}`, outline: `character-outline-${rawId}`,
    paletteBackground: `character-bg-${rawId}`, palettePrimary: `character-primary-${rawId}`,
    paletteSecondary: `character-secondary-${rawId}`,
    ...packedMaskIds(`character-${rawId}`) }
  const cutout = recipe.visualMode === 'cutout' && Boolean(packedMaskUrl)
  const rarityBox = rarityBounds.character[recipe.rarity.toLowerCase()]
  const orbIcon = orbIcons[recipe.orbIcon] || starIcon
  const name = recipe.snapshot.characterName.toUpperCase()
  const series = recipe.snapshot.series?.toUpperCase()
  const clipAsset = cutout ? popClip : fullClip

  return (
    <div className={`character-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'} aria-label={`${recipe.rarity} Character card, ${name}`}
         data-card-type="character" data-rarity={recipe.rarity}
         data-visual-mode={cutout ? 'cutout' : 'full-bleed'}>
      <svg viewBox="0 0 1024 1536" className="character-card-v2__surface" aria-hidden="true">
        <defs>
          <mask id={ids.clip} maskUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}>
            <image href={clipAsset} width="1024" height="1536" />
          </mask>
          <PackedMaskDefs ids={ids} packedMaskUrl={packedMaskUrl} geometry={geometry} />
          {cutout && (
            <>
              <filter id={ids.outline} x="-10%" y="-10%" width="120%" height="120%">
                <feMorphology operator="dilate" radius="4" />
              </filter>
              {[
                [ids.paletteBackground, popBackgroundMask],
                [ids.palettePrimary, popPrimaryMask],
                [ids.paletteSecondary, popSecondaryMask],
              ].map(([id, asset]) => (
                <mask key={id} id={id} maskUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}>
                  <image href={asset} width="1024" height="1536" />
                </mask>
              ))}
            </>
          )}
        </defs>

        <g mask={`url(#${ids.clip})`}>
          {cutout ? (
            <g data-effect-layer="background">
              <rect width="1024" height="1536" fill="#FFF8E4" />
              <rect width="1024" height="1536" fill={recipe.palette.background} mask={`url(#${ids.paletteBackground})`} />
              <rect width="1024" height="1536" fill={recipe.palette.primary} mask={`url(#${ids.palettePrimary})`} />
              <rect width="1024" height="1536" fill={recipe.palette.secondary} mask={`url(#${ids.paletteSecondary})`} />
              <image href={popBackground} width="1024" height="1536" className="character-card-v2__texture" />
              <image href={popMotifs} width="1024" height="1536" />
              <rect width="1024" height="1536" fill={recipe.palette.ink} opacity=".34"
                    transform="translate(16 18)" mask={`url(#${ids.subjectMask})`} />
              <rect width="1024" height="1536" fill="#FFF8DF" mask={`url(#${ids.subjectMask})`}
                    filter={`url(#${ids.outline})`} />
              <Art href={artUrl} geometry={geometry} mask={`url(#${ids.subjectMask})`} data-effect-layer="subject" />
              <PackedFoilSurfaces ids={ids} hasMask showEffects={showEffects} rarity={recipe.rarity} />
              <image href={popFrame} width="1024" height="1536" data-effect-layer="frame" />
              <FrameFoilSurface frameUrl={popFrame} id={`character-pop-${rawId}`}
                                showEffects={showEffects} rarity={recipe.rarity} />
            </g>
          ) : (
            <>
              <rect width="1024" height="1536" fill="#202127" />
              <Art href={artUrl} geometry={geometry} data-effect-layer="background" />
              <PackedFoilSurfaces ids={ids} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                                  rarity={recipe.rarity} />
              <image href={fullFrame} width="1024" height="1536" data-effect-layer="frame" />
              <FrameFoilSurface frameUrl={fullFrame} id={`character-full-${rawId}`}
                                showEffects={showEffects} rarity={recipe.rarity} />
              <image href={orbHousing} x="802" y="1267" width="180" height="180" data-effect-layer="orb" />
              <image href={orbIcon} x="836" y="1301" width="112" height="112" />
            </>
          )}

          <svg x="36" y="36" width="150" height="112" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`character-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          <g className="character-card-v2__identity">
            <text x="512" y="88" textAnchor="middle" className="character-card-v2__top-name"
                  textLength={name.length > 14 ? (cutout ? 560 : 450) : undefined}
                  lengthAdjust="spacingAndGlyphs">{name}</text>
            {series && <text x="512" y="128" textAnchor="middle"
                             className="character-card-v2__series">{series}</text>}
            <text x={cutout ? 540 : 512} y={cutout ? 1282 : 1402} textAnchor="middle"
                  transform={cutout ? "rotate(-14 540 1282)" : undefined}
                  textLength={name.length > 13 ? (cutout ? 600 : 560) : undefined}
                  lengthAdjust="spacingAndGlyphs"
                  className={`character-card-v2__hero-name ${cutout ? 'is-ribbon' : ''}`}>{name}</text>
            <text x="970" y="1500" textAnchor="end" className="character-card-v2__metadata">
              CHARACTER · {recipe.snapshot.cardId}
            </text>
          </g>

          {recipe.rarity === 'SPR' && (
            <SignatureLayer imageUrl={signatureUrl} names={recipe.snapshot.characterName}
                            palette={recipe.palette}
                            x="170" y="760" width="700" height="250" />
          )}
        </g>
      </svg>
    </div>
  )
}
