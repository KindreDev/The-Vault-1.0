import assert from 'node:assert/strict'
import { localCalendarDay, selectDailyTraderOutfit, traderVisualKey } from '../src/components/tcg-room/traderVisuals.js'

const outfits = [{ id: 'a' }, { id: 'b' }]
const traderId = 'yoruichi'
const firstDay = new Date(2026, 8, 1, 12)
const sameDay = new Date(2026, 8, 1, 23, 59)
assert.equal(localCalendarDay(firstDay), localCalendarDay(sameDay))
assert.equal(selectDailyTraderOutfit(traderId, outfits, firstDay), selectDailyTraderOutfit(traderId, outfits, sameDay))
assert.equal(selectDailyTraderOutfit(traderId, [outfits[0]], firstDay), outfits[0])
assert.equal(selectDailyTraderOutfit(traderId, [], firstDay), null)
assert.equal(traderVisualKey({ id: 'yoruichi', name: 'Renamed Trader' }), traderId)
assert.equal(traderVisualKey({ id: 'other', name: 'Yoru inspired visitor' }), '')

const dailyChoices = Array.from({ length: 60 }, (_, offset) => {
  const date = new Date(2026, 8, 1 + offset, 12)
  return selectDailyTraderOutfit(traderId, outfits, date).id
})
assert.equal(new Set(dailyChoices).size, outfits.length, 'each configured outfit should be reachable')
assert.ok(dailyChoices.some((choice, index) => index > 0 && choice === dailyChoices[index - 1]), 'daily selection should not strictly alternate')
console.log('Trader visual configuration and daily outfit selection passed.')
