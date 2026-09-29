import { LocalizedText } from '../../i18n'
import { useId, useMemo } from 'react'

import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/bond-card/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/bond-card/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/bond-card/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/bond-card/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/bond-card/spr.png'
import { bondCoverGeometry, createBondRecipe } from './bondRecipe'
import { PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './BondCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

function SvgArt({ href, geometry, ...props }) {
  return <image href={href} x={geometry.x} y={geometry.y} width={geometry.width}
                height={geometry.height} preserveAspectRatio="none" {...props} />
}

function Heart({ x, y, size, fill, filter, opacity = 1, rotate = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100}) rotate(${rotate} 50 44)`}
       opacity={opacity} filter={filter}>
      <path d="M 50 88 C 15 60 0 40 0 22 C 0 -3 32 -10 50 14 C 68 -10 100 -3 100 22 C 100 40 85 60 50 88 Z"
            fill={fill} stroke="rgba(255,255,255,.94)" strokeWidth="1.1" />
      <path d="M 17 56 C 35 34 53 20 84 12" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="4" />
      <path d="M 21 61 C 41 41 58 29 88 20" fill="none" stroke="rgba(124,245,255,.25)" strokeWidth="2.5" />
      {[[22,20,1.7],[39,42,1],[54,18,1.25],[68,52,1.8],[80,28,1],[47,68,1.4],[31,58,.8],[72,70,.9]].map(([cx,cy,r], index) => (
        <circle key={index} cx={cx} cy={cy} r={r} fill="rgba(255,255,255,.9)" />
      ))}
    </g>
  )
}

export default function BondCard({
  recipe: input,
  artUrl,
  packedMaskUrl = null,
  signatureUrl = null,
  width = 360,
  showEffects = false,
  className = '',
  onClick,
}) {
  const recipe = useMemo(() => createBondRecipe(input), [input])
  const geometry = useMemo(() => bondCoverGeometry(recipe), [recipe])
  const rawId = useId().replace(/:/g, '')
  const ids = {
    clip: `bond-clip-${rawId}`,
    glass: `bond-glass-${rawId}`,
    pearl: `bond-pearl-${rawId}`,
    glow: `bond-glow-${rawId}`,
    ...packedMaskIds(`bond-${rawId}`),
  }
  const rarityBox = rarityBounds['bond-card'][recipe.rarity.toLowerCase()]
  const creatorName = (recipe.snapshot.creatorName || recipe.snapshot.galleryName).toUpperCase()
  const signatureName = recipe.snapshot.creatorName?.toUpperCase() || ''
  const creatorType = (recipe.snapshot.creatorTypeLabel || 'Creator').toUpperCase()
  const period = recipe.snapshot.periodLabel ? ` · ${recipe.snapshot.periodLabel.toUpperCase()}` : ''
  const isSpr = recipe.rarity === 'SPR'
  const hasMask = Boolean(packedMaskUrl)

  return (
    <div className={`bond-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'} aria-label={`${recipe.rarity} Bond card, ${creatorName}`}
         data-card-type="bond" data-rarity={recipe.rarity} data-mask={hasMask ? 'layered' : 'flat'}>
      <svg className="bond-card-v2__surface" viewBox="0 0 1024 1536" aria-hidden="true">
        <defs>
          <clipPath id={ids.clip}><rect x="9" y="8" width="1006" height="1520" rx="55" /></clipPath>
          <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".18" stopColor="#bff8ff" />
            <stop offset=".43" stopColor="#fff3fd" />
            <stop offset=".68" stopColor="#aeeeff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <radialGradient id={ids.pearl} cx="34%" cy="28%" r="82%">
            <stop offset="0" stopColor="#fff" stopOpacity=".98" />
            <stop offset=".24" stopColor="#c9f8ff" stopOpacity=".9" />
            <stop offset=".51" stopColor="#f8d8ff" stopOpacity=".82" />
            <stop offset=".72" stopColor="#b7f8f2" stopOpacity=".78" />
            <stop offset="1" stopColor="#ffc8ec" stopOpacity=".88" />
          </radialGradient>
          <filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <PackedMaskDefs ids={ids} packedMaskUrl={packedMaskUrl} geometry={geometry} />
        </defs>

        <g clipPath={`url(#${ids.clip})`}>
          <rect width="1024" height="1536" fill="#c8dce5" />
          <SvgArt href={artUrl} geometry={geometry} data-effect-layer="art" />
          <PackedFoilSurfaces ids={ids} hasMask={hasMask} showEffects={showEffects} rarity={recipe.rarity} />

          <g data-effect-layer="hearts">
            <Heart x={738} y={-8} size={330} fill={`url(#${ids.pearl})`} filter={`url(#${ids.glow})`} rotate={-8} />
            <Heart x={835} y={55} size={238} fill={`url(#${ids.pearl})`} filter={`url(#${ids.glow})`} rotate={7} opacity={.72} />
            <Heart x={-32} y={557} size={265} fill={`url(#${ids.pearl})`} filter={`url(#${ids.glow})`} rotate={-6} opacity={.88} />
            <Heart x={-44} y={1280} size={330} fill={`url(#${ids.pearl})`} filter={`url(#${ids.glow})`} rotate={8} />
          </g>

          <g className="bond-card-v2__sparkles" data-effect-layer="sparkles">
            {[[133,149,22],[198,98,13],[72,540,10],[914,351,13],[934,757,8],[68,895,12],[940,934,11],[868,1380,18],[72,1185,8],[670,53,7]].map(([x,y,s], index) => (
              <path key={index} d={`M${x} ${y-s} L${x+s*.28} ${y-s*.28} L${x+s} ${y} L${x+s*.28} ${y+s*.28} L${x} ${y+s} L${x-s*.28} ${y+s*.28} L${x-s} ${y} L${x-s*.28} ${y-s*.28}Z`} />
            ))}
          </g>

          <g data-effect-layer="frame" fill="none" stroke={`url(#${ids.glass})`}>
            <rect x="10" y="10" width="1004" height="1516" rx="54" strokeWidth="18" opacity=".86" />
            <rect x="25" y="24" width="974" height="1487" rx="43" strokeWidth="5" opacity=".95" />
            <rect x="39" y="38" width="946" height="1458" rx="35" strokeWidth="3" opacity=".68" />
            <rect x="51" y="51" width="922" height="1432" rx="27" stroke="#fff" strokeWidth="2" opacity=".72" />
          </g>

          <g className="bond-card-v2__identity" data-effect-layer="text">
            <text x="512" y="92" textAnchor="middle" className="bond-card-v2__creator"
                  textLength={creatorName.length > 17 ? 540 : undefined} lengthAdjust="spacingAndGlyphs">{creatorName}</text>
            <text x="512" y="136" textAnchor="middle" className="bond-card-v2__role">{creatorType}</text>
          </g>

          <svg x="825" y="31" width="150" height="95" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`bond-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          <g className="bond-card-v2__milestone" data-effect-layer="milestone">
            <circle cx="83" cy="78" r="48" />
            <text x="83" y="91" textAnchor="middle">{recipe.earnedState.currentMilestone}×</text>
          </g>

          {isSpr && (
            <SignatureLayer imageUrl={signatureUrl} names={signatureName}
                            palette={recipe.palette}
                            x="475" y="1115" width="485" height="250" />
          )}

          <g className="bond-card-v2__footer" data-effect-layer="text">
            <line x1="235" y1="1480" x2="785" y2="1480" />
            <circle cx="228" cy="1480" r="4" /><circle cx="792" cy="1480" r="4" />
            <text x="512" y="1494" textAnchor="middle"><LocalizedText text={"BOND"} />{period} · {recipe.snapshot.cardId.toUpperCase()}</text>
          </g>

        </g>
      </svg>
    </div>
  )
}
