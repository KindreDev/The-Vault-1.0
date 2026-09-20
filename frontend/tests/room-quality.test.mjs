import assert from 'node:assert/strict'
import { ROOM_QUALITY_PROFILES, roomQualityProfile } from '../src/components/tcg-room/roomQuality.js'

assert.deepEqual(
  [ROOM_QUALITY_PROFILES.high.cardWidth, ROOM_QUALITY_PROFILES.high.cardHeight, ROOM_QUALITY_PROFILES.high.shadows],
  [1024, 1536, true],
)
assert.deepEqual(
  [ROOM_QUALITY_PROFILES.medium.cardWidth, ROOM_QUALITY_PROFILES.medium.cardHeight, ROOM_QUALITY_PROFILES.medium.cardAnisotropy, ROOM_QUALITY_PROFILES.medium.shadows],
  [512, 768, 4, false],
)
assert.deepEqual(
  [ROOM_QUALITY_PROFILES.low.cardWidth, ROOM_QUALITY_PROFILES.low.cardHeight, ROOM_QUALITY_PROFILES.low.cardAnisotropy, ROOM_QUALITY_PROFILES.low.shadows, ROOM_QUALITY_PROFILES.low.foilDistance],
  [384, 576, 2, false, .45],
)
assert.equal(roomQualityProfile('unexpected'), ROOM_QUALITY_PROFILES.medium)
console.log('room quality profiles: ok')
