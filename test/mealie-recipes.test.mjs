import assert from 'node:assert/strict'
import { describe, mock, test } from 'node:test'
const { costMealieRecipe, listMealieRecipes, mealieRecipeError } = await import('../server/utils/mealie/recipes.ts')
const { MealieError } = await import('../server/utils/mealie/client.ts')

const flour = '11111111-1111-4111-8111-111111111111'
const eggs = '22222222-2222-4222-8222-222222222222'
const parsley = '33333333-3333-4333-8333-333333333333'
const stale = '44444444-4444-4444-8444-444444444444'
const unmapped = '55555555-5555-4555-8555-555555555555'
const cup = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const pound = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const bunch = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const piece = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const whole = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const tablespoon = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

const foods = [
  { id: flour, name: 'Flour', active: true },
  { id: eggs, name: 'Eggs', active: true },
  { id: parsley, name: 'Parsley', active: true },
  { id: stale, name: 'Merged away', active: false },
  { id: unmapped, name: 'Saffron', active: true }
]
const unit = (id, name, standardQuantity = null, standardUnit = null) => ({ id, name, pluralName: null, standardQuantity, standardUnit })
const units = [
  unit(cup, 'cup', '1', 'cup'),
  unit(pound, 'pound', '1', 'pound'),
  unit(bunch, 'bunch'),
  unit(piece, 'Piece'),
  unit(whole, 'whole'),
  unit(tablespoon, 'tablespoon', '0.5', 'fluid_ounce')
]
const mappings = [
  { item: 'AP Flour', mealieFoodId: flour },
  { item: 'Egg Carton', mealieFoodId: eggs },
  { item: 'Parsley Bunch', mealieFoodId: parsley }
]
const purchase = (item, overrides = {}) => ({ id: '1', item, price: '4.00', size: '12', unit: 'ea', saleItem: false, purchasedOn: '2026-01-01', eligible: true, ...overrides })
const flourBag = purchase('AP Flour', { price: '4.79', size: '5', unit: 'lb' })
const eggCarton = purchase('Egg Carton')
const parsleyBunch = purchase('Parsley Bunch', { price: '1.00', size: '1', unit: 'ea' })

function fakeSql({ purchases = [flourBag, eggCarton, parsleyBunch], ...overrides } = {}) {
  const responses = [overrides.foods ?? foods, overrides.units ?? units, overrides.mappings ?? mappings, purchases]
  return () => Promise.resolve(responses.shift())
}
const food = (id, name = 'x') => ({ id, name })
const cost = (ingredients, sql = fakeSql(), extra = {}) => costMealieRecipe(sql, { slug: 'r', name: 'R', recipeServings: 0, recipeIngredient: ingredients, ...extra })
const single = async (ingredient, sql) => (await cost([ingredient], sql)).ingredients[0]

describe('costMealieRecipe failure reasons', () => {
  test('cup flour against lb flour without density is DIMENSION_MISMATCH', async () => {
    const line = await single({ quantity: 2, unit: { id: cup, name: 'cup' }, food: food(flour, 'Flour') })
    assert.equal(line.error, 'DIMENSION_MISMATCH')
    assert.equal(line.status, 'uncosted')
    assert.equal(line.cost, null)
    assert.equal(line.item, 'AP Flour')
    assert.deepEqual(line.normalizedQuantity, { base: 'mL', amount: 473.176473 })
    assert.deepEqual(line.normalizedPackageQuantity, { base: 'g', amount: 2267.96185 })
  })

  test('"bunch" parsley is UNSTANDARDIZED_UNIT', async () => {
    assert.equal((await single({ quantity: 1, unit: { id: bunch, name: 'bunch' }, food: food(parsley) })).error, 'UNSTANDARDIZED_UNIT')
  })

  test('a linked unit missing from the cache is UNSTANDARDIZED_UNIT', async () => {
    const line = await single({ quantity: 1, unit: { id: '99999999-9999-4999-8999-999999999999', name: 'gone' }, food: food(eggs) })
    assert.equal(line.error, 'UNSTANDARDIZED_UNIT')
  })

  test('an unlinked unit with no id is NO_UNIT', async () => {
    const line = await single({ quantity: 1, unit: { name: 'handful' }, food: food(eggs) })
    assert.equal(line.error, 'NO_UNIT')
    assert.deepEqual(line.unit, { id: null, name: 'handful' })
  })

  test('an ingredient without a food, or with an unlinked one, is NO_FOOD', async () => {
    assert.equal((await single({ quantity: 1, food: null, note: 'to taste' })).error, 'NO_FOOD')
    assert.equal((await single({ quantity: 1, food: { name: 'typed in' } })).error, 'NO_FOOD')
    assert.equal((await single(null)).error, 'NO_FOOD')
  })

  test('null, zero and negative quantities are NO_QUANTITY', async () => {
    for (const quantity of [null, 0, -1, undefined]) {
      const line = await single({ quantity, food: food(eggs) })
      assert.equal(line.error, 'NO_QUANTITY')
      assert.equal(line.normalizedQuantity, null)
    }
  })

  test('a sub-recipe is SUBRECIPE_UNSUPPORTED even with a food', async () => {
    const line = await single({ quantity: 1, food: food(eggs), referencedRecipe: { id: 'x', slug: 'stock' } })
    assert.equal(line.error, 'SUBRECIPE_UNSUPPORTED')
    const { summary } = await cost([{ quantity: 1, food: null, referencedRecipe: { id: 'x', name: 'Stock' } }])
    assert.deepEqual(summary.uncosted, [{ name: 'Stock', error: 'SUBRECIPE_UNSUPPORTED' }])
  })

  test('unknown, inactive and unmapped foods report their reasons', async () => {
    assert.equal((await single({ quantity: 1, food: food('66666666-6666-4666-8666-666666666666', 'New') })).error, 'UNKNOWN_FOOD')
    assert.equal((await single({ quantity: 1, food: food('not-a-uuid') })).error, 'UNKNOWN_FOOD')
    assert.equal((await single({ quantity: 1, food: food(stale) })).error, 'INACTIVE_MEALIE_FOOD')
    assert.equal((await single({ quantity: 1, food: food(unmapped) })).error, 'NO_PRODUCT_MAPPING')
  })

  test('a mapped item with no purchases is NO_PRICE', async () => {
    assert.equal((await single({ quantity: 1, food: food(eggs) }, fakeSql({ purchases: [] }))).error, 'NO_PRICE')
  })

  test('a mapped item with only sizeless purchases is NO_PACKAGE_SIZE', async () => {
    const purchases = [purchase('Egg Carton', { size: null, eligible: false })]
    const line = await single({ quantity: 1, food: food(eggs) }, fakeSql({ purchases }))
    assert.equal(line.error, 'NO_PACKAGE_SIZE')
    assert.equal(line.purchase, null)
  })

  test('price failures win over a bad quantity, following the decision flow', async () => {
    assert.equal((await single({ quantity: null, food: food(eggs) }, fakeSql({ purchases: [] }))).error, 'NO_PRICE')
  })

  test('rejects a recipe with no ingredient list as malformed', async () => {
    await assert.rejects(costMealieRecipe(fakeSql(), { slug: 'r' }), { kind: 'malformed' })
  })
})

describe('costMealieRecipe costing', () => {
  test('2 eggs from 12 ea at $4 costs $0.67, with provenance', async () => {
    const line = await single({ quantity: 2, unit: null, food: food(eggs, 'Eggs') })
    assert.deepEqual(line, {
      food: { id: eggs, name: 'Eggs' },
      note: null,
      recipe: null,
      quantity: 2,
      unit: null,
      normalizedQuantity: { base: 'ea', amount: 2 },
      item: 'Egg Carton',
      purchase: { id: '1', item: 'Egg Carton', price: '4.00', size: '12', unit: 'ea', saleItem: false, purchasedOn: '2026-01-01', usedSalePrice: false },
      normalizedPackageQuantity: { base: 'ea', amount: 12 },
      cost: 0.67,
      status: 'exact',
      error: null
    })
  })

  test('piece and whole count as ea, whatever their case', async () => {
    for (const id of [piece, whole]) {
      assert.equal((await single({ quantity: 2, unit: { id }, food: food(eggs) })).cost, 0.67)
    }
  })

  test('accepts an uppercase Mealie food id', async () => {
    assert.equal((await single({ quantity: 2, food: food(eggs.toUpperCase()) })).cost, 0.67)
  })

  test('normalizes through the standard unit and labels the conversion', async () => {
    const line = await single({ quantity: 1, unit: { id: pound }, food: food(flour) }, fakeSql({ purchases: [purchase('AP Flour', { price: '4.79', size: '2267.96185', unit: 'g' })] }))
    assert.equal(line.cost, 0.96)
    assert.equal(line.status, 'unit_converted')
  })

  test('a tablespoon defined in fluid ounces against a tbsp package is exact', async () => {
    const line = await single({ quantity: 2, unit: { id: tablespoon }, food: food(flour) }, fakeSql({ purchases: [purchase('AP Flour', { price: '6', size: '12', unit: 'tbsp' })] }))
    assert.equal(line.cost, 1)
    assert.equal(line.status, 'exact')
  })

  test('uses the latest purchase across mapped items, and sets usedSalePrice from it', async () => {
    const purchases = [
      purchase('Egg Carton', { id: '1', purchasedOn: '2026-01-01' }),
      purchase('Farm Eggs', { id: '2', purchasedOn: '2026-02-01', price: '3.00', saleItem: true })
    ]
    const line = await single({ quantity: 12, food: food(eggs) }, fakeSql({ purchases, mappings: [...mappings, { item: 'Farm Eggs', mealieFoodId: eggs }] }))
    assert.equal(line.item, 'Farm Eggs')
    assert.equal(line.purchase.usedSalePrice, true)
    assert.equal(line.purchase.id, '2')
    assert.equal(line.cost, 3)
  })
})

describe('costMealieRecipe summary', () => {
  const partial = [
    { quantity: 2, food: food(eggs, 'Eggs') },
    { quantity: 1, unit: { id: bunch }, food: food(parsley, 'Parsley') },
    { quantity: 1, note: 'salt' }
  ]

  test('reports coverage and the uncosted ingredients', async () => {
    const { summary, servings } = await cost(partial, fakeSql(), { recipeServings: 2 })
    assert.equal(servings, 2)
    assert.deepEqual(summary, {
      cost: 0.67,
      costPerServing: 0.34,
      costedIngredients: 1,
      totalIngredients: 3,
      coverage: 33,
      uncosted: [{ name: 'Parsley', error: 'UNSTANDARDIZED_UNIT' }, { name: 'salt', error: 'NO_FOOD' }]
    })
  })

  test('coverage never rounds up to 100 while an ingredient is uncosted', async () => {
    const lines = [...Array(999).fill({ quantity: 1, food: food(eggs) }), { quantity: 1 }]
    assert.equal((await cost(lines)).summary.coverage, 99)
  })

  test('takes servings from positive recipeServings only, never recipeYield', async () => {
    for (const recipeServings of [0, -1, '4', null]) {
      const { servings, summary } = await cost(partial, fakeSql(), { recipeServings, recipeYield: '4 servings', recipeYieldQuantity: 4 })
      assert.equal(servings, null)
      assert.equal(summary.costPerServing, null)
    }
  })

  test('an empty recipe costs nothing at zero coverage', async () => {
    const { summary } = await cost([])
    assert.equal(summary.cost, 0)
    assert.equal(summary.coverage, 0)
  })
})

describe('listMealieRecipes', () => {
  test('returns summaries with servings from recipeServings only', async () => {
    process.env.MEALIE_URL = 'http://mealie.invalid'
    process.env.MEALIE_API_TOKEN = 'unused'
    const items = [{ slug: 'a', name: 'A', recipeServings: 2 }, { slug: 'b', name: 'B', recipeServings: 0, recipeYield: '4' }]
    const stub = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ total: 2, total_pages: 1, items })))
    try {
      assert.deepEqual(await listMealieRecipes(), [{ slug: 'a', name: 'A', servings: 2 }, { slug: 'b', name: 'B', servings: null }])
    } finally {
      stub.mock.restore()
      delete process.env.MEALIE_URL
      delete process.env.MEALIE_API_TOKEN
    }
  })
})

describe('mealieRecipeError', () => {
  test('maps each Mealie failure to a clear HTTP error', () => {
    assert.deepEqual(mealieRecipeError(new MealieError('disabled', 'Mealie is not configured')), { statusCode: 409, statusMessage: 'Mealie is not configured' })
    assert.deepEqual(mealieRecipeError(new MealieError('http', 'x returned 404', 404)), { statusCode: 404, statusMessage: 'Recipe not found in Mealie' })
    assert.deepEqual(mealieRecipeError(new MealieError('network', 'Mealie GET /api/recipes/a failed')), { statusCode: 502, statusMessage: 'Mealie is unreachable: Mealie GET /api/recipes/a failed' })
    assert.equal(mealieRecipeError(new MealieError('timeout', 't')).statusMessage, 'Mealie is unreachable: t')
    assert.deepEqual(mealieRecipeError(new MealieError('http', 'x returned 500', 500)), { statusCode: 502, statusMessage: 'x returned 500' })
  })

  test('rethrows anything else untouched', () => {
    const failure = new Error('database down')
    assert.throws(() => mealieRecipeError(failure), failure)
  })
})
