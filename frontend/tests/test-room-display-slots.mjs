import assert from 'node:assert/strict'
import { displaySlotsFor, displaySlotCount, standMeshScale } from '../src/components/tcg-room/roomLayout.js'

const CARD_HEIGHT = .1056
const ledges = [.00303, .12271, .24240]
const lips = [.01818, .13786, .25755]
const shelfZ = [[-.0785, -.0275], [-.0255, .0255], [.0275, .0785]]
const wide = displaySlotsFor('graded_card_stand_black')
assert.equal(wide.length, 9)
for (let index = 0; index < wide.length; index += 1) {
  const slot = wide[index]
  const row = Math.floor(index / 3)
  const halfHeight = CARD_HEIGHT * Math.cos(slot.tilt) / 2
  assert.ok(slot.y - halfHeight > ledges[row], `slot ${index} clears its stepped ledge`)
  assert.ok(slot.y - halfHeight < lips[row], `slot ${index} rests before its shelf lip`)
  assert.ok(slot.y + halfHeight < .377, `slot ${index} stays below the backplate`)
  const halfDepth = CARD_HEIGHT * Math.sin(slot.tilt) / 2
  const zRange = shelfZ[row]
  assert.ok(slot.z - halfDepth > zRange[0] && slot.z + halfDepth < zRange[1], `slot ${index} stays within its shelf depth`)
}
assert.equal(displaySlotCount('card_display_stand_white'), 1)
assert.equal(standMeshScale('card_display_stand_white'), .42)
const single = displaySlotsFor('card_display_stand_white')[0]
const singleCardHeight = CARD_HEIGHT * single.scale
const singleCardWidth = .0756 * single.scale
const singleHalfHeight = singleCardHeight * Math.cos(single.tilt) / 2
assert.ok(single.y - singleHalfHeight > 0)
assert.ok(single.y + singleHalfHeight < .252706 * .42)
assert.ok(single.z > 0, 'single card sits on the open face of the stand')
assert.ok(singleCardWidth < .143 * .42, 'single card clears the compact holder rim')
// The holder's inner card support slopes dz/dy≈.233; the fitted card uses
// the corresponding .23 rad tilt and is scaled to leave a visible rim.
assert.ok(Math.abs(Math.tan(single.tilt) - .233) < .01, 'single card follows the holder slope')
assert.ok(Math.abs(single.yaw + .13313) < .001, 'single card follows the holder yaw')
// With host yaw π, Rx(-tilt) sends the card top toward +Z (back into the
// graded support), while the lower edge moves toward -Z/front.
assert.ok(-Math.sin(wide[0].tilt) > 0, 'graded card top leans back toward +Z')
for (const assetId of ['graded_card_stand', 'graded_card_stand_white', 'graded_card_stand_black']) assert.deepEqual(displaySlotsFor(assetId), wide)
console.log('room display slot geometry: PASS')
