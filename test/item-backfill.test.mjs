import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backfillItemDimensions, itemBackfillCounts } from '../server/utils/item-backfill.ts'

function fakeSql(responses) {
  const queries = []
  const sql = (strings, ...values) => {
    queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return Promise.resolve(responses.shift() ?? [])
  }
  return { sql, queries }
}

test('reports missing size, unit, and union counts while excluding the current entry', async () => {
  const { sql, queries } = fakeSql([[{ size: 3, unit: 2, either: 4 }]])
  assert.deepEqual(await itemBackfillCounts(sql, 'Rice', '42'), { size: 3, unit: 2, either: 4 })
  assert.deepEqual(queries[0].values, ['Rice', '42'])
  assert.match(queries[0].sql, /size IS NULL OR unit IS NULL/)
})

test('returns empty counts if the database returns no aggregate row', async () => {
  const { sql } = fakeSql([[]])
  assert.deepEqual(await itemBackfillCounts(sql, 'Rice', '42'), { size: 0, unit: 0, either: 0 })
})

test('backfills both missing dimensions, recalculates normalized cost, and counts unique entries', async () => {
  const { sql, queries } = fakeSql([
    [{ id: '1' }, { id: '2' }],
    [{ id: '2' }, { id: '3' }],
    []
  ])
  assert.equal(await backfillItemDimensions(sql, 'Rice', '42', '16', 'oz', ['size', 'unit']), 3)
  assert.equal(queries.length, 3)
  assert.match(queries[0].sql, /AND size IS NULL/)
  assert.match(queries[1].sql, /AND unit IS NULL/)
  assert.match(queries[2].sql, /SET cost_per_unit = CASE/)
  assert.deepEqual(queries[2].values, [['1', '2', '3']])
})

test('can backfill one field and skips cost recalculation when no entries change', async () => {
  const { sql, queries } = fakeSql([[]])
  assert.equal(await backfillItemDimensions(sql, 'Rice', '42', '16', 'oz', ['unit']), 0)
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /AND unit IS NULL/)
})
