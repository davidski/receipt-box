import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ensureStore,
  mergeDuplicateReceipts,
  moveReceiptToKey,
  moveStoreReceipts,
  upsertReceipt
} from '../server/utils/receipt-query.ts'

function fakeTransaction(responses) {
  const queries = []
  const tx = (strings, ...values) => {
    queries.push({
      sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values
    })
    return Promise.resolve(responses.shift() ?? [])
  }
  return { tx, queries }
}

describe('upsertReceipt', () => {
  test('returns the one receipt for a store and date', async () => {
    const { tx, queries } = fakeTransaction([[{ id: '17' }]])

    assert.equal(await upsertReceipt(tx, '2026-08-06', 'Market'), '17')
    assert.match(queries[0].sql, /ON CONFLICT \(purchased_on, store_id\)/)
    assert.deepEqual(queries[0].values, ['2026-08-06', 'Market'])
  })

  test('fails if the database does not return a receipt', async () => {
    const { tx } = fakeTransaction([[]])
    await assert.rejects(upsertReceipt(tx, '2026-08-06', 'Market'), /Could not create or find receipt/)
  })
})

describe('ensureStore', () => {
  test('returns the existing canonical spelling for a case-insensitive match', async () => {
    const { tx, queries } = fakeTransaction([[], [{ name: 'Market' }]])
    assert.equal(await ensureStore(tx, 'market'), 'Market')
    assert.match(queries[0].sql, /ON CONFLICT DO NOTHING/)
    assert.deepEqual(queries[1].values, ['market'])
  })

  test('fails if the store cannot be found after insertion', async () => {
    const { tx } = fakeTransaction([[], []])
    await assert.rejects(ensureStore(tx, 'Market'), /Could not create or find store/)
  })
})

describe('moveReceiptToKey', () => {
  test('updates entries in place when the receipt already owns the key', async () => {
    const { tx, queries } = fakeTransaction([[{ id: '4' }]])

    assert.equal(await moveReceiptToKey(tx, '4', '2026-08-06', 'Market'), '4')
    assert.equal(queries.length, 1)
  })

  test('appends entries and removes the source when the key is already owned', async () => {
    const { tx, queries } = fakeTransaction([[{ id: '9' }], [], []])

    assert.equal(await moveReceiptToKey(tx, '4', '2026-08-06', 'Market'), '9')
    assert.equal(queries.length, 3)
    assert.match(queries[2].sql, /DELETE FROM grocery_receipts/)
    assert.deepEqual(queries[2].values, ['4'])
  })
})

describe('moveStoreReceipts', () => {
  test('moves every receipt through the collision-safe store/day path', async () => {
    const { tx, queries } = fakeTransaction([
      [{ id: '2', purchasedOn: '2026-08-05' }, { id: '3', purchasedOn: '2026-08-06' }],
      [{ id: '8' }], [], [],
      [{ id: '9' }], [], []
    ])

    assert.equal(await moveStoreReceipts(tx, 'Old Market', 'Market'), 2)
    assert.equal(queries.length, 7)
    assert.deepEqual(queries[0].values, ['Old Market'])
    assert.deepEqual(queries[1].values, ['2026-08-05', 'Market'])
    assert.deepEqual(queries[4].values, ['2026-08-06', 'Market'])
  })

  test('does nothing when the store has no receipts', async () => {
    const { tx, queries } = fakeTransaction([[]])
    assert.equal(await moveStoreReceipts(tx, 'Unused', 'Market'), 0)
    assert.equal(queries.length, 1)
  })
})

describe('mergeDuplicateReceipts', () => {
  test('keeps the oldest receipt, appends duplicate lines, and removes duplicate parents', async () => {
    const { tx, queries } = fakeTransaction([[
      {
        receiptIds: ['3', '7', '8'],
        createdAt: '2026-08-06T10:00:00Z',
        updatedAt: '2026-08-06T12:00:00Z'
      }
    ], [], [], []])

    assert.equal(await mergeDuplicateReceipts(tx), 2)
    assert.match(queries[1].sql, /SET receipt_id = \?/)
    assert.deepEqual(queries[1].values, ['3', ['7', '8']])
    assert.match(queries[2].sql, /DELETE FROM grocery_receipts/)
    assert.deepEqual(queries[3].values, ['2026-08-06T10:00:00Z', '2026-08-06T12:00:00Z', '3'])
  })

  test('skips malformed groups without deleting anything', async () => {
    const { tx, queries } = fakeTransaction([[{ receiptIds: [], createdAt: '', updatedAt: '' }]])
    assert.equal(await mergeDuplicateReceipts(tx), 0)
    assert.equal(queries.length, 1)
  })
})
