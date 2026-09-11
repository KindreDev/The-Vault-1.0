import { useId, useMemo } from 'react'

import rarityBounds from '../../assets/tcg-v2/shared/rarity/bounds.json'
import rarityC from '../../assets/tcg-v2/shared/rarity/types/gallery/c.png'
import rarityR from '../../assets/tcg-v2/shared/rarity/types/gallery/r.png'
import raritySr from '../../assets/tcg-v2/shared/rarity/types/gallery/sr.png'
import rarityUr from '../../assets/tcg-v2/shared/rarity/types/gallery/ur.png'
import raritySpr from '../../assets/tcg-v2/shared/rarity/types/gallery/spr.png'
import { createGalleryRecipe, galleryPhotoGeometry, gallerySourceGeometry } from './galleryRecipe'
import { PackedFoilSurfaces, PackedMaskDefs, RarityFoilSurface, packedMaskIds } from './PackedMaskSurfaces'
import SignatureLayer from './SignatureLayer'
import './GalleryCard.css'

const rarityAssets = { C: rarityC, R: rarityR, SR: raritySr, UR: rarityUr, SPR: raritySpr }

function Daisy({ x, y, scale = 1, rotate = 0, pink = false }) {
  const petal = pink ? '#FF8FAF' : '#FFFDF2'
  const center = pink ? '#FFE17A' : '#F2C54C'
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      {[0, 60, 120, 180, 240, 300].map(angle => (
        <ellipse key={angle} cx="0" cy="-25" rx="13" ry="28" fill={petal}
                 stroke="#F6B94D" strokeWidth="2" transform={`rotate(${angle})`} />
      ))}
      <circle r="13" fill={center} stroke="#D58D28" strokeWidth="2" />
    </g>
  )
}

export default function GalleryCard({ recipe: input, artUrl, stackArtUrls = [], packedMaskUrl = null, signatureUrl = null,
                                     width = 360, showEffects = false, className = '', onClick }) {
  const recipe = useMemo(() => createGalleryRecipe(input), [input])
  const geometry = useMemo(() => galleryPhotoGeometry(recipe), [recipe])
  const stackItems = useMemo(() => recipe.stackSources.map((source, index) => ({
    source,
    artUrl: stackArtUrls[index] || (source.imageId ? `/api/images/${source.imageId}/file` : null),
    geometry: gallerySourceGeometry(source),
  })).filter(item => item.artUrl), [recipe, stackArtUrls])
  const rawId = useId().replace(/:/g, '')
  const outerClipId = `gallery-outer-${rawId}`
  const photoClipId = `gallery-photo-${rawId}`
  const paperId = `gallery-paper-${rawId}`
  const maskIds = packedMaskIds(`gallery-${rawId}`)
  const rarityBox = rarityBounds.gallery[recipe.rarity.toLowerCase()]
  const { snapshot, palette } = recipe
  const creatorName = snapshot.creatorName?.toUpperCase() || ''
  const typeLabel = snapshot.creatorTypeLabel?.toUpperCase() || ''
  const galleryName = snapshot.galleryName.toUpperCase()
  const metadata = ['GALLERY', snapshot.periodLabel?.toUpperCase(), snapshot.cardId].filter(Boolean).join(' \u00B7 ')

  return (
    <div className={`gallery-card-v2 ${className}`} style={{ width }} onClick={onClick}
         role={onClick ? 'button' : 'img'} aria-label={`${recipe.rarity} Gallery card, ${galleryName}`}
         data-card-type="gallery" data-rarity={recipe.rarity}>
      <svg viewBox="0 0 1024 1536" className="gallery-card-v2__surface" aria-hidden="true">
        <defs>
          <clipPath id={outerClipId}><rect x="12" y="12" width="1000" height="1512" rx="58" /></clipPath>
          <clipPath id={photoClipId}><rect x="89" y="222" width="846" height="1044" rx="8" /></clipPath>
          {stackItems.map((_, index) => (
            <clipPath key={index} id={`gallery-stack-${rawId}-${index}`}>
              <rect x="89" y="222" width="846" height="1044" rx="8" />
            </clipPath>
          ))}
          <pattern id={paperId} width="58" height="58" patternUnits="userSpaceOnUse">
            <rect width="58" height="58" fill="#F7D968" />
            <rect width="29" height="58" fill="#FFF0A5" opacity=".24" />
            <rect width="58" height="29" fill="#FFF7CB" opacity=".18" />
            <path d="M29 0V58M0 29H58" stroke="#FFF8D7" strokeWidth="3" opacity=".6" />
            <path d="M0 0H58V58H0Z" fill="none" stroke="#D8B23B" opacity=".13" />
          </pattern>
          <filter id={`gallery-shadow-${rawId}`} x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="12" dy="18" stdDeviation="12" floodColor="#5B3D21" floodOpacity=".34" />
          </filter>
          <filter id={`gallery-grain-${rawId}`}>
            <feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="2" seed="11" result="noise" />
            <feColorMatrix in="noise" type="saturate" values="0" />
            <feComponentTransfer><feFuncA type="table" tableValues="0 .09" /></feComponentTransfer>
          </filter>
          <PackedMaskDefs ids={maskIds} packedMaskUrl={packedMaskUrl} geometry={geometry} />
        </defs>

        <g clipPath={`url(#${outerClipId})`}>
          <g data-effect-layer="paper">
            <rect width="1024" height="1536" fill="#FFFDF5" />
            <rect x="20" y="20" width="984" height="1496" rx="46" fill={`url(#${paperId})`} />
            <rect x="20" y="20" width="984" height="1496" rx="46" fill="#000" opacity=".18"
                  filter={`url(#gallery-grain-${rawId})`} />
          </g>

          <g data-effect-layer="photograph-stack">
            {stackItems.map(({ source, artUrl: stackUrl, geometry: stackGeometry }, index) => (
              <g key={source.imageId}
                 transform={`translate(${source.offsetX} ${source.offsetY}) rotate(${source.rotation} 512 760)`}
                 filter={`url(#gallery-shadow-${rawId})`}>
                <rect x="57" y="180" width="910" height="1183" rx="16" fill="#FFFEF7"
                      stroke="#E8E1D2" strokeWidth="4" />
                <g clipPath={`url(#gallery-stack-${rawId}-${index})`}>
                  <rect x="89" y="222" width="846" height="1044" fill={palette.background} />
                  <image href={stackUrl} x={stackGeometry.x} y={stackGeometry.y}
                         width={stackGeometry.width} height={stackGeometry.height}
                         preserveAspectRatio="none" />
                  <rect x="89" y="222" width="846" height="1044" fill="#FFF5CF" opacity=".055" />
                </g>
                <rect x="89" y="222" width="846" height="1044" rx="8" fill="none"
                      stroke="#D8D0C0" strokeWidth="3" />
              </g>
            ))}
          </g>

          <g transform="translate(512 760) rotate(-2) scale(.88) translate(-512 -760)" data-effect-layer="polaroid"
             filter={`url(#gallery-shadow-${rawId})`}>
            <rect x="57" y="180" width="910" height="1183" rx="16" fill="#FFFEF7" stroke="#E8E1D2"
                  strokeWidth="4" data-effect-layer="frame" />
            <g clipPath={`url(#${photoClipId})`} data-effect-layer="photograph">
              <rect x="89" y="222" width="846" height="1044" fill={palette.background} />
              <image href={artUrl} x={geometry.x} y={geometry.y} width={geometry.width}
                     height={geometry.height} preserveAspectRatio="none" />
              <PackedFoilSurfaces ids={maskIds} hasMask={Boolean(packedMaskUrl)} showEffects={showEffects}
                                  rarity={recipe.rarity}
                                  x={89} y={222} width={846} height={1044} />
              {['SR', 'SPR', 'UR'].includes(recipe.rarity) && stackItems.slice(0, 2).map(({ source, artUrl: stackUrl, geometry: stackGeometry }, index) => (
                <image key={`angle-${source.imageId}`} href={stackUrl}
                       x={stackGeometry.x} y={stackGeometry.y}
                       width={stackGeometry.width} height={stackGeometry.height}
                       preserveAspectRatio="none"
                       className={`gallery-card-v2__angle-photo gallery-card-v2__angle-photo--${index === 0 ? 'left' : 'right'}`} />
              ))}
              <rect x="89" y="222" width="846" height="1044" fill="#FFF5CF" opacity=".035" />
            </g>
            <rect x="89" y="222" width="846" height="1044" rx="8" fill="none" stroke="#D8D0C0"
                  strokeWidth="3" data-effect-layer="frame" />
          </g>

          <g data-effect-layer="tape">
            <g transform="rotate(8 826 211)">
              <rect x="726" y="177" width="205" height="72" rx="5" fill="#F58CA7" opacity=".9" />
              <path d="M742 190H914M742 207H914M742 224H914" stroke="#FFD4DF" strokeWidth="3" opacity=".45" />
            </g>
            <g transform="rotate(-8 181 1236)">
              <rect x="73" y="1203" width="218" height="68" rx="5" fill="#66C9B8" opacity=".92" />
              <path d="M86 1216H278M86 1233H278M86 1250H278" stroke="#D7FFF7" strokeWidth="3" opacity=".42" />
            </g>
          </g>

          <g data-effect-layer="motifs">
            <Daisy x={77} y={1328} scale={1.18} rotate={-12} />
            <Daisy x={137} y={1393} scale={.88} rotate={18} pink />
            <Daisy x={905} y={1288} scale={.92} rotate={15} />
            <Daisy x={962} y={1371} scale={1.22} rotate={-9} pink />
            <path d="M40 1198C91 1250 106 1306 101 1391M977 1170C932 1240 924 1310 934 1410"
                  fill="none" stroke="#4D9D77" strokeWidth="9" strokeLinecap="round" />
            <path d="M82 1252c-42-14-55 22-18 41M944 1250c43-16 55 18 17 41"
                  fill="none" stroke="#4D9D77" strokeWidth="8" strokeLinecap="round" />
            <ellipse cx="75" cy="92" rx="17" ry="9" transform="rotate(28 75 92)" fill="#F58CA7" />
            <ellipse cx="130" cy="128" rx="13" ry="7" transform="rotate(38 130 128)" fill="#F58CA7" />
            <ellipse cx="936" cy="108" rx="15" ry="8" transform="rotate(-26 936 108)" fill="#F58CA7" />
            <ellipse cx="970" cy="716" rx="15" ry="8" transform="rotate(42 970 716)" fill="#F58CA7" />
          </g>

          <g className="gallery-card-v2__identity" data-effect-layer="text">
            {creatorName && <text x="512" y="92" textAnchor="middle" className="gallery-card-v2__creator"
                                  textLength={creatorName.length > 20 ? 530 : undefined}
                                  lengthAdjust="spacingAndGlyphs">{creatorName}</text>}
            {typeLabel && <text x="512" y="139" textAnchor="middle" className="gallery-card-v2__type">{typeLabel}</text>}
            <text x="95" y="1460" className="gallery-card-v2__name"
                  textLength={galleryName.length > 18 ? 610 : undefined}
                  lengthAdjust="spacingAndGlyphs">{galleryName}</text>
            <text x="95" y="1500" className="gallery-card-v2__metadata">{metadata}</text>
          </g>

          <svg x="806" y="1324" width="190" height="118" overflow="visible"
               viewBox={`${rarityBox.x - 24} ${rarityBox.y - 24} ${rarityBox.width + 48} ${rarityBox.height + 48}`}
               data-effect-layer="rarity">
            <image href={rarityAssets[recipe.rarity]} width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
            <RarityFoilSurface assetUrl={rarityAssets[recipe.rarity]} id={`gallery-${rawId}`}
                               showEffects={showEffects} rarity={recipe.rarity}
                               width={rarityBox.canvasWidth} height={rarityBox.canvasHeight} />
          </svg>

          {recipe.rarity === 'SPR' && (
            <SignatureLayer imageUrl={signatureUrl} names={creatorName}
                            palette={palette}
                            x="180" y="700" width="690" height="240"
                            className="gallery-card-v2__signature" />
          )}
        </g>
        <rect x="12" y="12" width="1000" height="1512" rx="58" fill="none" stroke="#FFFDF7" strokeWidth="18" />
      </svg>
    </div>
  )
}
