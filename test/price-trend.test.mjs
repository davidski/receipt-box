import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { regularPriceTrend, rollingRegularMedian } from '../shared/utils/price-trend.ts'

const TODAY = '2026-11-01'
const at = (purchasedOn, normalizedPrice, saleItem = false) => ({ purchasedOn, normalizedPrice, saleItem })
const earlier = (...prices) => prices.map((price, index) => at(`2025-0${index + 6}-15`, price))
const recent = (...prices) => prices.map((price, index) => at(`2026-0${index + 6}-15`, price))

describe('regularPriceTrend', () => {
  test('compares median regular prices a year apart', () => {
    const trend = regularPriceTrend([...earlier(1, 1, 9), ...recent(1.2, 1.2, 0.1)], TODAY)
    assert.equal(trend.from, 1)
    assert.equal(trend.to, 1.2)
    assert.ok(Math.abs(trend.change - 20) < 1e-9)
    assert.equal(trend.direction, 'up')
  })

  test('averages the middle two of an even count', () => {
    assert.equal(regularPriceTrend([...earlier(1, 1, 1, 3), ...recent(2, 2, 2)], TODAY).from, 1)
    assert.equal(regularPriceTrend([...earlier(1, 2, 3, 4), ...recent(2, 2, 2)], TODAY).from, 2.5)
  })

  test('reports a fall', () => {
    assert.equal(regularPriceTrend([...earlier(2, 2, 2), ...recent(1, 1, 1)], TODAY).direction, 'down')
  })

  test('treats a move under 2% as steady, and 2% as a move', () => {
    assert.equal(regularPriceTrend([...earlier(1, 1, 1), ...recent(1.019, 1.019, 1.019)], TODAY).direction, 'steady')
    assert.equal(regularPriceTrend([...earlier(1, 1, 1), ...recent(0.981, 0.981, 0.981)], TODAY).direction, 'steady')
    assert.equal(regularPriceTrend([...earlier(1, 1, 1), ...recent(1.02, 1.02, 1.02)], TODAY).direction, 'up')
  })

  test('leaves sale prices out of the medians but counts them as recent sales', () => {
    const trend = regularPriceTrend([...earlier(1, 1, 1), at('2025-06-20', 0.1, true), ...recent(1, 1, 1), at('2026-06-20', 0.1, true)], TODAY)
    assert.equal(trend.from, 1)
    assert.equal(trend.to, 1)
    assert.equal(trend.recentPurchases, 4)
    assert.equal(trend.recentSales, 1)
  })

  test('returns null when either period has too few regular purchases', () => {
    assert.equal(regularPriceTrend([...earlier(1, 1), ...recent(1, 1, 1)], TODAY), null)
    assert.equal(regularPriceTrend([...earlier(1, 1, 1), ...recent(1, 1)], TODAY), null)
    assert.equal(regularPriceTrend([...earlier(1, 1, 1), ...recent(1, 1).concat(at('2026-09-01', 1, true))], TODAY), null)
    assert.equal(regularPriceTrend([], TODAY), null)
  })

  test('returns null rather than dividing by a free earlier price', () => {
    assert.equal(regularPriceTrend([...earlier(0, 0, 0), ...recent(1, 1, 1)], TODAY), null)
  })

  test('applies the period boundaries', () => {
    const inside = [at('2025-05-02', 1), at('2025-08-01', 1), at('2025-11-01', 1), at('2026-05-02', 1), at('2026-08-01', 1), at('2026-11-01', 1)]
    assert.notEqual(regularPriceTrend(inside, TODAY), null)
    const outside = [at('2025-05-01', 1), at('2025-08-01', 1), at('2025-11-01', 1), at('2026-05-01', 1), at('2026-08-01', 1), at('2026-11-01', 1)]
    assert.equal(regularPriceTrend(outside, TODAY), null)
    const gap = [at('2025-11-02', 5), at('2025-12-01', 5), at('2026-01-01', 5), ...recent(1, 1, 1)]
    assert.equal(regularPriceTrend(gap, TODAY), null)
  })

  test('accepts timestamps as purchase dates', () => {
    assert.notEqual(regularPriceTrend([...earlier(1, 1, 1), ...recent(1, 1), at('2026-11-01T00:00:00.000Z', 1)], TODAY), null)
  })
})

describe('rollingRegularMedian', () => {
  test('takes the median of regular prices inside the window and skips sales', () => {
    const points = [at('2026-01-01', 1), at('2026-01-02', 0.1, true), at('2026-01-03', 2), at('2026-01-05', 9), at('2026-06-01', 5)]
    assert.deepEqual(rollingRegularMedian(points, 60).map(({ value }) => value), [2, 2, 2, 5])
    assert.deepEqual(rollingRegularMedian(points, 60).map(({ point }) => point.normalizedPrice), [1, 2, 9, 5])
  })

  test('includes the window edge and excludes the day after it', () => {
    assert.equal(rollingRegularMedian([at('2026-01-01', 1), at('2026-03-02', 3)], 60)[0].value, 2)
    assert.equal(rollingRegularMedian([at('2026-01-01', 1), at('2026-03-03', 3)], 60)[0].value, 1)
  })

  test('defaults to 60 days and handles an empty list', () => {
    assert.equal(rollingRegularMedian([at('2026-01-01', 1), at('2026-03-02', 3)])[0].value, 2)
    assert.deepEqual(rollingRegularMedian([]), [])
  })
})
