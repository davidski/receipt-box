import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../app/components/HistoryPage.vue', import.meta.url), 'utf8')
const indexRoute = await readFile(new URL('../app/pages/history/index.vue', import.meta.url), 'utf8')
const viewRoute = await readFile(new URL('../app/pages/history/[...view].vue', import.meta.url), 'utf8')
const middleware = await readFile(new URL('../app/middleware/history.ts', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('History keeps its page heading stable across views', () => {
  assert.match(page, /Purchase records<\/p>/)
  assert.match(page, /<h1>History<\/h1>/)
  assert.match(page, /<p>Browse receipts or individual purchase entries\.<\/p>/)
  assert.match(page, /class="page-heading my-\[15px\] mb-8 history-heading">[\s\S]*class="history-view-switcher" aria-label="History view"/)
  assert.doesNotMatch(page, /history-view-summary/)
  assert.match(viewRoute, /middleware: 'history'/)
  assert.match(middleware, /to\.path === '\/history'/)
  assert.match(middleware, /entries.*receipts\/calendar.*receipts\/list/s)
  assert.match(page, /to="\/history\/receipts\/calendar"/)
  assert.match(page, /to="\/history\/entries"/)
  assert.match(page, /label="Calendar" icon="i-lucide-calendar-days"/)
  assert.match(page, /label="List" icon="i-lucide-list"/)
  assert.match(page, /<th scope="col">Date<\/th><th scope="col">Store<\/th><th scope="col">Items<\/th><th scope="col">Total<\/th>/)
  assert.match(page, /Receipt date, store, and total/)
  assert.equal((page.match(/aria-label="Receipt list pagination"/g) || []).length, 2)
  assert.doesNotMatch(page, /view === 'receipts' \? 'Shopping trips'/)
  assert.doesNotMatch(page, /The full pricebook/)
})

test('Purchase editor uses consistent spacing between form rows', () => {
  assert.match(stylesheet, /\.edit-dialog \.form-grid, \.edit-dialog \.quick-toggles \{ margin-top: 16px; \}/)
  assert.match(stylesheet, /\.edit-dialog \.form-grid \+ \.field, \.edit-dialog \.quick-toggles \+ \.field \{ margin-top: 16px; \}/)
  assert.match(stylesheet, /\.edit-dialog \.form-grid \.field \+ \.field \{ margin-top: 0; \}/)
})

test('Calendar receipt store headings keep wrapped lines compact', () => {
  assert.match(stylesheet, /\.receipt-heading h2 \{ font-size: 23px; line-height: 1\.05; \}/)
  assert.match(stylesheet, /\.receipt-heading > button, \.receipt-heading > a \{ align-self: flex-start; \}/)
})

test('Page content reserves the scrollbar gutter', () => {
  assert.match(stylesheet, /html \{ min-height: 100%; background: var\(--bg\); scrollbar-gutter: stable; \}/)
})
