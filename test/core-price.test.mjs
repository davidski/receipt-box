import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { priceStability, priceTrend } from '../shared/utils/core-price.ts'

describe('priceStability', () => {
  test('requires three comparable observations', () => {
    assert.equal(priceStability(2, 0), 'limited')
    assert.equal(priceStability(5, null), 'limited')
    assert.equal(priceStability(5, Number.NaN), 'limited')
  })

  test('classifies the boundary of each change-velocity band', () => {
    assert.equal(priceStability(3, 2), 'stable')
    assert.equal(priceStability(3, 2.01), 'steady')
    assert.equal(priceStability(3, 5), 'steady')
    assert.equal(priceStability(3, 5.01), 'changing')
    assert.equal(priceStability(3, 10), 'changing')
    assert.equal(priceStability(3, 10.01), 'volatile')
  })
})

describe('priceTrend', () => {
  test('treats changes under two percent as effectively flat', () => {
    assert.equal(priceTrend(-1.99), 'flat')
    assert.equal(priceTrend(0), 'flat')
    assert.equal(priceTrend(1.99), 'flat')
  })

  test('reports direction at the boundary and handles missing values', () => {
    assert.equal(priceTrend(2), 'up')
    assert.equal(priceTrend(-2), 'down')
    assert.equal(priceTrend(null), 'unknown')
    assert.equal(priceTrend(Number.POSITIVE_INFINITY), 'unknown')
  })
})
