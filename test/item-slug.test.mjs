import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { itemSlug, itemSlugBase } from '../shared/utils/item-slug.ts'
import { itemPath } from '../app/utils/item-path.ts'

describe('item slugs', () => {
  test('creates readable ASCII bases', () => {
    assert.equal(itemSlugBase('  Crème Brûlée  '), 'creme-brulee')
    assert.equal(itemSlugBase("Trader Joe’s O's"), 'trader-joes-os')
    assert.equal(itemSlugBase('---'), 'item')
  })

  test('is stable for case and surrounding whitespace', () => {
    assert.equal(itemSlug(' Milk '), itemSlug('milk'))
  })

  test('uses the hash to distinguish names with the same base', () => {
    assert.equal(itemSlugBase("O'Brien"), itemSlugBase('OBrien'))
    assert.notEqual(itemSlug("O'Brien"), itemSlug('OBrien'))
  })

  test('creates the canonical item route', () => {
    const slug = itemSlug('Whole Milk')
    assert.equal(itemPath('Whole Milk'), `/items/${slug}`)
  })
})
