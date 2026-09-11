import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeTCGV2CardType,
  resolveTCGV2CardFace,
  TCG_V2_CARD_TYPES,
} from './cardFaceResolver.js'

const visualKeyByType = {
  scene: 'scene_visual',
  character: 'character_visual',
  cosplay: 'cosplay_visual',
  collab: 'collab_visual',
  creator: 'creator_visual',
  gallery: 'gallery_visual',
  bond: 'bond_visual',
  'hall-of-fame': 'hof_visual',
}

test('routes all eight frozen visual contracts without rewriting them', () => {
  for (const type of TCG_V2_CARD_TYPES) {
    const recipe = { schema: `test.${type}`, templateId: `${type}-approved` }
    const card = {
      id: 7,
      card_type: 'image',
      image_url: '/source.jpg',
      mask_url: '/mask.png',
      [visualKeyByType[type]]: { recipe, art_url: '/visual.jpg' },
    }
    const face = resolveTCGV2CardFace(card)
    assert.equal(face.type, type)
    assert.equal(face.recipe, recipe)
    assert.equal(face.artUrl, '/visual.jpg')
    assert.equal(face.packedMaskUrl, '/mask.png')
  }
})

test('maps legacy storage names to visible V2 card types', () => {
  assert.equal(normalizeTCGV2CardType('image'), 'scene')
  assert.equal(normalizeTCGV2CardType('variant'), 'cosplay')
  assert.equal(normalizeTCGV2CardType('hof'), 'hall-of-fame')
})

test('does not invent a renderable face when recipe or art is missing', () => {
  assert.equal(resolveTCGV2CardFace({ card_type: 'gallery', gallery_visual: {} }), null)
  assert.equal(resolveTCGV2CardFace({
    card_type: 'gallery', gallery_visual: { recipe: { templateId: 'approved' } },
  }), null)
})

test('keeps signatures optional', () => {
  const face = resolveTCGV2CardFace({
    card_type: 'bond',
    bond_visual: { recipe: { templateId: 'approved' }, art_url: '/art.jpg' },
  })
  assert.equal(face.signatureUrl, null)
  assert.deepEqual(face.signatureUrls, [])
})

test('uses the live collection class when a frozen recipe has stale rarity', () => {
  const face = resolveTCGV2CardFace({
    card_type: 'scene',
    rarity_class: 'SPR',
    scene_visual: {
      recipe: { templateId: 'approved', rarity: 'SR', snapshot: { creatorName: 'Example' } },
      art_url: '/art.jpg',
    },
  })
  assert.equal(face.recipe.rarity, 'SPR')
  assert.equal(face.recipe.snapshot.creatorName, 'Example')
})

test('normalizes single and multiple signature assets without inventing them', () => {
  const single = resolveTCGV2CardFace({
    card_type: 'character',
    character_visual: { recipe: { templateId: 'approved' }, art_url: '/art.jpg', signature_url: '/sig.png' },
  })
  assert.equal(single.signatureUrl, '/sig.png')
  assert.deepEqual(single.signatureUrls, ['/sig.png'])

  const multiple = resolveTCGV2CardFace({
    card_type: 'collab',
    collab_visual: {
      recipe: { templateId: 'approved' },
      art_url: '/art.jpg',
      signature_urls: ['/first.png', '/second.png'],
    },
  })
  assert.equal(multiple.signatureUrl, null)
  assert.deepEqual(multiple.signatureUrls, ['/first.png', '/second.png'])
})

test('passes the frozen gallery photo stack to the gallery renderer', () => {
  const face = resolveTCGV2CardFace({
    card_type: 'gallery',
    gallery_visual: {
      recipe: { templateId: 'approved' },
      art_url: '/hero.jpg',
      stack_art_urls: ['/rear-1.jpg', '/rear-2.jpg', '/rear-3.jpg'],
    },
  })
  assert.deepEqual(face.stackArtUrls, ['/rear-1.jpg', '/rear-2.jpg', '/rear-3.jpg'])
})
