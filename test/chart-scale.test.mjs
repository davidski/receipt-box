import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { prettyScale } from '../shared/utils/chart-scale.ts'

describe('prettyScale', () => {
  test('rounds a price range to 1, 2 or 5 steps', () => {
    // The item chart used to label this range $0.36, $0.56, $0.75 and so on.
    assert.deepEqual(prettyScale(0.44, 1.06), { min: 0.4, max: 1.2, step: 0.2, breaks: [1.2, 1, 0.8, 0.6, 0.4] })
  })

  test('keeps the price index on whole steps with a minimum step', () => {
    assert.deepEqual(prettyScale(89.4, 100, { minStep: 1 }), { min: 85, max: 100, step: 5, breaks: [100, 95, 90, 85] })
  })

  test('uses 1, 2 and 5 as the only step mantissas', () => {
    assert.equal(prettyScale(0, 4).step, 1)
    assert.equal(prettyScale(0, 7).step, 2)
    assert.equal(prettyScale(0, 13).step, 5)
    assert.equal(prettyScale(0, 33).step, 10)
  })

  test('widens a flat series around its value', () => {
    assert.deepEqual(prettyScale(2.29, 2.29), { min: 2, max: 2.6, step: 0.2, breaks: [2.6, 2.4, 2.2, 2] })
    assert.deepEqual(prettyScale(3, 3), { min: 2.6, max: 3.4, step: 0.2, breaks: [3.4, 3.2, 3, 2.8, 2.6] })
    assert.deepEqual(prettyScale(0, 0), { min: -0.05, max: 0.05, step: 0.05, breaks: [0.05, 0, -0.05] })
  })

  test('every break is a whole multiple of the step', () => {
    for (const [lo, hi] of [[0.13, 0.97], [12.5, 87.2], [1.01, 1.04]]) {
      const { step, breaks, min, max } = prettyScale(lo, hi)
      assert.ok(min <= lo && max >= hi, `${lo}-${hi} fits in ${min}-${max}`)
      for (const value of breaks) assert.ok(Math.abs(value / step - Math.round(value / step)) < 1e-9, `${value} is a multiple of ${step}`)
    }
  })
})
