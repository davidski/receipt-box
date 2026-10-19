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

  test('skips the query when there are no lines', async () => {
    const { sql, queries } = fakeSql([])
    assert.deepEqual(await priceRecipe(sql, []), { lines: [], total: 0, excluded: 0 })
    assert.equal(queries.length, 0)
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
