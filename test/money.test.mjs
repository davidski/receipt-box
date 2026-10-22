import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatCurrency, formatSignedCurrency, formatSignedPercent, splitCurrency } from '../shared/utils/money.ts'

describe('formatCurrency', () => {
  test('shows cents by default, for prices and receipt totals', () => {
    assert.equal(formatCurrency(6794), '$6,794.00')
    assert.equal(formatCurrency('2.5'), '$2.50')
    assert.equal(formatCurrency(0.444), '$0.44')
  })

  test('shows whole dollars for aggregates', () => {
    assert.equal(formatCurrency(6793.55, { whole: true }), '$6,794')
    assert.equal(formatCurrency(0.4, { whole: true }), '$0')
  })
})

describe('formatSignedCurrency', () => {
  test('signs increases and decreases with plus and a true minus', () => {
    // Highlights used to show this change as "-$3", with a hyphen instead of a minus sign.
    assert.equal(formatSignedCurrency(-3), '−$3.00')
    assert.equal(formatSignedCurrency(12.5), '+$12.50')
    assert.equal(formatSignedCurrency(0), '$0.00')
    assert.equal(formatSignedCurrency(-3.29, { whole: true }), '−$3')
  })

  test('shows a dash when there is no value', () => {
    assert.equal(formatSignedCurrency(null), '—')
    assert.equal(formatSignedCurrency(Number.NaN), '—')
  })

  test('drops the sign from an amount that rounds to zero', () => {
    assert.equal(formatSignedCurrency(-0.004), '$0.00')
    assert.equal(formatSignedCurrency(0.4, { whole: true }), '$0')
  })
})

describe('formatSignedPercent', () => {
  test('signs increases and decreases with plus and a true minus', () => {
    assert.equal(formatSignedPercent(12), '+12%')
    assert.equal(formatSignedPercent(-6), '−6%')
    assert.equal(formatSignedPercent(-12.5, { digits: 1 }), '−12.5%')
    assert.equal(formatSignedPercent(1234, { digits: 0 }), '+1,234%')
    assert.ok(!formatSignedPercent(-6).includes('-'))
  })

  test('rounds to the requested digits and drops the sign at zero', () => {
    assert.equal(formatSignedPercent(12.46), '+12%')
    assert.equal(formatSignedPercent(12.46, { digits: 1 }), '+12.5%')
    assert.equal(formatSignedPercent(0), '0%')
    assert.equal(formatSignedPercent(-0.2), '0%')
  })

  test('shows a dash when there is no value', () => {
    assert.equal(formatSignedPercent(null), '—')
    assert.equal(formatSignedPercent(Number.POSITIVE_INFINITY), '—')
  })
})

describe('splitCurrency', () => {
  test('separates dollars from cents', () => {
    assert.deepEqual(splitCurrency(111.49), { whole: '$111', cents: '.49' })
    assert.deepEqual(splitCurrency(6794), { whole: '$6,794', cents: '.00' })
  })
})
