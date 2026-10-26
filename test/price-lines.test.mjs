import assert from 'node:assert/strict'
import { test } from 'node:test'
import { priceLines } from '../server/utils/price-lines.ts'

const fakeSql = (rows) => {
  const calls = []
  const sql = async (strings, ...values) => { calls.push(values); return rows }
  return { sql, calls }
}
const row = (key, price, saleItem = false) => ({ key, price, size: '1', unit: 'kg', costPerUnit: null, saleItem })

test('groups one query of purchases into a price line per lower-cased item', async () => {
  const { sql, calls } = fakeSql([row('eggs', '4.00'), row('milk', '2.00'), row('eggs', '3.00', true)])
  const lines = await priceLines(sql, ['Eggs', 'eggs', 'Milk'], { start: '2025-10-01' })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [['eggs', 'milk'], '2025-10-01', '2025-10-01', null, null])
  assert.deepEqual(lines.get('eggs'), { values: [0.4, 0.3], sale: [false, true] })
  assert.deepEqual(lines.get('milk'), { values: [0.2], sale: [false] })
})

test('skips the query when there are no items', async () => {
  const { sql, calls } = fakeSql([])
  assert.equal((await priceLines(sql, [])).size, 0)
  assert.equal(calls.length, 0)
})
