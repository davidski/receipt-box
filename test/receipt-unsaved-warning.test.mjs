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

test('receipt item entry preserves a new name while showing suggestions', () => {
  assert.match(form, /v-model:search-term="line\.searchTerm"/)
  assert.match(form, /:create-item="\{ when: 'always', position: 'top' \}"/)
  assert.match(form, /@update:search-term="searchItems\(line, \$event\)"/)
  assert.match(form, /@create="createItem\(line, \$event\)"/)
})

test('enter follows the row fields and finishes at unit', () => {
  assert.match(form, /v-model="line\.price"[^>]+@keydown\.enter\.exact\.prevent="focusLineSize\(line\)"/)
  assert.match(form, /v-model="line\.size"[^>]+@keydown\.enter\.exact\.prevent="focusLineUnit\(line\)"/)
  assert.match(form, /<UnitInput[^>]+v-model="line\.unit"[^>]+@keydown\.enter\.exact\.prevent="finishLine\(line\)"/)
})

test('command-enter or control-enter finishes from every row field', () => {
  assert.equal((form.match(/@keydown\.meta\.enter\.prevent="finishLine\(line\)"/g) || []).length, 4)
  assert.equal((form.match(/@keydown\.ctrl\.enter\.prevent="finishLine\(line\)"/g) || []).length, 4)
})

test('enter advances only after the required item and price are complete', () => {
  assert.match(form, /if \(!line\.item\.trim\(\)\)[\s\S]+data-line-item/)
  assert.match(form, /if \(!receiptLineIsComplete\(line\)\)[\s\S]+data-line-price/)
})

test('selecting or creating an item advances focus to its price', () => {
  assert.match(form, /function chooseItem[\s\S]+requestAnimationFrame\(\(\) => document\.querySelector<HTMLInputElement>\(`\[data-line-price="\$\{line\.key\}"\]`\)\?\.focus\(\)\)/)
  assert.match(form, /function createItem[\s\S]+requestAnimationFrame\(\(\) => document\.querySelector<HTMLInputElement>\(`\[data-line-price="\$\{line\.key\}"\]`\)\?\.focus\(\)\)/)
  assert.doesNotMatch(form, /Enter a price to complete this row/)
})

test('receipt entry provides keyboard workflow help', () => {
  const labelsStart = form.indexOf('class="receipt-line-labels"')
  const linesStart = form.indexOf('<ol v-if="canEnterLines"')
  assert.match(form, /<UPopover>/)
  assert.ok(form.indexOf('aria-label="Keyboard entry help"') > labelsStart)
  assert.ok(form.indexOf('aria-label="Keyboard entry help"') < linesStart)
  assert.match(form, /aria-label="Keyboard entry help"/)
  assert.match(form, /Enter<\/kbd> accepts an item, then moves through Price, Size, and Unit/)
  assert.match(form, /From Unit, it starts the next row/)
  assert.match(form, /Item and Price are required\. Size and Unit are optional\./)
  assert.match(stylesheet, /\.receipt-keyboard-help \{[^}]+text-align: left;/)
  assert.match(stylesheet, /\.receipt-line-labels \{[^}]+align-items: center;/)
})

test('a saved receipt can be exported for CSV reimport', () => {
  assert.match(form, /label="Export receipt"[^>]+icon="i-lucide-download"/)
  assert.match(form, /:disabled="saving \|\| !completeLines\.length"/)
  assert.match(form, /@click="exportReceiptCsv"/)
  assert.match(form, /const rows = completeLines\.value\.map/)
  assert.match(form, /entryCsv\(rows\)/)
  assert.match(form, /receipt-box-\$\{form\.purchasedOn\}-\$\{store\}\.csv/)
})

test('receipt-key collisions require confirmation before autosave can merge', () => {
  assert.match(form, /if \(saving\.value \|\| checkingReceiptMatch\.value\) return/)
  assert.match(form, /window\.confirm\(/)
  assert.match(form, /Merge this receipt into it\?/)
  assert.match(form, /form\.purchasedOn = confirmedKey\.purchasedOn/)
  assert.match(form, /form\.location = confirmedKey\.location/)
  assert.match(form, /Could not check for an existing receipt\. The date and store were restored\./)
})
