import { createContext, useContext, useId } from 'react'

export const SignatureOverrideContext = createContext(null)

function normalizeNames(names) {
  if (Array.isArray(names)) return names.map(name => String(name || '').trim()).filter(Boolean)
  const name = String(names || '').trim()
  return name ? [name] : []
}

function parseHex(value) {
  const hex = String(value || '').trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
}

function mix(rgb, target, amount) {
  return rgb.map((channel, index) => Math.round(channel + (target[index] - channel) * amount))
}

function toHex(rgb) {
  return `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function luminance([red, green, blue]) {
  return (red * .2126 + green * .7152 + blue * .0722) / 255
}

function signatureColors(palette, fallbackFill, fallbackStroke) {
  const values = (Array.isArray(palette) ? palette : Object.values(palette || {})).flat(Infinity)
  const colors = values.map(parseHex).filter(Boolean)
  if (!colors.length) return { fill: fallbackFill, stroke: fallbackStroke }

  const selected = colors.reduce((best, color) => {
    const chroma = (Math.max(...color) - Math.min(...color)) / 255
    const balance = 1 - Math.abs(luminance(color) - .55)
    return chroma * .72 + balance * .28 > best.score
      ? { color, score: chroma * .72 + balance * .28 }
      : best
  }, { color: colors[0], score: -1 }).color
  const lightness = luminance(selected)
  const visible = lightness < .3 ? mix(selected, [255, 255, 255], .44)
    : lightness > .84 ? mix(selected, [0, 0, 0], .18)
      : selected

  return {
    fill: toHex(visible),
    stroke: luminance(visible) > .58 ? 'rgba(10,14,20,.82)' : 'rgba(255,255,255,.78)',
  }
}

export default function SignatureLayer({
  names,
  imageUrl = null,
  x = 180,
  y = 720,
  width = 690,
  height = 250,
  className = '',
  transform = null,
  palette = null,
  textFill = 'rgba(255,255,255,.96)',
  textStroke = 'rgba(20,25,35,.38)',
}) {
  const override = useContext(SignatureOverrideContext)
  const baseWidth = Number(width)
  const baseHeight = Number(height)
  const scaleOverride = Number(override?.signature_scale || 1)
  const resolvedWidth = baseWidth * scaleOverride
  const resolvedHeight = baseHeight * scaleOverride
  const resolvedX = override?.signature_x == null ? Number(x) : Number(override.signature_x) - resolvedWidth / 2
  const resolvedY = override?.signature_y == null ? Number(y) : Number(override.signature_y) - resolvedHeight / 2
  const resolvedRotation = override?.signature_rotation
  const rawId = useId().replace(/:/g, '')
  const resolved = normalizeNames(names)
  const colors = signatureColors(palette, textFill, textStroke)
  if (imageUrl) {
    const scale = 1.16
    const expandedWidth = resolvedWidth * scale
    const expandedHeight = resolvedHeight * scale
    const expandedX = resolvedX - (expandedWidth - resolvedWidth) / 2
    const expandedY = resolvedY - (expandedHeight - resolvedHeight) / 2
    const imageTransform = resolvedRotation == null ? transform : `rotate(${resolvedRotation} ${resolvedX + resolvedWidth / 2} ${resolvedY + resolvedHeight / 2})`
    return (
      <image href={imageUrl} x={expandedX} y={expandedY}
             width={expandedWidth} height={expandedHeight}
             preserveAspectRatio="xMidYMid meet" data-effect-layer="signature"
             className={`tcg-v2-signature-image ${className}`.trim()} transform={imageTransform || undefined} />
    )
  }
  if (!resolved.length) return null

  const numericX = resolvedX
  const numericY = resolvedY
  const numericWidth = resolvedWidth
  const numericHeight = resolvedHeight
  const centerX = numericX + numericWidth / 2
  const centerY = numericY + numericHeight / 2
  const gap = resolved.length > 1 ? Math.min(96, numericHeight / 2.7) : 0
  const maskId = `tcg-signature-${rawId}`
  const signatureTransform = resolvedRotation == null
    ? (transform || `rotate(-7 ${centerX} ${centerY})`)
    : `rotate(${resolvedRotation} ${centerX} ${centerY})`

  const signatureText = (name, index, mask = false) => {
    const offset = (index - (Math.min(resolved.length, 2) - 1) / 2) * gap
    return (
      <text key={`${mask ? 'mask' : 'ink'}-${name}-${index}`} x={centerX} y={centerY + offset}
            textAnchor="middle" dominantBaseline="middle"
            fill={mask ? '#fff' : '#fffaff'}
            stroke={mask ? 'none' : colors.fill} strokeWidth={mask ? 0 : 3.2}
            paintOrder="stroke fill" fontSize={resolved.length > 1 ? 124 : 152}
            fontStyle="normal" fontWeight="400"
            textLength={name.length > 14 ? numericWidth * .9 : undefined}
            lengthAdjust={name.length > 14 ? 'spacingAndGlyphs' : undefined}
            fontFamily="'Mr De Haviland', 'Segoe Script', 'Brush Script MT', cursive">
        {name}
      </text>
    )
  }

  return (
    <g data-effect-layer="signature" className={`tcg-v2-signature ${className}`.trim()}
       transform={signatureTransform} style={{ '--tcg-signature-color': colors.fill }}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
              x={numericX} y={numericY} width={numericWidth} height={numericHeight}>
          {resolved.slice(0, 2).map((name, index) => signatureText(name, index, true))}
        </mask>
      </defs>
      {resolved.slice(0, 2).map((name, index) => signatureText(name, index))}
      <foreignObject x={numericX} y={numericY} width={numericWidth} height={numericHeight}
                     mask={`url(#${maskId})`} className="tcg-v2-signature-shine-surface">
        <div xmlns="http://www.w3.org/1999/xhtml" className="tcg-v2-signature-shine" />
      </foreignObject>
    </g>
  )
}
