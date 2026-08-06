import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
const history = await readFile(new URL('../app/pages/history.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
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
  assert.match(form, /await loadCurrentReceiptSummary\(\)/)
  assert.doesNotMatch(form, /savedMessage/)
  assert.doesNotMatch(form, /addedReceiptMessage\(newRows, summary\)/)
})

test('the receipt form has no manual save action', () => {
  assert.doesNotMatch(form, /Save receipt|Save changes/)
  assert.match(form, /Add or edit a receipt/)
  assert.doesNotMatch(form, /automatic(?:ally)?/i)
  assert.match(form, /unsaved .* in progress/)
})

test('the sale-price toggle explains its state on hover and to assistive technology', () => {
  assert.match(form, /:aria-label="line\.saleItem \? 'Remove sale-price flag' : 'Mark as purchased at a sale price'"/)
  assert.match(form, /:title="line\.saleItem \? 'Purchased at a sale price\. Click to remove\.' : 'Mark as purchased at a sale price\.'"/)
  assert.match(stylesheet, /\.receipt-line-options button, \.receipt-line-remove \{ min-width: 42px; min-height: 42px; justify-content: center; \}/)
})

test('only actionable receipt messages render below the stable controls row', () => {
  const footerEnd = form.indexOf('</footer>')
  assert.ok(footerEnd > -1)
  assert.ok(form.indexOf('<UAlert v-if="errorMessage"') > footerEnd)
  assert.ok(form.indexOf('<UAlert v-if="matchingReceiptMessage"') > footerEnd)
  assert.doesNotMatch(form, /color="success"/)
  assert.match(stylesheet, /\.receipt-entry-form > \.notice \{ width: auto; margin-inline: 24px; \}/)
})

test('add and edit use one receipt editor that loads existing lines', () => {
  assert.match(header, /label: 'Add\/edit receipt'/)
  assert.match(form, /Select an existing date and store to edit\./)
  assert.doesNotMatch(form, /Existing receipt lines load for editing\./)
  assert.match(form, /loadReceipt\(result\.receipt\)/)
  assert.match(form, /@create="createLocation"/)
  assert.match(matchApi, /entries: entries\.map\(publicEntry\)/)
  assert.match(history, /query: \{ date: receipt\.purchasedOn, location: receipt\.location \}/)
  assert.doesNotMatch(history, /<ReceiptEntryForm/)
})
