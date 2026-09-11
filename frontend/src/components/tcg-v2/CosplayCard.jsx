import { useId, useMemo } from 'react'

import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/cosplay/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/cosplay/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/cosplay/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/cosplay/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/cosplay/spr.png'
import { cosplayCoverGeometry, createCosplayRecipe } from './cosplayRecipe'
import { PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './CosplayCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

function MotifShape({ kind, fill = 'currentColor', stroke = '#fff4ba', strokeWidth = 7 }) {
  const shared = { fill, stroke, strokeWidth, strokeLinejoin: 'round' }
  if (kind === 'star') return <polygon points="100,8 123,70 190,72 137,112 154,182 100,142 46,182 63,112 10,72 77,70" {...shared} />
  if (kind === 'heart') return <path d="M100 181C82 151 18 120 18 65 18 25 67 11 100 51 133 11 182 25 182 65 182 120 118 151 100 181Z" {...shared} />
  if (kind === 'flame') return <path d="M104 9C124 48 91 61 126 91 142 105 151 128 143 151 133 181 103 193 75 181 42 167 36 127 57 101 72 82 83 67 80 40 96 51 103 65 102 80 119 61 118 36 104 9Z" {...shared} />
  if (kind === 'moon') return <path d="M142 20C91 34 68 84 86 126 100 160 132 176 166 169 139 194 95 195 59 169 18 139 11 82 41 42 65 11 107 3 142 20Z" {...shared} />
  if (kind === 'crown') return <path d="M20 63L61 99 99 34 138 99 180 63 160 157H40L20 63ZM43 174H157" {...shared} fill="none" />
  if (kind === 'note') return <path d="M78 155V47L158 29V130M78 47L158 29M78 155C78 176 35 184 28 159 22 136 62 125 78 139M158 130C158 151 115 159 108 134 102 111 142 100 158 114" {...shared} fill="none" strokeWidth="13" />
  if (kind === 'paw') return <g {...shared}><ellipse cx="100" cy="133" rx="53" ry="44" /><ellipse cx="47" cy="72" rx="23" ry="31" /><ellipse cx="88" cy="43" rx="23" ry="31" /><ellipse cx="133" cy="48" rx="23" ry="31" /><ellipse cx="164" cy="83" rx="22" ry="30" /></g>
  if (kind === 'aperture') return <g {...shared}><circle cx="100" cy="100" r="84" /><path d="M100 100L71 21 127 22ZM100 100L179 70 178 126ZM100 100L130 179 74 178ZM100 100L21 130 22 74Z" fill="#fff4ba" /></g>
  return <g {...shared}>{[0, 72, 144, 216, 288].map(angle => <ellipse key={angle} cx="100" cy="47" rx="34" ry="58" transform={`rotate(${angle} 100 100)`} />)}<circle cx="100" cy="100" r="18" fill="#fff4ba" /></g>
}

export default function CosplayCard({ recipe: input, artUrl, packedMaskUrl = null, signatureUrl = null,
                                      width = 360, showEffects = false, className = '', onClick }) {
  const recipe = useMemo(() => createCosplayRecipe(input), [input])
  const geometry = useMemo(() => cosplayCoverGeometry(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const ids = {
    clip: `cosplay-clip-${rawId}`, shade: `cosplay-shade-${rawId}`,
    dots: `cosplay-dots-${rawId}`, glow: `cosplay-glow-${rawId}`,
    ...packedMaskIds(`cosplay-${rawId}`),
  }
  const rarityBox = rarityBounds.cosplay[recipe.rarity.toLowerCase()]
  const { snapshot, palette } = recipe
  const topLabel = snapshot.topLabel.toUpperCase()
  const title = snapshot.pairingLabel.toUpperCase()
  const metadata = ['COSPLAY', snapshot.periodLabel, snapshot.cardId].filter(Boolean).join(' · ')

  return (
    <div className={`cosplay-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'} aria-label={`${recipe.rarity} Cosplay card, ${title}`}
         data-card-type="cosplay" data-rarity={recipe.rarity}>
      <svg viewBox="0 0 1024 1536" className="cosplay-card-v2__surface" aria-hidden="true">
        <defs>
          <clipPath id={ids.clip}><rect x="16" y="16" width="992" height="1504" rx="42" /></clipPath>
          <linearGradient id={ids.shade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#07121f" stopOpacity=".72" />
            <stop offset=".15" stopColor="#07121f" stopOpacity="0" />
            <stop offset=".7" stopColor="#07121f" stopOpacity="0" />
            <stop offset="1" stopColor="#07121f" stopOpacity=".72" />
          </linearGradient>
          <pattern id={ids.dots} width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="6" r="5" fill="#fff" opacity=".55" />
          </pattern>
          <filter id={ids.glow} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <PackedMaskDefs ids={ids} packedMaskUrl={packedMaskUrl} geometry={geometry} />
        </defs>

        <g clipPath={`url(#${ids.clip})`}>
          <g data-effect-layer="photograph">
            <rect width="1024" height="1536" fill="#152433" />
            <image href={artUrl} x={geometry.x} y={geometry.y} width={geometry.width}
                   height={geometry.height} preserveAspectRatio="none" />
            <PackedFoilSurfaces ids={ids} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                                rarity={recipe.rarity} />
            <rect width="1024" height="1536" fill={`url(#${ids.shade})`} />
          </g>

          <g data-effect-layer="frame">
            <polygon points="0,0 338,0 0,215" fill="#fff" />
            <polygon points="0,0 306,0 0,181" fill={palette.primary} />
            <polygon points="0,38 252,0 0,145" fill={palette.secondary} opacity=".72" />
            <polygon points="0,53 236,15 0,145" fill={`url(#${ids.dots})`} opacity=".9" />
            <path d="M0 210L342 0" stroke="#111318" strokeWidth="12" />
            <rect x="16" y="16" width="992" height="1504" rx="42" fill="none" stroke="#fff" strokeWidth="12" />
            <rect x="22" y="22" width="980" height="1492" rx="36" fill="none" stroke={palette.secondary} strokeWidth="4" />
          </g>

          <g data-effect-layer="motifs" className="cosplay-card-v2__secondary-motifs" color={palette.pop}>
            <g transform="translate(835 118) scale(.36)"><MotifShape kind={recipe.heroMotif} /></g>
            <g transform="translate(78 520) scale(.28)"><MotifShape kind={recipe.heroMotif} /></g>
            <g transform="translate(846 830) scale(.3)"><MotifShape kind={recipe.heroMotif} /></g>
            <circle cx="905" cy="338" r="11" fill={palette.pop} /><circle cx="115" cy="930" r="9" fill={palette.pop} />
          </g>

          <g data-effect-layer="frame">
            <polygon points="20,1262 985,1097 1008,1338 55,1492" fill="#fff" stroke="#111318" strokeWidth="11" />
            <polygon points="26,1270 981,1110 998,1325 62,1480" fill={palette.primary} />
            <polygon points="26,1270 981,1110 998,1165 45,1324" fill={palette.secondary} opacity=".8" />
            <polygon points="26,1270 981,1110 998,1325 62,1480" fill={`url(#${ids.dots})`} opacity=".5" />
            <g className="cosplay-card-v2__hero-motif" transform="translate(18 1140) scale(1.38)">
              <MotifShape kind={recipe.heroMotif} fill={palette.pop} />
            </g>
          </g>

          <svg x="32" y="42" width="145" height="112" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`cosplay-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          <g className="cosplay-card-v2__identity">
            <text x="575" y="106" textAnchor="middle" className="cosplay-card-v2__creator"
                  textLength={topLabel.length > 18 ? 650 : undefined}
                  lengthAdjust="spacingAndGlyphs">{topLabel}</text>
            <text x="604" y="1300" textAnchor="middle" transform="rotate(-9 604 1300)"
                  className="cosplay-card-v2__title"
                  textLength={title.length > 22 ? 690 : undefined} lengthAdjust="spacingAndGlyphs">{title}</text>
            <text x="974" y="1492" textAnchor="end" className="cosplay-card-v2__metadata">{metadata}</text>
          </g>

          {recipe.rarity === 'SPR' && (
            <SignatureLayer imageUrl={signatureUrl} names={snapshot.creatorName}
                            palette={palette}
                            x="180" y="720" width="690" height="250"
                            className="cosplay-card-v2__signature" />
          )}
        </g>
      </svg>
    </div>
  )
}
