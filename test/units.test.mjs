import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeMealieQuantity, normalizePackageQuantity, normalizeUnit, STANDARD_UNITS, toBaseUnit } from '../shared/utils/units.ts'

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

describe('toBaseUnit', () => {
  test('converts the issue acceptance cases to canonical units', () => {
    const cases = [
      [1, 'lb', 'g', 453.59237],
      [16, 'oz', 'g', 453.59237],
      [1, 'cup', 'mL', 236.5882365],
      [16, 'tbsp', 'mL', 236.5882365],
      [1, 'kg', 'g', 1000],
      [1, 'L', 'mL', 1000],
      [3, 'ea', 'ea', 3]
    ]
    for (const [quantity, unit, base, amount] of cases) {
      const result = toBaseUnit(quantity, unit)
      assert.equal(result.base, base, unit)
      assert.ok(Math.abs(result.amount - amount) < 1e-9, `${quantity} ${unit} = ${result.amount}`)
    }
  })

  test('keeps oz (mass) and fl oz (volume) apart', () => {
    assert.equal(toBaseUnit(1, 'oz').base, 'g')
    assert.equal(toBaseUnit(1, 'fl oz').base, 'mL')
  })

  test('returns null for blank and unconvertible units', () => {
    assert.equal(toBaseUnit(1, null), null)
    assert.equal(toBaseUnit(1, 'bunch'), null)
  })
})

describe('normalizePackageQuantity', () => {
  test('normalizes eligible packages', () => {
    assert.deepEqual(normalizePackageQuantity({ size: '5', unit: 'lb' }), { base: 'g', amount: 5 * 453.59237 })
    assert.deepEqual(normalizePackageQuantity({ size: 12, unit: 'ea', nonGrocery: false }), { base: 'ea', amount: 12 })
  })

  test('excludes non_grocery, bad sizes, and missing or unknown units', () => {
    const bad = [
      { size: 5, unit: 'lb', nonGrocery: true },
      { size: null, unit: 'lb' },
      { size: '', unit: 'lb' },
      { size: 0, unit: 'lb' },
      { size: -1, unit: 'lb' },
      { size: 'abc', unit: 'lb' },
      { size: {}, unit: 'lb' },
      { size: Infinity, unit: 'lb' },
      { size: 5, unit: null },
      { size: 5, unit: '' },
      { size: 5, unit: 'bunch' }
    ]
    for (const input of bad) assert.equal(normalizePackageQuantity(input), null, JSON.stringify(input))
  })
})

describe('normalizeMealieQuantity', () => {
  const close = (result, base, amount) => {
    assert.equal(result.base, base)
    assert.ok(Math.abs(result.amount - amount) < 1e-9, String(result.amount))
  }

  test('multiplies quantity × standardQuantity × unit factor', () => {
    close(normalizeMealieQuantity(2, 0.5, 'fluid_ounce'), 'mL', 29.5735295625)
    close(normalizeMealieQuantity('2', '0.5', 'fluid_ounce'), 'mL', 29.5735295625)
  })

  test('accepts exactly the eight Mealie standard units', () => {
    const expected = {
      gram: ['g', 1],
      kilogram: ['g', 1000],
      ounce: ['g', 28.349523125],
      pound: ['g', 453.59237],
      liter: ['mL', 1000],
      milliliter: ['mL', 1],
      cup: ['mL', 236.5882365],
      fluid_ounce: ['mL', 29.5735295625]
    }
    for (const [unit, [base, amount]] of Object.entries(expected)) {
      close(normalizeMealieQuantity(1, 1, unit), base, amount)
    }
  })

  test('treats ounce as mass, never fluid_ounce', () => {
    assert.equal(normalizeMealieQuantity(1, 1, 'ounce').base, 'g')
  })

  test('accepts decimal strings but rejects hex, exponent and padded strings', () => {
    close(normalizeMealieQuantity('2', '0.5', 'fluid_ounce'), 'mL', 29.5735295625)
    close(normalizeMealieQuantity('.5', 1, 'gram'), 'g', 0.5)
    for (const value of ['0x10', '1e3', ' 1', '1.', '-1', 'Infinity']) {
      assert.equal(normalizeMealieQuantity(value, 1, 'gram'), null, value)
      assert.equal(normalizePackageQuantity({ size: value, unit: 'g' }), null, value)
    }
  })

  test('anything else is unstandardized', () => {
    for (const unit of ['milligram', 'tbsp', 'Cup', 'fl oz', 'g', '', 'constructor', null, undefined, 5]) {
      assert.equal(normalizeMealieQuantity(1, 1, unit), null, String(unit))
    }
  })

  test('rejects missing and non-positive quantities', () => {
    const bad = [null, undefined, '', 0, -1, NaN, 'x', {}]
    for (const value of bad) {
      assert.equal(normalizeMealieQuantity(value, 1, 'gram'), null, `quantity ${String(value)}`)
      assert.equal(normalizeMealieQuantity(1, value, 'gram'), null, `standardQuantity ${String(value)}`)
    }
  })

  test('rejects a product that overflows to Infinity', () => {
    assert.equal(normalizeMealieQuantity(1e308, 10, 'gram'), null)
  })
})
