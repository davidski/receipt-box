import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseCalendarDate } from '../app/utils/calendar-date.ts'

describe('parseCalendarDate', () => {
  test('parses a calendar date at local noon', () => {
    const date = parseCalendarDate('2026-08-06')
    assert.ok(date instanceof Date)
    assert.equal(date.getFullYear(), 2026)
    assert.equal(date.getMonth(), 7)
    assert.equal(date.getDate(), 6)
    assert.equal(date.getHours(), 12)
  })

  test('accepts a timestamp beginning with a calendar date', () => {
    assert.equal(parseCalendarDate('2024-02-29T23:59:00Z')?.getDate(), 29)
  })

  test('returns null for missing and malformed values', () => {
    for (const value of [
      undefined,
      null,
      '',
      '08/06/2026',
      '2026-8-6',
      'not-a-date',
      '2026-02-29',
      '2026-02-31',
      '2026-13-01'
    ]) {
      assert.equal(parseCalendarDate(value), null)
    }
  })
})
