import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const {
  findRecipe,
  parseRecipeId,
  parseRecipeLines,
  parseRecipeName,
  priceRecipe,
  recipeWriteError,
  renameRecipeItems,
  snapshotTotal
} = await import('../server/utils/recipe-query.ts')
import { renameRecipeLineItems } from '../shared/utils/recipe-cost.ts'

function fakeSql(responses) {
  const queries = []
  const sql = (strings, ...values) => {
    queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return Promise.resolve(responses.shift() ?? [])
  }
  sql.json = value => ({ json: value })
  return { sql, queries }
}

const line = (item, quantity = 1, unit = 'g') => ({ item, quantity, unit })

describe('parseRecipeLines', () => {
  test('trims items and units and accepts a missing unit', () => {
    assert.deepEqual(parseRecipeLines([{ item: ' Flour ', quantity: 2, unit: ' cup ' }, { item: 'Egg', quantity: 1 }]), [
      line('Flour', 2, 'cup'), line('Egg', 1, '')
    ])
  })

  test('accepts the 100-line limit and rejects 101', () => {
    const lines = Array.from({ length: 100 }, (_, index) => line(`Item ${index}`))
    assert.equal(parseRecipeLines(lines).length, 100)
    assert.throws(() => parseRecipeLines([...lines, line('One more')]), { statusCode: 400 })
  })

  test('accepts an empty recipe', () => {
    assert.deepEqual(parseRecipeLines([]), [])
  })

  for (const [label, value] of [
    ['non-array', 'flour'],
    ['missing', undefined],
    ['non-object line', [null]],
    ['blank item', [line('   ')]],
    ['non-string item', [{ item: 4, quantity: 1 }]],
    ['zero quantity', [line('Flour', 0)]],
    ['negative quantity', [line('Flour', -1)]],
    ['string quantity', [{ item: 'Flour', quantity: '2' }]],
    ['infinite quantity', [line('Flour', Infinity)]],
    ['case-insensitive duplicate', [line('Flour'), line(' flour ')]]
  ]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => parseRecipeLines(value), { statusCode: 400 })
    })
  }
})

describe('parseRecipeLines food lines', () => {
  const flour = '11111111-1111-4111-8111-111111111111'
  const food = (overrides = {}) => ({ foodId: flour, foodName: ' Flour ', quantity: 2, unit: ' cup ', ...overrides })

  test('keeps a food line and its lowercased id beside item lines', () => {
    assert.deepEqual(parseRecipeLines([food({ foodId: flour.toUpperCase() }), { item: 'Egg', quantity: 1 }]), [
      { foodId: flour, foodName: 'Flour', quantity: 2, unit: 'cup' },
      line('Egg', 1, '')
    ])
  })

  test('accepts a food line without a name', () => {
    assert.equal(parseRecipeLines([food({ foodName: undefined })])[0].foodName, '')
  })

  for (const [label, value] of [
    ['a malformed food id', [food({ foodId: 'flour' })]],
    ['a non-string food id', [food({ foodId: 7 })]],
    ['a null food id', [food({ foodId: null })]],
    ['an item and a food on one line', [food({ item: 'Flour' })]],
    ['the same food twice', [food(), food({ foodId: flour.toUpperCase() })]],
    ['a food line quantity of 0', [food({ quantity: 0 })]]
  ]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => parseRecipeLines(value), { statusCode: 400 })
    })
  }

  test('allows an item and a food with the same name', () => {
    assert.equal(parseRecipeLines([food({ foodName: 'Flour' }), line('Flour')]).length, 2)
  })
})

describe('parseRecipeName and parseRecipeId', () => {
  test('trims the name and enforces 1 to 120 characters', () => {
    assert.equal(parseRecipeName('  Pancakes '), 'Pancakes')
    assert.equal(parseRecipeName('a'.repeat(120)).length, 120)
    for (const bad of ['', '   ', 'a'.repeat(121), 7, undefined]) {
      assert.throws(() => parseRecipeName(bad), { statusCode: 400 })
    }
  })

  test('accepts positive integer ids only', () => {
    assert.equal(parseRecipeId('12'), '12')
    assert.equal(parseRecipeId('9223372036854775807'), '9223372036854775807')
    for (const bad of [undefined, '', '0', '000', '-1', '1.5', 'x', '1; DROP', '9223372036854775808', '99999999999999999999999']) {
      assert.throws(() => parseRecipeId(bad), { statusCode: 400 })
    }
  })
})

describe('priceRecipe', () => {
  test('prices lines from the latest purchase and reports the purchase unit', async () => {
    const { sql, queries } = fakeSql([[{ item: 'Flour', price: '4.00', size: '500.000', unit: 'g', saleItem: false }]])
    const result = await priceRecipe(sql, [line('Flour', 250), line('Saffron')])

    assert.equal(result.total, 2)
    assert.equal(result.excluded, 1)
    assert.deepEqual(result.lines.map(({ item, cost, error, purchaseUnit }) => ({ item, cost, error, purchaseUnit })), [
      { item: 'Flour', cost: 2, error: null, purchaseUnit: 'g' },
      { item: 'Saffron', cost: null, error: 'NO_PRICE', purchaseUnit: null }
    ])
    assert.deepEqual(queries[0].values, [['Flour', 'Saffron']])
  })

  const row = (item, id, purchasedOn, overrides = {}) => (
    { id, item, purchasedOn, price: '4.00', size: '500.000', unit: 'g', saleItem: false, ...overrides }
  )

  test('uses an older usable purchase when the latest has no size', async () => {
    const { sql } = fakeSql([[
      row('Flour', '2', '2026-02-01', { price: '9.00', size: null, unit: null }),
      row('Flour', '1', '2026-01-01', { saleItem: true })
    ]])
    const { lines, total, excluded } = await priceRecipe(sql, [line('Flour', 250)])

    assert.deepEqual([total, excluded], [2, 0])
    assert.equal(lines[0].sale, true)
    assert.equal(lines[0].purchaseUnit, 'g')
  })

  test('reports NO_PACKAGE_SIZE when purchases exist but none is eligible', async () => {
    const { sql } = fakeSql([[row('Flour', '1', '2026-01-01', { size: null })]])
    const { lines, excluded } = await priceRecipe(sql, [line('Flour', 250)])

    assert.equal(lines[0].error, 'NO_PACKAGE_SIZE')
    assert.equal(excluded, 1)
  })

  test('prices a $0 purchase instead of excluding it', async () => {
    const { sql } = fakeSql([[row('Flour', '1', '2026-01-01', { price: '0.00' })]])
    const { lines, excluded } = await priceRecipe(sql, [line('Flour', 250)])

    assert.equal(lines[0].cost, 0)
    assert.equal(excluded, 0)
  })

  test('a blank or unrecognized unit still hides older purchases', async () => {
    for (const [unit, error] of [['', 'NO_PACKAGE_SIZE'], ['bunch', 'UNSTANDARDIZED_UNIT']]) {
      const { sql } = fakeSql([[row('Flour', '2', '2026-02-01', { unit }), row('Flour', '1', '2026-01-01')]])
      assert.equal((await priceRecipe(sql, [line('Flour', 250)])).lines[0].error, error)
    }
  })

  test('returns the purchase and base quantities behind each cost', async () => {
    const { sql } = fakeSql([[
      row('Flour', '1', '2026-01-01', { price: '4.79', size: '5.000', unit: 'lb', saleItem: true }),
      row('Sugar', '2', '2026-02-01', { price: '3.00', size: '500.000', unit: 'g' })
    ]])
    const { lines } = await priceRecipe(sql, [line('Flour', 100, 'g'), line('Sugar', 250, 'g')])

    assert.deepEqual(lines[0].purchase, { id: '1', item: 'Flour', price: '4.79', size: '5.000', unit: 'lb', saleItem: true, purchasedOn: '2026-01-01', usedSalePrice: true })
    assert.deepEqual([lines[0].normalizedQuantity, lines[0].normalizedPackageQuantity, lines[0].status], [{ base: 'g', amount: 100 }, { base: 'g', amount: 5 * 453.59237 }, 'unit_converted'])
    assert.deepEqual([lines[1].normalizedQuantity, lines[1].normalizedPackageQuantity, lines[1].status], [{ base: 'g', amount: 250 }, { base: 'g', amount: 500 }, 'exact'])
  })

  test('treats unit aliases as the same unit, not a conversion', async () => {
    const { sql } = fakeSql([[row('Flour', '1', '2026-01-01', { size: '2.000', unit: 'lb' })]])
    assert.equal((await priceRecipe(sql, [line('Flour', 1, 'lbs')])).lines[0].status, 'exact')
  })

  test('keeps the details of a $0 purchase', async () => {
    const { sql } = fakeSql([[row('Flour', '1', '2026-01-01', { price: '0.00' })]])
    const [flour] = (await priceRecipe(sql, [line('Flour', 250)])).lines

    assert.equal(flour.cost, 0)
    assert.equal(flour.status, 'exact')
    assert.equal(flour.purchase.price, '0.00')
  })

  test('has no details without a purchase, and no formula when the unit cannot convert', async () => {
    const { sql } = fakeSql([[row('Flour', '1', '2026-01-01'), row('Milk', '2', '2026-01-01', { size: null })]])
    const { lines } = await priceRecipe(sql, [line('Saffron'), line('Flour', 1, 'cup'), line('Milk', 1, 'g')])

    for (const [index, error] of [[0, 'NO_PRICE'], [1, 'DIMENSION_MISMATCH'], [2, 'NO_PACKAGE_SIZE']]) {
      assert.equal(lines[index].error, error)
      assert.equal(lines[index].status, 'uncosted')
    }
    assert.deepEqual([lines[0].purchase, lines[0].normalizedQuantity, lines[0].normalizedPackageQuantity], [null, null, null])
    // A usable purchase is still reported when the unit can't be converted, so the page can say what was bought.
    assert.equal(lines[1].purchase.item, 'Flour')
    assert.deepEqual(lines[1].normalizedQuantity, { base: 'mL', amount: 236.5882365 })
    // Only an ineligible purchase exists: it is not reported as what was bought.
    assert.deepEqual([lines[2].purchase, lines[2].normalizedQuantity, lines[2].normalizedPackageQuantity], [null, null, null])
  })

  test('asks for at most one eligible and one ineligible grocery row per item', async () => {
    const { sql, queries } = fakeSql([[]])
    await priceRecipe(sql, [line('Flour')])

    assert.match(queries[0].sql, /DISTINCT ON \(entries\.item, eligible\)/)
    assert.match(queries[0].sql, /\(entries\.size > 0 AND entries\.unit IS NOT NULL\) IS TRUE AS eligible/)
    assert.match(queries[0].sql, /AND NOT entries\.non_grocery/)
    assert.match(queries[0].sql, /ORDER BY entries\.item, eligible, receipts\.purchased_on DESC, entries\.id DESC/)
  })

  test('skips the query when there are no lines', async () => {
    const { sql, queries } = fakeSql([])
    assert.deepEqual(await priceRecipe(sql, []), { lines: [], total: 0, excluded: 0 })
    assert.equal(queries.length, 0)
  })
})

describe('priceRecipe food lines', () => {
  const flour = '11111111-1111-4111-8111-111111111111'
  const food = (foodId = flour, quantity = 250, unit = 'g') => ({ foodId, foodName: 'Saved name', quantity, unit })
  const purchase = (item, id, purchasedOn, overrides = {}) => (
    { id, item, purchasedOn, price: '4.00', size: '500', unit: 'g', saleItem: false, ...overrides }
  )
  const cached = [{ id: flour, name: 'Flour', active: true }]
  const mapped = [{ item: 'AP Flour', mealieFoodId: flour }, { item: 'Bread Flour', mealieFoodId: flour }]
  const price = (lines, responses) => priceRecipe(fakeSql(responses).sql, lines)
  const withMealie = async (url, run) => {
    const before = [process.env.MEALIE_URL, process.env.MEALIE_API_TOKEN]
    process.env.MEALIE_URL = url
    process.env.MEALIE_API_TOKEN = url && 'token'
    try { return await run() } finally { [process.env.MEALIE_URL, process.env.MEALIE_API_TOKEN] = before.map(value => value ?? '') }
  }
  const configured = run => withMealie('http://mealie.test', run)

  test('prices the latest purchase across every item mapped to the food', async () => {
    const { lines, total, excluded } = await configured(() => price([food(), line('Egg', 1, 'ea')], [cached, mapped, [
      purchase('AP Flour', '1', '2026-01-01'),
      purchase('Bread Flour', '2', '2026-02-01', { price: '6.00', saleItem: true }),
      purchase('Egg', '3', '2026-01-01', { size: '12', unit: 'ea' })
    ]]))

    assert.deepEqual(lines.map(({ cost, sale, error }) => ({ cost, sale, error })), [
      { cost: 3, sale: true, error: null },
      { cost: 0.33, sale: false, error: null }
    ])
    assert.deepEqual([total, excluded], [3.33, 0])
  })

  test('shows the cached food name instead of the saved one', async () => {
    const { lines } = await configured(() => price([food()], [cached, mapped, [purchase('AP Flour', '1', '2026-01-01')]]))
    assert.equal(lines[0].foodName, 'Flour')
  })

  test('counts a $0 purchase of a mapped item as costed', async () => {
    const { lines, excluded } = await configured(() => price([food()], [cached, mapped, [purchase('AP Flour', '1', '2026-01-01', { price: '0.00' })]]))
    assert.deepEqual([lines[0].cost, lines[0].error, excluded], [0, null, 0])
  })

  test('reports NO_PRICE and NO_PACKAGE_SIZE for mapped items without a usable purchase', async () => {
    assert.equal((await configured(() => price([food()], [cached, mapped, []]))).lines[0].error, 'NO_PRICE')
    const sizeless = [purchase('AP Flour', '1', '2026-01-01', { size: null })]
    assert.equal((await configured(() => price([food()], [cached, mapped, sizeless]))).lines[0].error, 'NO_PACKAGE_SIZE')
  })

  for (const [label, responses, error] of [
    ['has no mapping', [cached, [], []], 'NO_PRODUCT_MAPPING'],
    ['is inactive', [[{ id: flour, name: 'Flour', active: false }], mapped, []], 'INACTIVE_MEALIE_FOOD'],
    ['is missing from the cache', [[], mapped, [purchase('AP Flour', '1', '2026-01-01')]], 'UNKNOWN_FOOD']
  ]) {
    test(`a food that ${label} is ${error}, never $0`, async () => {
      const { lines, total, excluded } = await configured(() => price([food()], responses))
      assert.deepEqual([lines[0].cost, lines[0].error, total, excluded], [null, error, 0, 1])
      assert.equal(lines[0].foodName, error === 'UNKNOWN_FOOD' ? 'Saved name' : lines[0].foodName)
    })
  }

  test('is MEALIE_NOT_CONFIGURED when Mealie is unset, even with a cached mapped food', async () => {
    const { lines, excluded } = await withMealie('', () => price([food()], [cached, mapped, [purchase('AP Flour', '1', '2026-01-01')]]))
    assert.deepEqual([lines[0].cost, lines[0].error, excluded], [null, 'MEALIE_NOT_CONFIGURED', 1])
  })

  test('one query looks up the foods and mappings, and purchases cover items and mapped items', async () => {
    const { sql, queries } = fakeSql([cached, mapped, []])
    await configured(() => priceRecipe(sql, [food(), line('Egg')]))
    assert.equal(queries.length, 3)
    assert.deepEqual(queries[0].values, [[flour]])
    assert.deepEqual(queries[2].values, [['Egg', 'AP Flour', 'Bread Flour']])
  })

  test('snapshotTotal is null when only food lines exist and none can be priced', async () => {
    assert.equal(await configured(() => snapshotTotal(fakeSql([cached, [], []]).sql, [food()])), null)
  })
})

describe('snapshotTotal', () => {
  test('returns the total when at least one line is priced', async () => {
    const { sql } = fakeSql([[{ item: 'Flour', price: '4.00', size: '500.000', unit: 'g', saleItem: false }]])
    assert.equal(await snapshotTotal(sql, [line('Flour', 250), line('Saffron')]), 2)
  })

  test('returns null when no line could be priced', async () => {
    assert.equal(await snapshotTotal(fakeSql([[]]).sql, [line('Saffron')]), null)
    assert.equal(await snapshotTotal(fakeSql([]).sql, []), null)
  })
})

describe('recipeWriteError', () => {
  test('maps a unique violation to 409', () => {
    assert.throws(() => recipeWriteError({ code: '23505' }), { statusCode: 409 })
  })

  test('rethrows other errors untouched', () => {
    const failure = new Error('boom')
    assert.throws(() => recipeWriteError(failure), failure)
    assert.throws(() => recipeWriteError(null), (error) => error === null)
  })
})

describe('findRecipe', () => {
  test('returns the recipe row', async () => {
    const row = { id: '3', name: 'Pancakes' }
    const { sql, queries } = fakeSql([[row]])
    assert.equal(await findRecipe(sql, '3'), row)
    assert.deepEqual(queries[0].values, ['3'])
  })

  test('404s when the recipe is missing', async () => {
    await assert.rejects(findRecipe(fakeSql([[]]).sql, '3'), { statusCode: 404 })
  })
})

describe('renameRecipeLineItems', () => {
  test('renames matching lines case-insensitively and keeps the first duplicate', () => {
    const lines = [line('green apple', 2), line('Butter'), line(' Green Apples ', 9), line('GREEN APPLE', 5)]
    assert.deepEqual(renameRecipeLineItems(lines, 'Green Apples', ['green apple', 'Green Apple']), [
      line('Green Apples', 2), line('Butter')
    ])
  })

  test('leaves unrelated lines alone', () => {
    const lines = [line('Butter'), line('Milk')]
    assert.deepEqual(renameRecipeLineItems(lines, 'Apple', ['Apples']), lines)
  })
})

describe('renameRecipeLineItems food lines', () => {
  test('passes food lines through untouched and never counts them as duplicates of an item', () => {
    const food = { foodId: '11111111-1111-4111-8111-111111111111', foodName: 'Apples', quantity: 1, unit: 'ea' }
    assert.deepEqual(renameRecipeLineItems([food, line('apple', 1)], 'Apples', ['apple']), [food, line('Apples', 1)])
  })
})

describe('renameRecipeItems', () => {
  test('rewrites only recipes whose lines change', async () => {
    const { sql, queries } = fakeSql([[
      { id: '1', lines: [line('apple', 1), line('Apples', 2)] },
      { id: '2', lines: [line('Apples', 1)] }
    ]])
    await renameRecipeItems(sql, 'Apples', ['apple'])

    assert.equal(queries.length, 2)
    assert.deepEqual(queries[0].values, [['apples', 'apple']])
    assert.match(queries[1].sql, /UPDATE grocery_recipes SET lines = \?, updated_at = now\(\) WHERE id = \?/)
    assert.deepEqual(queries[1].values, [{ json: [line('Apples', 1)] }, '1'])
  })

  test('does nothing when no recipe uses the item', async () => {
    const { sql, queries } = fakeSql([[]])
    await renameRecipeItems(sql, 'Apples', ['apple'])
    assert.equal(queries.length, 1)
  })
})
