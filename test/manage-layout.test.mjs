import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const managePage = await readFile(new URL('../app/pages/data.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('the Manage section uses the standard desktop content width', () => {
  assert.match(managePage, /<div class="content-page">/)
  assert.doesNotMatch(managePage, /narrow-page/)
  assert.match(stylesheet, /\.content-page \{ width: min\(1200px, 100%\); margin: 0 auto; \}/)
})

test('the Manage section exposes a duplicate item review editor', () => {
  assert.match(managePage, /label="Items"/)
  assert.match(managePage, /<h2>Review item names<\/h2>/)
  assert.match(managePage, /label="Merge variants"/)
  assert.match(managePage, /label="Hide suggestion"/)
  assert.match(managePage, /label="Unhide"/)
  assert.match(managePage, /label="Rename all instances"/)
  assert.match(managePage, /<USelectMenu/)
  assert.match(managePage, /:search-input="\{ placeholder: 'Search items…' \}"/)
  assert.match(managePage, /value-key="value"/)
  assert.match(managePage, /label="Show 30 more"/)
  assert.match(managePage, /apiUrl\('\/items\/merge'\)/)
  assert.match(managePage, /apiUrl\('\/items\/rename'\)/)
  assert.match(managePage, /method: 'PATCH', body: \{ id: group\.id, hidden \}/)
  assert.match(managePage, /!duplicateItems\?\.groups\.length && !duplicateItems\?\.hiddenGroups\.length/)
  assert.match(stylesheet, /\.item-duplicate-list/)
  assert.match(stylesheet, /\.item-rename > \[data-slot="base"\] \{ min-height: 52px; \}/)
  assert.match(stylesheet, /\.item-rename \.field > \[data-slot="base"\] \{ min-height: 52px; \}/)
})

test('duplicate item suggestions load only after opening Items', () => {
  assert.match(managePage, /\{ immediate: false, server: false \}/)
  assert.match(managePage, /duplicateItemsStatus\.value === 'idle'/)
  assert.match(managePage, /@click="selectManageSection\('items'\)"/)
})
