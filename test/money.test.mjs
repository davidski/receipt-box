import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatCurrency, formatSignedCurrency, splitCurrency } from '../shared/utils/money.ts'

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
})

describe('splitCurrency', () => {
  test('separates dollars from cents', () => {
    assert.deepEqual(splitCurrency(111.49), { whole: '$111', cents: '.49' })
    assert.deepEqual(splitCurrency(6794), { whole: '$6,794', cents: '.00' })
  })
})
