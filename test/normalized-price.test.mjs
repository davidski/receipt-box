import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizedHistoricalPrice } from '../shared/utils/normalized-price.ts'

function closeTo(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

describe('normalizedHistoricalPrice', () => {
  test('normalizes metric mass prices per 100 grams', () => {
    assert.deepEqual(normalizedHistoricalPrice(4, 500, 'g', null), {
      basis: 'mass', label: 'Per 100 g', value: 0.8
    })
    assert.deepEqual(normalizedHistoricalPrice(8, 2, 'kg', null), {
      basis: 'mass', label: 'Per 100 g', value: 0.4
    })
  })

  test('normalizes imperial mass prices per 100 grams', () => {
    const result = normalizedHistoricalPrice(5, 1, 'lb', null)
    assert.equal(result?.basis, 'mass')
    closeTo(result.value, (5 / 453.59237) * 100)
  })

  test('normalizes volume prices per 100 milliliters', () => {
    assert.deepEqual(normalizedHistoricalPrice(3, 1.5, 'L', null), {
      basis: 'volume', label: 'Per 100 mL', value: 0.2
    })
    const result = normalizedHistoricalPrice(6, 2, 'cups', null)
    closeTo(result.value, (6 / (2 * 236.5882365)) * 100)
  })

  test('uses a valid stored cost when package size is unavailable', () => {
    assert.deepEqual(normalizedHistoricalPrice(10, null, 'g', 0.25), {
      basis: 'mass', label: 'Per 100 g', value: 0.25
    })
    assert.deepEqual(normalizedHistoricalPrice(10, null, 'kg', 4), {
      basis: 'mass', label: 'Per 100 g', value: 0.4
    })
  })

  test('normalizes countable items per each', () => {
    assert.deepEqual(normalizedHistoricalPrice(6, 12, 'ct', null), {
      basis: 'each', label: 'Each', value: 0.5
    })
    assert.deepEqual(normalizedHistoricalPrice(6, null, 'ea', null), {
      basis: 'each', label: 'Each', value: 6
    })
  })

  test('preserves custom-unit stored costs', () => {
    assert.deepEqual(normalizedHistoricalPrice(7, 2, 'bunch', 3.5), {
      basis: 'unit:bunch', label: 'Per bunch', value: 3.5
    })
  })

  test('rejects invalid prices and unusable normalization data', () => {
    for (const args of [
      ['invalid', 1, 'kg', null],
      [-1, 1, 'kg', null],
      [5, 0, 'kg', null],
      [5, null, 'kg', -1],
      [5, 1, 'custom', null]
    ]) {
      assert.equal(normalizedHistoricalPrice(...args), null)
    }
  })
})
