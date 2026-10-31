import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.createError = ({ statusCode, statusMessage, data }) => Object.assign(new Error(statusMessage), { statusCode, statusMessage, data })

const {
  carryFoodMapping, deleteFoodMapping, distinctFoods, foodMappingProblems, getFoodMapping, hasFoodConflict,
  parseFoodResolution, requireFoodId, requireItemName, setFoodMapping
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

test('problems split broken and orphaned mappings, listing a mapping that is both in each', async () => {
  const both = { item: 'a', broken: true, hasEntries: false }
  const broken = { item: 'b', broken: true, hasEntries: true }
  const orphan = { item: 'c', broken: false, hasEntries: false }
  const healthy = { item: 'd', broken: false, hasEntries: true }
  const { tx } = fakeTransaction([[both, broken, orphan, healthy], [{ item: 'e', entries: 1 }], [{ item: 'f', entries: 2 }]])
  assert.deepEqual(await foodMappingProblems(tx), {
    brokenMappings: [both, broken],
    orphanedMappings: [both, orphan],
    unmappedItems: [{ item: 'f', entries: 2 }],
    itemsWithoutPackageSize: [{ item: 'e', entries: 1 }]
  })
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
