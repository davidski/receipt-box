import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const db = await read('../server/utils/db.ts')

describe('line position migration', () => {
  test('adds the column, backfills per receipt by id, then makes it required', () => {
    const add = db.indexOf('ADD COLUMN IF NOT EXISTS position INT')
    const backfill = db.indexOf('row_number() OVER (PARTITION BY receipt_id ORDER BY position NULLS LAST, id)')
    const required = db.indexOf('ALTER COLUMN position SET NOT NULL')
    const mergeDuplicates = db.indexOf('await mergeDuplicateReceipts(tx)')

    assert.notEqual(add, -1)
    assert.ok(add < mergeDuplicates, 'column must exist before receipts are merged')
    assert.ok(mergeDuplicates < backfill && backfill < required)
    assert.match(db, /WHERE receipt_id IN \(SELECT receipt_id FROM grocery_entries WHERE position IS NULL\)/)
  })

  test('exposes position as the last column of grocery_entry_details', () => {
    assert.match(db, /categories\.name AS category,\s+entries\.position\s+FROM grocery_entries entries/)
  })

  test('every entry insert assigns a position', async () => {
    const files = [
      '../server/utils/entry-query.ts',
      '../server/api/import.post.ts',
      '../server/api/receipts/index.post.ts',
      '../server/api/receipts/[id].put.ts'
    ]
    for (const file of files) {
      const source = await read(file)
      assert.match(source, /position/, file)
      assert.match(source, /nextPosition/, file)
    }
  })

  test('receipt line lists are ordered by position', async () => {
    const files = [
      '../server/utils/receipt-split.ts',
      '../server/api/receipts/[id].get.ts',
      '../server/api/receipts/[id].put.ts',
      '../server/api/receipts/index.post.ts',
      '../server/api/receipts/match.get.ts'
    ]
    for (const file of files) {
      assert.match(await read(file), /ORDER BY position, id/, file)
    }
    assert.match(await read('../server/api/receipts/index.get.ts'), /entries\.receipt_id DESC, entries\.position, entries\.id/)
  })
})
