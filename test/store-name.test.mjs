import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStoreName, storeNameKey } from '../shared/utils/store-name.ts'

test('normalizes apostrophe variants and whitespace in store names', () => {
  assert.equal(normalizeStoreName('  Shaw’s\tMarket  '), "Shaw's Market")
  assert.equal(normalizeStoreName('Shawʼs'), "Shaw's")
  assert.equal(normalizeStoreName('Ｓｈａｗ＇ｓ'), "Shaw's")
})

test('uses a case-insensitive canonical key', () => {
  assert.equal(storeNameKey("SHAW'S"), storeNameKey('Shaw’s'))
})
