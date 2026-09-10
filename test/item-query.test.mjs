import assert from 'node:assert/strict'
import { test } from 'node:test'
import { itemDimensionVariants, renameItemVariants, updateItemDimensions } from '../server/utils/item-query.ts'

function fakeTransaction(responses) {
  const queries = []
  const tx = (strings, ...values) => {
    queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return Promise.resolve(responses.shift() ?? [])
  }
  return { tx, queries }
}

test('renames every selected item variant and reports affected entries', async () => {
  const { tx, queries } = fakeTransaction([[{ id: '1' }, { id: '2' }], [{ id: '3' }]])
  assert.equal(await renameItemVariants(tx, 'Green Apples', ['green apples', 'Green Apple']), 3)
  assert.equal(queries.length, 2)
  assert.match(queries[0].sql, /UPDATE grocery_entries SET item = \?/)
  assert.deepEqual(queries[0].values, ['Green Apples', 'green apples'])
  assert.deepEqual(queries[1].values, ['Green Apples', 'Green Apple'])
})

test('does nothing when no source names are selected', async () => {
  const { tx, queries } = fakeTransaction([])
  assert.equal(await renameItemVariants(tx, 'Green Apples', []), 0)
  assert.equal(queries.length, 0)
})

test('returns the existing quantity and unit variants for an item', async () => {
  const variants = [{ size: '5.000', unit: 'lb', uses: 3 }, { size: null, unit: null, uses: 1 }]
  const { tx, queries } = fakeTransaction([variants])
  assert.deepEqual(await itemDimensionVariants(tx, 'Flour'), variants)
  assert.deepEqual(queries[0].values, ['Flour'])
  assert.match(queries[0].sql, /GROUP BY size, unit/)
})

test('updates only an exact package variant', async () => {
  const { tx, queries } = fakeTransaction([[{ id: '7' }, { id: '9' }], [{ id: '7' }, { id: '9' }]])
  const affected = await updateItemDimensions(tx, 'Flour', {
    scope: 'variant', matchSize: 5, matchUnit: 'lb', size: 80, unit: 'oz'
  })
  assert.equal(affected, 2)
  assert.match(queries[0].sql, /size IS NOT DISTINCT FROM \?/)
  assert.match(queries[0].sql, /unit IS NOT DISTINCT FROM \?/)
  assert.deepEqual(queries[0].values, ['Flour', 5, 'lb'])
  assert.match(queries[1].sql, /SET size = \?, unit = \?, updated_at = now\(\)/)
  assert.deepEqual(queries[1].values, [80, 'oz', ['7', '9']])
})

test('supports missing and all scopes', async () => {
  const missing = fakeTransaction([[{ id: '1' }], [{ id: '1' }]])
  assert.equal(await updateItemDimensions(missing.tx, 'Rice', { scope: 'missing', size: 1, unit: 'kg' }), 1)
  assert.match(missing.queries[0].sql, /size IS NULL OR unit IS NULL/)

  const all = fakeTransaction([[{ id: '1' }, { id: '2' }], [{ id: '1' }, { id: '2' }]])
  assert.equal(await updateItemDimensions(all.tx, 'Rice', { scope: 'all', size: 1, unit: 'kg' }), 2)
  assert.doesNotMatch(all.queries[0].sql, /size IS NULL|IS NOT DISTINCT/)
})

test('does not issue an update when the selected package no longer has matches', async () => {
  const { tx, queries } = fakeTransaction([[]])
  assert.equal(await updateItemDimensions(tx, 'Flour', { scope: 'variant', matchSize: 5, matchUnit: 'lb', size: 80, unit: 'oz' }), 0)
  assert.equal(queries.length, 1)
})
