import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const managePage = await readFile(new URL('../app/components/ManagePage.vue', import.meta.url), 'utf8')
const manageRoute = await readFile(new URL('../app/pages/data/[section].vue', import.meta.url), 'utf8')
const manageMiddleware = await readFile(new URL('../app/middleware/manage.ts', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('the Manage section uses the standard desktop content width', () => {
  assert.match(managePage, /<div class="w-full max-w-\[1200px\] mx-auto">/)
  assert.doesNotMatch(managePage, /narrow-page/)
})

test('the Manage section exposes a duplicate item review editor', () => {
  assert.match(managePage, /label="Items"/)
  assert.match(managePage, /<h2>Edit item history<\/h2>/)
  assert.match(managePage, /label="Merge variants"/)
  assert.match(managePage, /label="Hide suggestion"/)
  assert.match(managePage, /label="Unhide"/)
  assert.match(managePage, /Also update package quantity and unit/)
  assert.match(managePage, /New quantity/)
  assert.match(managePage, /All entries for this item/)
  assert.match(managePage, /v-if="dimensionScope === 'variant'"/)
  assert.match(managePage, /<UnitInput v-model="replacementUnit"/)
  assert.match(managePage, /apiUrl\('\/items\/dimensions'\)/)
  assert.match(managePage, /<USelectMenu/)
  assert.match(managePage, /:search-input="\{ placeholder: 'Search items…' \}"/)
  assert.match(managePage, /value-key="value"/)
  assert.match(managePage, /label="Show 30 more"/)
  assert.match(managePage, /apiUrl\('\/items\/merge'\)/)
  assert.match(managePage, /apiUrl\('\/items\/rename'\)/)
  assert.match(managePage, /method: 'PATCH', body: \{ id: group\.id, hidden \}/)
  assert.match(managePage, /!duplicateItems\?\.groups\.length && !duplicateItems\?\.hiddenGroups\.length/)
  assert.match(stylesheet, /\.item-duplicate-list/)
  assert.match(stylesheet, /\.item-history-editor/)
  assert.match(stylesheet, /\.item-package-editor/)
})

test('duplicate item suggestions load only after opening Items', () => {
  assert.match(managePage, /\{ immediate: false, server: false \}/)
  assert.match(managePage, /duplicateItemsStatus\.value === 'idle'/)
  assert.match(managePage, /to="\/data\/items"/)
  assert.match(managePage, /to="\/data\/import-export"/)
  assert.match(managePage, /to="\/data\/maintenance"/)
  assert.match(manageRoute, /middleware: 'manage'/)
  assert.match(manageMiddleware, /import-export.*transfer.*maintenance/)
})
