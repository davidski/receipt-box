import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeUnit, STANDARD_UNITS } from '../shared/utils/units.ts'

describe('normalizeUnit', () => {
  test('returns null for missing or blank values', () => {
    for (const value of [undefined, null, '', '   ']) {
      assert.equal(normalizeUnit(value), null)
    }
  })

  test('normalizes mass and volume aliases', () => {
    const cases = [
      ['Grams', 'g'],
      [' kilogrammes ', 'kg'],
      ['ML', 'mL'],
      ['litres', 'L'],
      ['FL.   OZ.', 'fl oz'],
      ['ounces', 'oz'],
      ['LBS.', 'lb'],
      ['tablespoons', 'tbsp']
    ]
    for (const [input, expected] of cases) {
      assert.equal(normalizeUnit(input), expected, input)
    }
  })

  test('normalizes count aliases to each', () => {
    for (const alias of ['ea', 'each', 'unit', 'count', 'ct', 'pieces', 'pc']) {
      assert.equal(normalizeUnit(alias), 'ea', alias)
    }
  })

  test('preserves trimmed custom units', () => {
    assert.equal(normalizeUnit('  bunch  '), 'bunch')
  })

  test('lists unique canonical units', () => {
    assert.equal(new Set(STANDARD_UNITS).size, STANDARD_UNITS.length)
    for (const unit of STANDARD_UNITS) assert.equal(normalizeUnit(unit), unit)
  })
})
