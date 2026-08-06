import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../app/pages/history.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('History keeps its page heading stable across views', () => {
  assert.match(page, /<p class="eyebrow">Purchase records<\/p>/)
  assert.match(page, /<h1>History<\/h1>/)
  assert.match(page, /<p>Browse receipts or individual purchase entries\.<\/p>/)
  assert.match(page, /class="history-view-summary" aria-live="polite"/)
  assert.doesNotMatch(page, /view === 'receipts' \? 'Shopping trips'/)
  assert.doesNotMatch(page, /The full pricebook/)
})

test('Purchase editor uses consistent spacing between form rows', () => {
  assert.match(stylesheet, /\.edit-dialog \.form-grid, \.edit-dialog \.quick-toggles \{ margin-top: 16px; \}/)
  assert.match(stylesheet, /\.edit-dialog \.form-grid \+ \.field, \.edit-dialog \.quick-toggles \+ \.field \{ margin-top: 16px; \}/)
  assert.match(stylesheet, /\.edit-dialog \.form-grid \.field \+ \.field \{ margin-top: 0; \}/)
})
