function MaskImage({ href, geometry }) {
  return (
    <image href={href} x={geometry.x} y={geometry.y} width={geometry.width}
           height={geometry.height} preserveAspectRatio="none" />
  )
}

export function packedMaskChannelUrl(packedMaskUrl, channel) {
  const match = String(packedMaskUrl || '').match(/\/masks\/(\d+)\.png(?:\?|$)/)
  return match ? `/api/masks/channels/${match[1]}/${channel}` : null
}

export function packedMaskIds(prefix) {
  return {
    subjectMask: `${prefix}-subject-mask`,
    backgroundMask: `${prefix}-background-mask`,
    edgeMask: `${prefix}-edge-mask`,
  }
}

/** R = subject alpha, G = edge band. */
export function PackedMaskDefs({ ids, packedMaskUrl, geometry }) {
  if (!packedMaskUrl) return null
  const subjectUrl = packedMaskChannelUrl(packedMaskUrl, 'subject')
  const backgroundUrl = packedMaskChannelUrl(packedMaskUrl, 'background')
  const edgeUrl = packedMaskChannelUrl(packedMaskUrl, 'edge')
  if (!subjectUrl) return null

  return (
    <>
      <mask id={ids.subjectMask} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
            style={{ maskType: 'alpha' }}>
        <MaskImage href={subjectUrl} geometry={geometry} />
      </mask>
      <mask id={ids.backgroundMask} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
            style={{ maskType: 'alpha' }}>
        <MaskImage href={backgroundUrl} geometry={geometry} />
      </mask>
      <mask id={ids.edgeMask} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
            style={{ maskType: 'alpha' }}>
        <MaskImage href={edgeUrl} geometry={geometry} />
      </mask>
    </>
  )
}

function MaskedFinish({ maskId = null, surface, className, x, y, width, height }) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}
                   mask={maskId ? `url(#${maskId})` : undefined}
                   data-mask-surface={surface}
                   className="tcg-v2-masked-finish-surface">
      <div xmlns="http://www.w3.org/1999/xhtml"
           className={`tcg-v2-masked-finish ${className}`}>
        <span className="tcg-v2-masked-finish__texture" aria-hidden="true" />
      </div>
    </foreignObject>
  )
}

export function PackedFoilSurfaces({
  ids,
  hasMask,
  showEffects,
  rarity,
  starsOnly = false,
  x = 0,
  y = 0,
  width = 1024,
  height = 1536,
  layer = 'all',
}) {
  if (!showEffects || !ids || !['R', 'SR', 'SPR', 'UR'].includes(rarity)) return null
  const groupClass = `tcg-v2-masked-finishes tcg-v2-masked-finishes--${rarity.toLowerCase()}${starsOnly ? ' tcg-v2-masked-finishes--stars-only' : ''}`

  if (!hasMask) {
    if (layer !== 'all') return null
    return (
      <g className={groupClass}
         pointerEvents="none" aria-hidden="true">
        <MaskedFinish className={`tcg-v2-masked-finish--full${hasMask ? '' : ' tcg-v2-masked-finish--fallback'}${starsOnly ? ' tcg-v2-masked-finish--stars-only' : ''}`}
                      x={x} y={y} width={width} height={height} />
      </g>
    )
  }

  if (['SPR', 'UR'].includes(rarity)) {
    return (
      <g className={groupClass}
         pointerEvents="none" aria-hidden="true">
        {layer !== 'subject' && (
          <MaskedFinish maskId={ids.backgroundMask}
                        surface="background"
                        className="tcg-v2-masked-finish--full tcg-v2-masked-finish--background"
                        x={x} y={y} width={width} height={height} />
        )}
        {layer !== 'background' && (
          <MaskedFinish maskId={ids.subjectMask} surface="subject"
                        className="tcg-v2-masked-finish--subject"
                        x={x} y={y} width={width} height={height} />
        )}
      </g>
    )
  }

  return (
    <g className={groupClass}
       pointerEvents="none" aria-hidden="true">
      {layer !== 'subject' && (
        <MaskedFinish maskId={ids.backgroundMask} surface="background"
                      className="tcg-v2-masked-finish--background"
                      x={x} y={y} width={width} height={height} />
      )}
    </g>
  )
}

export function FrameFoilSurface({ frameUrl, id, showEffects, rarity, x = 0, y = 0,
                                   width = 1024, height = 1536 }) {
  if (!showEffects || !['R', 'SR', 'SPR', 'UR'].includes(rarity) || !frameUrl) return null
  const maskId = `${id}-frame-foil-mask`
  return (
    <g className="tcg-v2-frame-foil" data-rarity={rarity} pointerEvents="none" aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
              style={{ maskType: 'alpha' }}>
          <image href={frameUrl} x={x} y={y} width={width} height={height} />
        </mask>
      </defs>
      <foreignObject x={x} y={y} width={width} height={height} mask={`url(#${maskId})`}>
        <div xmlns="http://www.w3.org/1999/xhtml" className="tcg-v2-frame-foil__texture" />
      </foreignObject>
    </g>
  )
}

export function RarityFoilSurface({ assetUrl, id, showEffects, rarity, width, height }) {
  if (!showEffects || !['R', 'SR', 'SPR', 'UR'].includes(rarity) || !assetUrl) return null
  const maskId = `${id}-rarity-foil-mask`
  const padding = 48
  return (
    <g className="tcg-v2-rarity-foil" data-rarity={rarity} pointerEvents="none" aria-hidden="true">
      <defs>
        <mask id={maskId} x={-padding} y={-padding}
              width={width + padding * 2} height={height + padding * 2}
              maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
              style={{ maskType: 'luminance' }}>
          <image href={assetUrl} width={width} height={height} />
        </mask>
      </defs>
      <image href={assetUrl} width={width} height={height}
             className="tcg-v2-rarity-foil__emissive" />
      <foreignObject x={-padding} y={-padding}
                     width={width + padding * 2} height={height + padding * 2}
                     mask={`url(#${maskId})`} className="tcg-v2-rarity-foil__surface">
        <div xmlns="http://www.w3.org/1999/xhtml" className="tcg-v2-rarity-foil__texture" />
      </foreignObject>
    </g>
  )
}
