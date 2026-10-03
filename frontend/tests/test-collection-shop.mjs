import assert from 'node:assert/strict'
import { BINDER_PRODUCTS, priceCart } from '../src/components/tcg-workspace/shopCatalog.js'
import { checkoutCart } from '../src/components/tcg-workspace/shopCheckout.js'
const pack = { id: 42, kind: 'packs', price: 400, tokens: 2, product_kind: 'permanent' }
const tokenLines = priceCart([{ key: 'a', product: pack, quantity: 1, releaseId: 1 }, { key: 'b', product: pack, quantity: 2, releaseId: 2 }], 1)
assert.deepEqual(tokenLines.map(line => line.total), [0, 400])
assert.deepEqual(priceCart([{ product: BINDER_PRODUCTS[0], quantity: 2 }, { product: BINDER_PRODUCTS[1], quantity: 1 }], 0).map(line => line.total), [1200, 1200])
assert.equal(priceCart([{ product: BINDER_PRODUCTS[0], quantity: 2 }], 1)[0].total, 2400)
const requests = [], completed = [], opened = []
await checkoutCart(tokenLines, { openPack: async (id, data) => { requests.push({ id, ...data }); return { data: { cards: [{ id: requests.length }], product: { card_count: 1 } } } } }, key => completed.push(key), () => {}, opened)
assert.deepEqual(requests.map(row => row.use_token), [true, true, false])
assert.deepEqual(requests.map(row => row.selected_release_id), [1, 2, 2])
assert.equal(opened.length, 3)
assert.deepEqual(completed, ['a', 'b', 'b'])
const purchased = []
await checkoutCart(priceCart([{ key: 'binder', product: BINDER_PRODUCTS[3], quantity: 2 }], 1), { createBinder: async data => purchased.push(data) }, () => {}, () => {}, [])
assert.equal(purchased.length, 2)
assert.ok(purchased.every(row => row.cover_style === 'rose-metal'))
let attempt = 0
const partial = [], delivered = []
await assert.rejects(checkoutCart(tokenLines, { openPack: async () => { if (++attempt === 2) throw new Error('Unavailable'); return { data: { cards: [{ id: 99 }] } } } }, key => partial.push(key), () => {}, delivered), /Unavailable/)
assert.deepEqual(partial, ['a'])
assert.equal(delivered.length, 1)
console.log('Shop checks passed: quantities, binder variants, free first binder, shared tokens, release selection, multi-pack reveals, partial failures.')
