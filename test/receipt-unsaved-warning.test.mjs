import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
const history = await readFile(new URL('../app/pages/history.vue', import.meta.url), 'utf8')
const header = await readFile(new URL('../app/components/AppHeader.vue', import.meta.url), 'utf8')
const matchApi = await readFile(new URL('../server/api/receipts/match.get.ts', import.meta.url), 'utf8')

test('receipt entry warns before in-app navigation and page unload when dirty', () => {
  assert.match(form, /onBeforeRouteLeave\(\(\) => confirmDiscardChanges\(\)\)/)
  assert.match(form, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(form, /if \(!hasUnsavedChanges\.value\) return/)
})

test('completed rows autosave and saved rows delete immediately', () => {
  assert.match(form, /setTimeout\(\(\) => saveCompletedRows\(\), 600\)/)
  assert.match(form, /apiUrl\(line\.id \? `\/entries\/\$\{line\.id\}` : '\/entries'\)/)
  assert.match(form, /method: line\.id \? 'PUT' : 'POST'/)
  assert.match(form, /await \$fetch\(apiUrl\(`\/entries\/\$\{line\.id\}`\), \{ method: 'DELETE' \}\)/)
  assert.match(form, /savedLineSnapshots\.set\(line\.key, snapshot\)/)
})

test('the receipt form has no manual save action', () => {
  assert.doesNotMatch(form, /Save receipt|Save changes/)
  assert.match(form, /Add or edit a receipt/)
  assert.doesNotMatch(form, /automatic(?:ally)?/i)
  assert.match(form, /unsaved .* in progress/)
})

test('transient receipt messages render below the stable controls row', () => {
  const footerEnd = form.indexOf('</footer>')
  assert.ok(footerEnd > -1)
  assert.ok(form.indexOf('<UAlert v-if="errorMessage"') > footerEnd)
  assert.ok(form.indexOf('<UAlert v-if="matchingReceiptMessage"') > footerEnd)
  assert.ok(form.indexOf('<UAlert v-if="savedMessage"') > footerEnd)
})

test('add and edit use one receipt editor that loads existing lines', () => {
  assert.match(header, /label: 'Add\/edit receipt'/)
  assert.match(form, /Existing receipt lines load for editing\./)
  assert.match(form, /loadReceipt\(result\.receipt\)/)
  assert.match(form, /@create="createLocation"/)
  assert.match(matchApi, /entries: entries\.map\(publicEntry\)/)
  assert.match(history, /query: \{ date: receipt\.purchasedOn, location: receipt\.location \}/)
  assert.doesNotMatch(history, /<ReceiptEntryForm/)
})
