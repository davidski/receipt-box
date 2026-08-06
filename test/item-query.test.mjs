import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renameItemVariants } from '../server/utils/item-query.ts'

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
