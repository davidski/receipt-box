import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { costLine, selectPurchase, summarizeRecipeCost } from '../shared/utils/recipe-cost.ts'
import { toBaseUnit } from '../shared/utils/units.ts'

const purchase = (overrides = {}) => ({ price: '4.00', size: '500.000', unit: 'g', saleItem: false, ...overrides })
const line = (overrides = {}) => ({ item: 'Flour', quantity: 100, unit: 'g', ...overrides })

const candidate = (id, purchasedOn, overrides = {}) => ({ ...purchase(), id, item: 'Flour', purchasedOn, ...overrides })

describe('selectPurchase', () => {
  test('a newer sale beats an older non-sale and sets usedSalePrice', () => {
    const selected = selectPurchase([candidate('1', '2026-01-01'), candidate('2', '2026-02-01', { saleItem: true })])
    assert.equal(selected.id, '2')
    assert.equal(selected.usedSalePrice, true)
  })

  test('a newer non-sale beats an older sale', () => {
    const selected = selectPurchase([candidate('2', '2026-02-01'), candidate('1', '2026-01-01', { saleItem: true })])
    assert.equal(selected.id, '2')
    assert.equal(selected.usedSalePrice, false)
  })

  test('skips newer purchases with no size, a zero size or no unit', () => {
    for (const bad of [{ size: null, unit: null }, { size: null }, { size: '0.000' }, { unit: null }]) {
      assert.equal(selectPurchase([candidate('2', '2026-02-01', bad), candidate('1', '2026-01-01')]).id, '1')
    }
  })

  test('returns null when nothing is eligible or there are no candidates', () => {
    assert.equal(selectPurchase([candidate('1', '2026-01-01', { size: null })]), null)
    assert.equal(selectPurchase([]), null)
  })

  test('breaks a same-date tie on the highest id, numerically and in any order', () => {
    const [low, high] = [candidate('9', '2026-01-01'), candidate('10', '2026-01-01')]
    assert.equal(selectPurchase([low, high]).id, '10')
    assert.equal(selectPurchase([high, low]).id, '10')
  })

  test('treats a $0 price as eligible', () => {
    assert.equal(selectPurchase([candidate('1', '2026-01-01', { price: '0.00' })]).price, '0.00')
  })

  test('selects across item names and returns the exact observation', () => {
    const selected = selectPurchase([
      candidate('1', '2026-01-01'),
      { ...candidate('2', '2026-03-01', { item: 'Bread Flour', saleItem: true }), eligible: true },
      candidate('3', '2026-02-01', { item: 'Cake Flour' })
    ])
    assert.deepEqual(selected, {
      id: '2', item: 'Bread Flour', price: '4.00', size: '500.000', unit: 'g',
      saleItem: true, purchasedOn: '2026-03-01', usedSalePrice: true
    })
  })
})

describe('toBaseUnit', () => {
  test('converts mass, volume and each to base units', () => {
    assert.deepEqual(toBaseUnit(2, 'kg'), { base: 'g', amount: 2000 })
    assert.deepEqual(toBaseUnit(1, 'cups'), { base: 'mL', amount: 236.5882365 })
    assert.deepEqual(toBaseUnit(3, 'each'), { base: 'ea', amount: 3 })
  })

  test('rejects blank and unknown units', () => {
    assert.equal(toBaseUnit(1, ''), null)
    assert.equal(toBaseUnit(1, 'bunch'), null)
  })
})

describe('costLine', () => {
  test('prices a same-unit quantity', () => {
    assert.deepEqual(costLine(line(), purchase()), { ...line(), cost: 0.8, sale: false, error: null })
  })

  test('flags a sale price', () => {
    assert.equal(costLine(line(), purchase({ saleItem: true })).sale, true)
  })

  test('converts ounces against a gram package', () => {
    // 4 oz = 113.398 g of a $4.00 / 500 g package
    assert.equal(costLine(line({ quantity: 4, unit: 'oz' }), purchase()).cost, 0.91)
  })

  test('converts pounds and grams in both directions, including the gr alias', () => {
    assert.equal(costLine(line({ quantity: 100, unit: 'gr' }), purchase({ price: 10, size: 1, unit: 'lb' })).cost, 2.2)
    assert.equal(costLine(line({ quantity: 1, unit: 'lb' }), purchase({ price: 10, size: 1000, unit: 'g' })).cost, 4.54)
  })

  test('converts cups against a millilitre package', () => {
    // 1 cup = 236.588 mL of a $3.00 / 1000 mL package
    assert.equal(costLine(line({ item: 'Milk', unit: 'cup', quantity: 1 }), purchase({ price: 3, size: 1, unit: 'L' })).cost, 0.71)
  })

  test('prices eaches only against eaches', () => {
    const eggs = line({ item: 'Eggs', quantity: 3, unit: 'ea' })
    assert.equal(costLine(eggs, purchase({ price: '6.00', size: '12', unit: 'ct' })).cost, 1.5)
    assert.equal(costLine({ ...eggs, unit: 'g' }, purchase({ price: '6.00', size: '12', unit: 'ea' })).error, 'INCOMPATIBLE_UNIT')
  })

  test('reports NO_PRICE without a purchase', () => {
    assert.deepEqual(costLine(line(), null), { ...line(), cost: null, sale: false, error: 'NO_PRICE' })
  })

  test('reports NO_PACKAGE_SIZE for a missing or non-positive size or unit', () => {
    for (const bad of [{ size: null }, { size: '0' }, { size: '-1' }, { unit: null }]) {
      assert.equal(costLine(line(), purchase(bad)).error, 'NO_PACKAGE_SIZE')
    }
  })

  test('reports INCOMPATIBLE_UNIT across dimensions and for unknown units', () => {
    assert.equal(costLine(line({ unit: 'cup' }), purchase()).error, 'INCOMPATIBLE_UNIT')
    assert.equal(costLine(line({ unit: 'bunch' }), purchase()).error, 'INCOMPATIBLE_UNIT')
    assert.equal(costLine(line(), purchase({ unit: 'bunch' })).error, 'INCOMPATIBLE_UNIT')
  })
})

describe('summarizeRecipeCost', () => {
  test('totals priced lines in cents and counts errored lines', () => {
    const lines = [
      costLine(line(), purchase({ price: '0.10', size: '100' })),
      costLine(line({ quantity: 200 }), purchase({ price: '0.10', size: '100' })),
      costLine(line(), null),
      costLine(line({ unit: 'cup' }), purchase())
    ]
    assert.deepEqual(summarizeRecipeCost(lines), { total: 0.3, excluded: 2 })
  })

  test('is zero for no lines', () => {
    assert.deepEqual(summarizeRecipeCost([]), { total: 0, excluded: 0 })
  })
})
