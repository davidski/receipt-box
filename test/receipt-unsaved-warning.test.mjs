import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
const history = await readFile(new URL('../app/pages/history.vue', import.meta.url), 'utf8')

test('receipt entry warns before in-app navigation and page unload when dirty', () => {
  assert.match(form, /onBeforeRouteLeave\(\(\) => confirmDiscardChanges\(\)\)/)
  assert.match(form, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(form, /if \(!hasUnsavedChanges\.value\) return/)
})

test('successful saves and deletes clear the dirty baseline', () => {
  assert.match(form, /if \(isEditing\.value\) \{\s+markClean\(\)\s+emit\('saved'\)/)
  assert.match(form, /form\.lines = \[blankLine\(\)\]\s+markClean\(\)/)
  assert.match(form, /method: 'DELETE' \}\)\s+markClean\(\)\s+emit\('deleted'\)/)
})

test('closing an edited receipt also warns when its form is dirty', () => {
  assert.match(history, /if \(receiptEditDirty\.value && !confirm\('Discard your unsaved receipt changes\?'\)\) return/)
  assert.match(history, /@dirty-change="receiptEditDirty = \$event"/)
})
