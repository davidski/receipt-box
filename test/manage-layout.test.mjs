import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const managePage = await readFile(new URL('../app/components/ManagePage.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const appConfig = await readFile(new URL('../app/app.config.ts', import.meta.url), 'utf8')
const categoryInput = await readFile(new URL('../app/components/CategoryInput.vue', import.meta.url), 'utf8')
const manageRoute = await readFile(new URL('../app/pages/data/[section].vue', import.meta.url), 'utf8')
const manageMiddleware = await readFile(new URL('../app/middleware/manage.ts', import.meta.url), 'utf8')

test('the Manage section uses the standard desktop content width', () => {
  assert.match(managePage, /<div class="mx-auto w-full max-w-300">/)
  assert.doesNotMatch(managePage, /narrow-page/)
})

test('spreadsheet import copy lists the supported template and export formats', () => {
  assert.match(managePage, /Import an XLSX using the template format, or a CSV\/XLSX export/)
  assert.doesNotMatch(managePage, /Numbers/)
})

test('the Manage section exposes a duplicate item review editor', () => {
  assert.match(managePage, /label="Items"/)
  assert.match(managePage, /<h2[^>]*>Edit item history<\/h2>/)
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
  assert.match(managePage, /data-testid="item-duplicate-list"/)
  assert.match(managePage, /data-testid="item-history-editor"/)
  assert.match(managePage, /data-testid="item-package-editor"/)
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

test('Manage destructive actions use an accessible confirmation modal', () => {
  assert.match(managePage, /<ConfirmModal/)
  assert.match(managePage, /confirmPendingAction/)
  assert.doesNotMatch(managePage, /confirm\(/)
})

test('category merge is a ghost action picker beside 14px Rename and Delete buttons', () => {
  const picker = managePage.match(/<USelectMenu[\s\S]*?placeholder="Merge into…"[\s\S]*?\/>/)[0]
  assert.match(picker, /variant="ghost"/)
  assert.match(picker, /:ui="mergeTriggerUi"/)
  assert.match(managePage, /const mergeTriggerUi = \{ base: 'touch-target w-auto rounded-control border-0 [^']*text-sm md:text-sm'/)
  for (const tag of managePage.match(/<UButton class="touch-target" type="button" label="(Rename|Delete)"[^>]*>/g)) {
    assert.doesNotMatch(tag, /size="(xs|sm)"/, 'row actions use the default md size')
  }
})


test('Manage fields use the design-system field spacing recipe', () => {
  assert.match(managePage, /const fieldSpacing = \{ container: 'mt-1\.5 grid gap-2', help: 'mt-0', error: 'mt-0' \}/)
  assert.doesNotMatch(managePage, /class="[^"]*\bfield\b/, 'fields are UFormField, not hand-built label wrappers')
  const fields = managePage.match(/<UFormField\b[^>]*>/g)
  assert.ok(fields.length > 0)
  for (const tag of fields) assert.match(tag, /:ui="(fieldSpacing|manageField|\{ \.\.\.manageField[^"]*\})"/, tag)
})

test('Manage uses utilities, named radii and rem breakpoints instead of its own stylesheet rules', () => {
  const template = managePage.slice(managePage.indexOf('<template>'))
  assert.doesNotMatch(template, /max-\[[\d.]+px\]/, 'breakpoints use Tailwind rem variants')
  assert.doesNotMatch(template, /rounded-(\[|3xl|xl)|--radius-/, 'radii use rounded-card/input/control')
  assert.doesNotMatch(template, /--(surface-strong|surface-soft|error)\b/, 'retired tokens stay unused')
  for (const name of ['store-list', 'store-edit', 'store-name', 'item-variant-list', 'item-hidden-list', 'item-merge-action', 'item-target-label', 'file-picker', 'manage-sections', 'reset-confirmation', 'reset-actions']) {
    assert.doesNotMatch(template, new RegExp(`class="[^"]*\\b${name}\\b`), `${name} class removed from the template`)
    assert.doesNotMatch(stylesheet, new RegExp(`\\.${name}\\b`), `${name} rule removed from main.css`)
  }
})

test('Manage variant rows mark the kept name with the accent fill and text', () => {
  assert.match(managePage, /itemTargets\[group\.id\] === variant\.name \? 'bg-accent-soft' : 'hover:bg-accent-soft\/55'/)
  assert.match(managePage, /itemTargets\[group\.id\] === variant\.name \? 'text-accent-strong' : 'text-muted'/)
})

test('tailwind-merge knows the radius tokens, so rounded-card replaces a Nuxt UI default radius', () => {
  assert.match(appConfig, /theme: \{ radius: \['chip', 'control', 'input', 'card'\] \}/)
})

test('the category input fills its field and keeps the clear button on the same row', () => {
  assert.match(categoryInput, /<div class="category-input flex items-center gap-1">/)
  assert.match(categoryInput, /v-bind="\$attrs"\s+class="w-full min-w-0"/)
})
