export const ROOM_CARD_LIMITS = Object.freeze({ pile: 8, display: 12, carried: 4 })

export function isPremiumRoomCardReady(item) {
  if (!item?.material_ready || !item.card) return false
  const rarity = String(item.card.rarity_class || 'C').toUpperCase()
  if (rarity === 'C') return true
  const visual = Object.values(item.card).find(value => value?.recipe?.schema?.includes('card-recipe'))
  if (!item.card.mask_url || (visual?.visual_mode || item.card.mask_visual_mode) !== 'layered') return false
  return rarity !== 'UR' || item.card.card_type === 'gallery' || Boolean(item.card.foil_map_url)
}

export function selectBoundedRoomCards(items = []) {
  const used = { pile: 0, display: 0, carried: 0 }
  return items.filter(item => {
    const surface = item.surface in used ? item.surface : 'pile'
    if (used[surface] >= ROOM_CARD_LIMITS[surface]) return false
    used[surface] += 1
    return true
  })
}

export function roomCardMaterialMode(card, distance = 0) {
  const rarity = String(card?.rarity_class || 'C').toUpperCase()
  return {
    rarity,
    reactive: distance < 3.2,
    subjectProtection: ['R', 'SR', 'SPR', 'UR'].includes(rarity),
    usesPackedMask: Boolean(card?.mask_url),
    usesFoilSurface: rarity === 'UR' ? Boolean(card?.foil_map_url) || card?.card_type === 'gallery' : rarity !== 'C',
    galleryAngleStack: card?.card_type === 'gallery' && ['SR', 'SPR', 'UR'].includes(rarity),
  }
}

export const ROOM_CARD_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

export const ROOM_CARD_FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D uFace;
  uniform sampler2D uPackedMask;
  uniform sampler2D uFoilMap;
  uniform sampler2D uFrameMask;
  uniform sampler2D uRarityMask;
  uniform float uHasMask;
  uniform float uHasFoilMap;
  uniform float uRarity;
  uniform float uHasSurfaceMasks;
  uniform float uTime;
  uniform float uReactive;
  uniform vec3 uCameraPosition;
  uniform vec3 uKeyLight;
  uniform vec4 uMaskGeometry;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  vec3 spectrum(float value) {
    return .55 + .45 * cos(6.28318 * (value + vec3(0.00, .33, .67)));
  }

  vec3 rarityFoil(float phase) {
    // Match the established 2D rarity languages instead of applying one
    // rainbow treatment to every premium card.
    vec3 rareSilver = mix(vec3(.72, .82, .94), vec3(.98, .92, .76), phase);
    vec3 superRare = mix(vec3(.36, .82, 1.0), vec3(.64, .38, 1.0), phase);
    vec3 signature = mix(vec3(1.0, .42, .78), vec3(1.0, .86, .38), phase);
    vec3 ultra = spectrum(phase * 1.8);
    if (uRarity < 1.5) return rareSilver;
    if (uRarity < 2.5) return superRare;
    if (uRarity < 3.5) return signature;
    return ultra;
  }

  void main() {
    vec4 face = texture2D(uFace, vUv);
    vec2 facePoint = vec2(vUv.x, 1.0 - vUv.y);
    vec2 sourcePoint = (facePoint - uMaskGeometry.xy) / uMaskGeometry.zw;
    float inArtwork = step(0.0, sourcePoint.x) * step(sourcePoint.x, 1.0) * step(0.0, sourcePoint.y) * step(sourcePoint.y, 1.0);
    vec4 packed = texture2D(uPackedMask, vec2(clamp(sourcePoint.x, 0.0, 1.0), 1.0 - clamp(sourcePoint.y, 0.0, 1.0)));
    float subject = mix(0.0, packed.r * inArtwork, uHasMask);
    float edge = mix(0.0, packed.g * inArtwork, uHasMask);
    float background = mix(1.0, 1.0 - subject, uHasMask);
    vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
    vec3 halfVector = normalize(viewDirection + normalize(uKeyLight));
    float incidence = clamp(dot(normalize(vWorldNormal), halfVector), 0.0, 1.0);
    float angle = dot(viewDirection, vec3(.54, .21, .81));
    float foilSurface = texture2D(uFoilMap, vec2(clamp(sourcePoint.x, 0.0, 1.0), 1.0 - clamp(sourcePoint.y, 0.0, 1.0))).r;
    float relief = mix(.52, foilSurface, uHasFoilMap * inArtwork);
    float frameAsset = texture2D(uFrameMask, vUv).a * uHasSurfaceMasks;
    float rarityAsset = texture2D(uRarityMask, vUv).a * uHasSurfaceMasks;
    float moving = uReactive * (.06 * sin(uTime * .75 + vUv.y * 10.0));
    float foilPhase = fract(angle * .72 + vUv.x * .31 + vUv.y * .12 + relief * .24 + moving);
    vec3 foilColor = rarityFoil(foilPhase);
    float premium = step(.5, uRarity);
    float backgroundStrength = premium * background * mix(.055, .20, clamp((uRarity - 1.0) / 3.0, 0.0, 1.0));
    float edgeStrength = premium * edge * (.06 + uRarity * .012);
    // The subject gets only neutral plastic reflection. Its color never receives background foil.
    float subjectGlint = premium * subject * pow(incidence, 24.0) * .045;
    float foilLight = (.15 + .62 * pow(incidence, 6.0)) * relief;
    float artworkEnergy = clamp(backgroundStrength + edgeStrength, 0.0, .24);
    vec3 screenedFoil = 1.0 - (1.0 - face.rgb) * (1.0 - foilColor * foilLight);
    vec3 color = mix(face.rgb, screenedFoil, artworkEnergy);
    color = mix(color, 1.0 - (1.0 - color) * vec3(.82), subjectGlint);
    // These highlights follow the alpha of the authored frame and rarity assets.
    // They never create a synthetic outline outside those designed pixels.
    float frameEnergy = frameAsset * premium * pow(incidence, 10.0) * (.035 + uRarity * .009);
    color = mix(color, 1.0 - (1.0 - color) * (1.0 - foilColor), frameEnergy);
    float rarityEnergy = rarityAsset * premium * (.035 + .085 * pow(incidence, 8.0));
    color = mix(color, 1.0 - (1.0 - color) * (1.0 - mix(vec3(1.0), foilColor, .35)), rarityEnergy);
    color += vec3(pow(incidence, 40.0) * .025);
    gl_FragColor = vec4(color, face.a);
  }
`
