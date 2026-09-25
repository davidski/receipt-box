import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { findLikelyDuplicateItems } from '../shared/utils/item-duplicates.ts'

function item(name, uses = 1, lastUsed = '2026-08-01') {
  return { name, uses, lastUsed }
}

describe('likely duplicate item names', () => {
  test('groups formatting, plural, word-order, and spelling variations', () => {
    const groups = findLikelyDuplicateItems([
      item('Green Apples', 8),
      item('green-apples', 2),
      item('Tomato', 5),
      item('Tomatoes', 1),
      item('Whole Wheat Bread', 4),
      item('Bread Whole Wheat', 1),
      item('Broccoli', 7),
      item('Brocoli', 2)
    ])

    assert.equal(groups.length, 4)
    assert.deepEqual(groups.map(group => group.preferredTarget), [
      'Green Apples', 'Broccoli', 'Tomato', 'Whole Wheat Bread'
    ])
    assert.deepEqual(groups.flatMap(group => group.reasons).sort(), [
      'Formatting differs',
      'Possible spelling variation',
      'Same words in a different order',
      'Singular or plural wording'
    ])
  })

  test('prefers the most-used and then most-recent item name', () => {
    const [group] = findLikelyDuplicateItems([
      item('Mac & Cheese', 2, '2026-07-01'),
      item('Mac and Cheese', 2, '2026-08-01')
    ])
    assert.equal(group.preferredTarget, 'Mac and Cheese')
  })

  test('does not suggest numeric variants, short near-matches, or unrelated names', () => {
    assert.deepEqual(findLikelyDuplicateItems([
      item('Milk 1%'), item('Milk 2%'), item('Pear'), item('Peas'), item('Bread'), item('Butter'),
      item('Roasted salted sunflower seeds'), item('Roasted unsalted sunflower seeds'),
      item('Sunset mini cucumber'), item('Sunsweet mini cucumber'), item('   ')
    ]), [])
  })
})
