import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DATABASE_RESET_CONFIRMATION,
  hasDatabaseResetConfirmation,
  resetDatabase
} from '../server/utils/database-reset.ts'

describe('hasDatabaseResetConfirmation', () => {
  test('accepts only the exact reset phrase', () => {
    assert.equal(DATABASE_RESET_CONFIRMATION, 'RESET')
    assert.equal(hasDatabaseResetConfirmation('RESET'), true)
  })

  test('rejects missing, differently cased, padded, and non-string values', () => {
    for (const value of [undefined, null, '', 'reset', ' RESET ', 123]) {
      assert.equal(hasDatabaseResetConfirmation(value), false)
    }
  })
})

describe('resetDatabase', () => {
  test('truncates all application data and restarts identities in one transaction', async () => {
    const queries = []
    let transactions = 0
    const sql = {
      async begin(callback) {
        transactions += 1
        return callback({
          async unsafe(query) {
            queries.push(query.replaceAll(/\s+/g, ' ').trim())
          }
        })
      }
    }

    await resetDatabase(sql)

    assert.equal(transactions, 1)
    assert.deepEqual(queries, [
      'TRUNCATE TABLE grocery_entries, grocery_receipts, grocery_stores, grocery_item_merge_dismissals RESTART IDENTITY'
    ])
  })

  test('propagates database failures', async () => {
    const failure = new Error('database unavailable')
    const sql = {
      async begin() {
        throw failure
      }
    }

    await assert.rejects(resetDatabase(sql), error => error === failure)
  })
})
