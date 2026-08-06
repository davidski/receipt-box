import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const page = await readFile(new URL('../app/pages/highlights.vue', import.meta.url), 'utf8')
const endpoint = await readFile(new URL('../server/api/highlights.get.ts', import.meta.url), 'utf8')

test('the Highlights period field accommodates its longest option without overflowing', () => {
  assert.match(stylesheet, /\.period-field \{ width: 240px; \}/)
  assert.match(stylesheet, /\.period-field \[data-slot="base"\] \{ width: 100%; \}/)
  assert.match(stylesheet, /\.period-field \{ width: min\(240px, 100%\); \}/)
})

test('the Highlights page explains and renders core-item price velocity', () => {
  assert.match(page, /Core item price stability/)
  assert.match(page, /3\+ receipts across 2\+ months/)
  assert.match(page, /velocity compares non-sale prices/)
  assert.match(page, /data\.coreItems\.length/)
  assert.match(stylesheet, /\.core-items-table, \.core-items-table tbody \{ display: grid;/)
})

test('the core-item table uses compact desktop rows without losing mobile labels', () => {
  assert.match(stylesheet, /\.core-items-table td \{ padding: 9px 12px;/)
  assert.match(stylesheet, /\.core-item-inline \{ display: flex;/)
  assert.match(page, /data-label="Regularity"/)
  assert.match(page, /data-label="Price behavior"/)
})

test('Highlights omits redundant recent and sale-frequency views', () => {
  assert.doesNotMatch(page, /Recent prices/)
  assert.doesNotMatch(page, /Frequent sale items/)
  assert.doesNotMatch(page, /unique items bought on sale/)
  assert.doesNotMatch(endpoint, /recentRows|saleItemRows|topSaleItems|saleItems:/)
  assert.match(page, /Recent movers/)
  assert.match(page, /Top stores/)
  assert.match(stylesheet, /\.highlight-stats \{ display: grid; grid-template-columns: repeat\(3, 1fr\);/)
})
