import { useId, useMemo } from 'react'

import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/hall-of-fame/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/hall-of-fame/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/hall-of-fame/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/hall-of-fame/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/hall-of-fame/spr.png'
import { createHallOfFameRecipe, hallOfFameCoverGeometry } from './hallOfFameRecipe'
import { PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './HallOfFameCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

const HOF_MATERIALS = Object.freeze({
  day: {
    key: 'bronze', stars: 1, base: '#1A0E09', shadow: '#160A06', inner: '#D49A73', atmosphere: .2,
    text: '#D89A70', textStroke: '#25110A',
    metal: ['#4B2618', '#B76B42', '#E1A47C', '#7A3D26', '#C98258'],
    veil: ['#8B4328', '#D78A5D', '#522619'],
  },
  week: {
    key: 'silver', stars: 2, base: '#10131A', shadow: '#080B11', inner: '#E8EDF3', atmosphere: .22,
    text: '#EDF2F5', textStroke: '#17202A',
    metal: ['#4F5965', '#F1F4F6', '#9BA8B5', '#FFFFFF', '#697581'],
    veil: ['#778695', '#D9E0E7', '#46515F'],
  },
  month: {
    key: 'gold', stars: 3, base: '#171008', shadow: '#130D0A', inner: '#F6D77A', atmosphere: .28,
    text: '#F5D27C', textStroke: '#24160E',
    metal: ['#815015', '#FFF0A6', '#D69A32', '#FFF2B0', '#9C651C'],
    veil: ['#8D5E19', '#E8B94E', '#6B3E10'],
  },
  alltime: {
    key: 'eternal-opal', stars: 4, base: '#080A12', shadow: '#060712', inner: '#F2E7D7', atmosphere: .11,
    text: '#F5E9DC', textStroke: '#171326',
    metal: ['#65536F', '#F2DFCB', '#AEE7E4', '#F4BCD2', '#B9A8EC', '#F8E9C1'],
    veil: ['#53D4CE', '#8F72DC', '#E994BC'], prism: true,
  },
})

function HonorStars({ count }) {
  const spacing = count === 1 ? 0 : count === 2 ? 62 : count === 3 ? 58 : 52
  return (
    <g transform="translate(512 76)">
      {Array.from({ length: count }, (_, index) => {
        const x = (index - (count - 1) / 2) * spacing
        const scale = count === 1 ? 1 : count === 2 ? .78 : .67
        return <polygon key={index} transform={`translate(${x} 0) scale(${scale})`}
                        points="0,-38 11,-13 38,-11 17,7 23,35 0,20 -23,35 -17,7 -38,-11 -11,-13" />
      })}
    </g>
  )
}

function Blossom({ x, y, scale = 1, rotate = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      {[0, 72, 144, 216, 288].map(angle => (
        <ellipse key={angle} cx="0" cy="-19" rx="11" ry="22" transform={`rotate(${angle})`} />
      ))}
      <circle r="7" />
    </g>
  )
}

export default function HallOfFameCard({ recipe: input, artUrl, packedMaskUrl = null,
                                         signatureUrl = null, width = 360,
                                         showEffects = false, className = '', onClick }) {
  const recipe = useMemo(() => createHallOfFameRecipe(input), [input])
  const geometry = useMemo(() => hallOfFameCoverGeometry(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const ids = {
    clip: `hof-clip-${rawId}`, shade: `hof-shade-${rawId}`,
    smoke: `hof-smoke-${rawId}`, metal: `hof-metal-${rawId}`,
    veil: `hof-veil-${rawId}`, prism: `hof-prism-${rawId}`,
    ...packedMaskIds(`hof-${rawId}`),
  }
  const rarityBox = rarityBounds['hall-of-fame'][recipe.rarity.toLowerCase()]
  const { snapshot } = recipe
  const material = HOF_MATERIALS[snapshot.periodType]
  const title = (snapshot.galleryName || snapshot.boardLabel).toUpperCase()
  const honorLabel = `${snapshot.boardLabel.toUpperCase()} HALL OF FAME`
  const metadata = `${snapshot.periodLabel.toUpperCase()}  •  ${snapshot.cardId.toUpperCase()}`

  return (
    <div className={`hall-of-fame-card-v2 ${className}`}
         style={{ width, '--hof-text': material.text, '--hof-text-stroke': material.textStroke }} onClick={onClick}
         role={onClick ? 'button' : 'img'}
         aria-label={`${recipe.rarity} Hall of Fame card, ${snapshot.creatorName}`}
         data-card-type="hall-of-fame" data-rarity={recipe.rarity}
         data-hof-tier={snapshot.periodType} data-hof-material={material.key}
         data-mask={packedMaskUrl ? 'layered' : 'flat'}>
      <svg viewBox="0 0 1024 1536" className="hall-of-fame-card-v2__surface" aria-hidden="true">
        <defs>
          <clipPath id={ids.clip}><rect x="7" y="7" width="1010" height="1522" rx="55" /></clipPath>
          <linearGradient id={ids.shade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={material.shadow} stopOpacity=".76" />
            <stop offset=".2" stopColor={material.shadow} stopOpacity=".08" />
            <stop offset=".66" stopColor={material.shadow} stopOpacity="0" />
            <stop offset="1" stopColor={material.shadow} stopOpacity=".88" />
          </linearGradient>
          <linearGradient id={ids.metal} x1="0" y1="0" x2="1" y2="1">
            {material.metal.map((color, index) => (
              <stop key={color + index} offset={index / (material.metal.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
          <linearGradient id={ids.veil} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={material.veil[0]} stopOpacity=".16" />
            <stop offset=".48" stopColor={material.veil[1]} stopOpacity=".05" />
            <stop offset="1" stopColor={material.veil[2]} stopOpacity=".15" />
          </linearGradient>
          <radialGradient id={ids.prism} cx="28%" cy="18%" r="92%">
            <stop offset="0" stopColor="#B9FFF4" stopOpacity=".26" />
            <stop offset=".28" stopColor="#C8B6FF" stopOpacity=".08" />
            <stop offset=".58" stopColor="#FFB7D7" stopOpacity=".18" />
            <stop offset=".82" stopColor="#FFE9B4" stopOpacity=".08" />
            <stop offset="1" stopColor="#7BE1E8" stopOpacity=".2" />
          </radialGradient>
          <filter id={ids.smoke}>
            <feTurbulence type="fractalNoise" baseFrequency=".008 .026" numOctaves="3" seed="19" />
            <feColorMatrix type="matrix" values=".35 0 0 0 .15  0 .25 0 0 .10  0 0 .18 0 .08  0 0 0 .38 0" />
          </filter>
          <PackedMaskDefs ids={ids} packedMaskUrl={packedMaskUrl} geometry={geometry} />
        </defs>

        <g clipPath={`url(#${ids.clip})`}>
          <rect width="1024" height="1536" fill={material.base} />
          <image href={artUrl} x={geometry.x} y={geometry.y} width={geometry.width}
                 height={geometry.height} preserveAspectRatio="none" data-effect-layer="photograph" />
          <rect width="1024" height="1536" fill={`url(#${ids.veil})`} data-material-layer="tint" />
          {material.prism && <rect width="1024" height="1536" fill={`url(#${ids.prism})`} opacity=".56"
                                   style={{ mixBlendMode: 'soft-light' }} data-material-layer="opal-depth" />}
          <PackedFoilSurfaces ids={ids} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                              rarity={recipe.rarity} />
          <rect width="1024" height="1536" fill={`url(#${ids.shade})`} />
          <rect width="1024" height="1536" filter={`url(#${ids.smoke})`} opacity={material.atmosphere}
                data-material-layer="grain" />

          <g className="hall-of-fame-card-v2__ornaments" fill={`url(#${ids.metal})`} data-effect-layer="ornaments">
            <path d="M28 122C150 16 241 21 320 54C226 36 148 81 82 154C54 184 20 163 28 122Z" />
            <path d="M996 122C874 16 783 21 704 54C798 36 876 81 942 154C970 184 1004 163 996 122Z" />
            <path d="M83 1328C190 1269 296 1283 390 1350C290 1305 197 1317 109 1389C71 1420 44 1360 83 1328Z" />
            <path d="M941 1328C834 1269 728 1283 634 1350C734 1305 827 1317 915 1389C953 1420 980 1360 941 1328Z" />
            <HonorStars count={material.stars} />
            <Blossom x={91} y={790} scale={1.05} rotate={18} />
            <Blossom x={886} y={305} scale={.9} rotate={-14} />
            <Blossom x={936} y={790} scale={.8} rotate={20} />
            <Blossom x={120} y={1086} scale={.82} rotate={-20} />
          </g>

          <g className="hall-of-fame-card-v2__identity" data-effect-layer="text">
            <text x="512" y="160" textAnchor="middle" className="hall-of-fame-card-v2__creator"
                  textLength={snapshot.creatorName.length > 16 ? 650 : undefined}
                  lengthAdjust="spacingAndGlyphs">{snapshot.creatorName.toUpperCase()}</text>
            <text x="512" y="206" textAnchor="middle" className="hall-of-fame-card-v2__type">
              {snapshot.creatorTypeLabel.toUpperCase()}
            </text>
            <g className="hall-of-fame-card-v2__honor" transform="translate(512 1212)">
              <path d="M-266-34H266L304 0L266 34H-266L-304 0Z"
                    fill={material.base} fillOpacity=".82" stroke={`url(#${ids.metal})`} strokeWidth="3" />
              <path d="M-240-45H240M-240 45H240" fill="none"
                    stroke={`url(#${ids.metal})`} strokeWidth="2" opacity=".78" />
              <text x="0" y="13" textAnchor="middle" className="hall-of-fame-card-v2__honor-label"
                    textLength={honorLabel.length > 24 ? 470 : undefined}
                    lengthAdjust="spacingAndGlyphs">{honorLabel}</text>
            </g>
            <text x="512" y="1412" textAnchor="middle" className="hall-of-fame-card-v2__title"
                  textLength={title.length > 18 ? 650 : undefined} lengthAdjust="spacingAndGlyphs">{title}</text>
            <text x="512" y="1472" textAnchor="middle" className="hall-of-fame-card-v2__metadata"
                  textLength={metadata.length > 34 ? 760 : undefined} lengthAdjust="spacingAndGlyphs">{metadata}</text>
          </g>

          <svg x="370" y="1262" width="284" height="132" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`hof-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          {recipe.rarity === 'SPR' && (
            <SignatureLayer imageUrl={signatureUrl} names={snapshot.creatorName}
                            palette={material.metal}
                            x="210" y="750" width="620" height="250" />
          )}
        </g>
        <rect x="7" y="7" width="1010" height="1522" rx="55" fill="none"
              stroke={`url(#${ids.metal})`} strokeWidth={snapshot.periodType === 'alltime' ? 11 : 8}
              data-effect-layer="frame" />
        <rect x="18" y="18" width="988" height="1500" rx="46" fill="none"
              stroke={material.inner} strokeWidth={snapshot.periodType === 'alltime' ? 3 : 2} opacity=".9" />
      </svg>
    </div>
  )
}
