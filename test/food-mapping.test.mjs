import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.createError = ({ statusCode, statusMessage, data }) => Object.assign(new Error(statusMessage), { statusCode, statusMessage, data })

const {
  unmappedItems, cachedFood, carryFoodMapping, deleteFoodMapping, distinctFoods, foodMappingProblems, foodSuggestions, fuzzyCutoff, getFoodMapping, hasFoodConflict,
  listFoodMappings, parseFoodResolution, requireFoodId, requireItemName, searchActiveFoods, setFoodMapping
} = await import('../server/utils/food-mapping.ts')
const { renameItemVariants } = await import('../server/utils/item-query.ts')

const foodA = '11111111-1111-4111-8111-111111111111'
const foodB = '22222222-2222-4222-8222-222222222222'
const row = (item, mealieFoodId) => ({ item, mealieFoodId, foodName: `food ${mealieFoodId[0]}`, active: true })

function fakeTransaction(responses) {
  const queries = []
  const tx = (strings, ...values) => {
    queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return Promise.resolve(responses.shift() ?? [])
  }
  return { tx, queries }
}

const rejectsWith = (promise, statusCode) => assert.rejects(promise, error => error.statusCode === statusCode)

test('validates item names and food ids at the boundary', () => {
  assert.equal(requireItemName('  Flour '), 'Flour')
  for (const value of [undefined, 3, '   ']) assert.throws(() => requireItemName(value), { statusCode: 400 })
  assert.equal(requireFoodId(foodA.toUpperCase()), foodA)
  for (const value of [undefined, null, 'nope', 7]) assert.throws(() => requireFoodId(value), { statusCode: 400 })
})

test('a food resolution separates no choice, clear, and a chosen food', () => {
  assert.equal(parseFoodResolution(undefined), undefined)
  assert.equal(parseFoodResolution(null), null)
  assert.equal(parseFoodResolution(foodA.toUpperCase()), foodA)
  assert.throws(() => parseFoodResolution(''), { statusCode: 400 })
})

test('conflicts need two foods, or a chosen food no name is mapped to', () => {
  const differing = [row('a', foodA), row('b', foodB)]
  assert.equal(hasFoodConflict([], undefined), false)
  assert.equal(hasFoodConflict([row('a', foodA), row('b', foodA)], undefined), false)
  assert.equal(hasFoodConflict(differing, undefined), true)
  assert.equal(hasFoodConflict(differing, null), false)
  assert.equal(hasFoodConflict(differing, foodB), false)
  assert.equal(hasFoodConflict([row('a', foodA)], foodB), true)
  assert.deepEqual(distinctFoods([row('a', foodA), row('b', foodA)]), [{ id: foodA, name: 'food 1', active: true }])
})

test('the carried mapping prefers the row already on the target', async () => {
  const { tx, queries } = fakeTransaction([])
  await carryFoodMapping(tx, 'target', [row('source', foodA), row('target', foodA)], foodA)
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0].values, [['source']])
})

test('a mapping on a source moves to the target and leaves nothing else', async () => {
  const { tx, queries } = fakeTransaction([])
  await carryFoodMapping(tx, 'target', [row('source', foodA)], foodA)
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /UPDATE grocery_item_food_mapping SET item/)
  assert.deepEqual(queries[0].values, ['target', 'source'])
})

test('clearing deletes every mapping, and no mappings issues no query', async () => {
  const cleared = fakeTransaction([])
  await carryFoodMapping(cleared.tx, 'target', [row('source', foodA), row('target', foodB)], null)
  assert.equal(cleared.queries.length, 1)
  assert.deepEqual(cleared.queries[0].values, [['source', 'target']])

  const none = fakeTransaction([])
  await carryFoodMapping(none.tx, 'target', [], null)
  assert.equal(none.queries.length, 0)
})

test('PUT rejects a missing item, an uncached food and an inactive food before writing', async () => {
  const missingItem = fakeTransaction([[], []])
  await rejectsWith(setFoodMapping(missingItem.tx, 'Flour', foodA), 404)
  const uncached = fakeTransaction([[], [{}], []])
  await rejectsWith(setFoodMapping(uncached.tx, 'Flour', foodA), 400)
  const inactive = fakeTransaction([[], [{}], [{ active: false }]])
  await rejectsWith(setFoodMapping(inactive.tx, 'Flour', foodA), 409)
  for (const { queries } of [missingItem, uncached, inactive]) assert.ok(!queries.some(query => /INSERT/.test(query.sql)))
})

test('PUT records a manual mapping and returns it', async () => {
  const saved = { item: 'Flour', mealieFoodId: foodA }
  const { tx, queries } = fakeTransaction([[], [{}], [{ active: true }], [], [saved]])
  assert.equal(await setFoodMapping(tx, 'Flour', foodA), saved)
  assert.deepEqual(queries[3].values, ['Flour', foodA, 'manual'])
})

test('reads a missing mapping as null and reports whether a delete removed one', async () => {
  assert.equal(await getFoodMapping(fakeTransaction([]).tx, 'Flour'), null)
  assert.equal(await deleteFoodMapping(fakeTransaction([[], [{ item: 'Flour' }]]).tx, 'Flour'), true)
  assert.equal(await deleteFoodMapping(fakeTransaction([[], []]).tx, 'Flour'), false)
})

test('problems report mapped items with no usable package size', async () => {
  const { tx, queries } = fakeTransaction([[{ item: 'e', entries: 1 }]])
  const problems = await foodMappingProblems(tx)
  // Only mapped items with an active food, and the same eligibility as selectPurchase in recipe-cost.
  const sizeQuery = queries[0].sql
  assert.match(sizeQuery, /JOIN grocery_item_food_mapping mappings ON mappings\.item = entries\.item/)
  assert.match(sizeQuery, /JOIN mealie_foods foods ON foods\.id = mappings\.mealie_food_id AND foods\.active/)
  assert.match(sizeQuery, /WHERE NOT entries\.non_grocery/)
  assert.match(sizeQuery, /FILTER \(WHERE entries\.size > 0 AND entries\.unit IS NOT NULL\) = 0/)
  assert.deepEqual(problems, { itemsWithoutPackageSize: [{ item: 'e', entries: 1 }] })
})

test('unmapped items leave out non-grocery entries and anything already mapped', async () => {
  const rows = [{ item: 'f', entries: 2 }]
  const { tx, queries } = fakeTransaction([rows])
  assert.deepEqual(await unmappedItems(tx), rows)
  assert.match(queries[0].sql, /WHERE NOT entries\.non_grocery/)
  assert.match(queries[0].sql, /NOT EXISTS \(SELECT 1 FROM grocery_item_food_mapping/)
})

test('both conflicts arrive in one 409 before anything is written', async () => {
  const { tx, queries } = fakeTransaction([[], [{ item: 'a', category: 'Produce' }, { item: 'b', category: 'Dairy' }], [row('a', foodA), row('b', foodB)]])
  await assert.rejects(renameItemVariants(tx, 'a', ['b']), (error) => {
    assert.equal(error.statusCode, 409)
    assert.deepEqual(error.data.categories, ['Produce', 'Dairy'])
    assert.deepEqual(error.data.foods.map(food => food.id), [foodA, foodB])
    return true
  })
  assert.equal(queries.length, 3)
})

test('a resolved category still reports the food conflict, and the reverse', async () => {
  const foods = fakeTransaction([[], [], [row('a', foodA), row('b', foodB)]])
  await assert.rejects(renameItemVariants(foods.tx, 'a', ['b'], 'Produce'), (error) => {
    assert.deepEqual(error.data.categories, [])
    assert.equal(error.data.foods.length, 2)
    assert.match(error.statusMessage, /conflicting foods/)
    return true
  })
  const categories = fakeTransaction([[], [{ item: 'a', category: 'Produce' }, { item: 'b', category: 'Dairy' }], [row('a', foodA), row('b', foodB)]])
  await assert.rejects(renameItemVariants(categories.tx, 'a', ['b'], undefined, foodB), (error) => {
    assert.deepEqual(error.data, { categories: ['Produce', 'Dairy'], foods: [] })
    assert.match(error.statusMessage, /conflicting categories\./)
    return true
  })
})

test('a category change with no sources does not read food mappings', async () => {
  const { tx, queries } = fakeTransaction([])
  await renameItemVariants(tx, 'a', [], null)
  assert.ok(!queries.some(query => /food_mapping/.test(query.sql)))
})

test('suggestions run one read-only query with the item and the cutoff as parameters', async () => {
  const rows = [{ mealieFoodId: foodA, matchType: 'fuzzy' }]
  const { tx, queries } = fakeTransaction([rows])
  assert.equal(await foodSuggestions(tx, "x'; DROP TABLE y"), rows)
  assert.equal(queries.length, 1)
  assert.doesNotMatch(queries[0].sql, /INSERT|UPDATE|DELETE/)
  assert.deepEqual(queries[0].values, ["x'; DROP TABLE y", fuzzyCutoff, 5])
})

test('lists every mapping without an item filter', async () => {
  const mapping = { item: 'Flour', broken: false }
  const { tx, queries } = fakeTransaction([[mapping]])
  assert.deepEqual(await listFoodMappings(tx), [mapping])
  assert.equal(queries[0].values[0], null)
})

test('food search reads only active foods and caps its results', async () => {
  const { tx, queries } = fakeTransaction([[{ id: foodA, name: 'Flour' }]])
  assert.deepEqual(await searchActiveFoods(tx, '100%'), [{ id: foodA, name: 'Flour' }])
  assert.match(queries[0].sql, /WHERE foods\.active AND/)
  assert.match(queries[0].sql, /LIMIT 50/)
  assert.deepEqual(queries[0].values, ['100%', '100%'])
})

test('looks up one cached food by id, active or not, and returns null for an uncached one', async () => {
  const food = { id: foodA, name: 'Flour', active: false }
  const found = fakeTransaction([[food]])
  assert.deepEqual(await cachedFood(found.tx, foodA), food)
  assert.match(found.queries[0].sql, /FROM mealie_foods WHERE id = \?/)
  assert.deepEqual(found.queries[0].values, [foodA])
  assert.equal(await cachedFood(fakeTransaction([[]]).tx, foodB), null)
})
