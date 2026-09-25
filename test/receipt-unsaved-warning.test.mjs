import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
const managePage = await readFile(new URL('../app/components/ManagePage.vue', import.meta.url), 'utf8')
const history = await readFile(new URL('../app/components/HistoryPage.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const header = await readFile(new URL('../app/components/AppHeader.vue', import.meta.url), 'utf8')
const matchApi = await readFile(new URL('../server/api/receipts/match.get.ts', import.meta.url), 'utf8')
const unitInput = await readFile(new URL('../app/components/UnitInput.vue', import.meta.url), 'utf8')

test('category guidance sits under and is associated with the selector', () => {
  assert.match(form, /CategoryInput[^>]+aria-describedby="`category-scope-\$\{line\.key\}`"/)
  assert.match(form, /id="`category-scope-\$\{line\.key\}`" class="category-scope-hint">Applies to all purchases of this item\./)
  assert.match(stylesheet, /\.receipt-line-details \.category-input \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/)
  assert.match(stylesheet, /\.category-scope-hint \{ display: block; margin-top: 5px;/)
})

test('receipt entry warns before in-app navigation and page unload when dirty', () => {
  assert.match(form, /onBeforeRouteLeave\(to => confirmDiscardNavigation\(to\)/)
  assert.match(form, /title="Discard unsaved receipt\?"/)
  assert.match(form, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(form, /if \(!hasUnsavedChanges\.value\) return/)
})

test('receipt duplicate and discard confirmations use Nuxt UI modals', () => {
  assert.match(form, /title="Merge duplicate receipt\?"/)
  assert.match(form, /resolveDuplicateMerge\(true\)/)
  assert.doesNotMatch(form, /window\.confirm\(/)
})

test('completed rows autosave and confirmed saved rows delete through the API', () => {
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

test('expanding line details keeps the row number aligned with the item field', () => {
  assert.match(stylesheet, /\.receipt-line-number \{ position: absolute; top: 22px;/)
  assert.match(stylesheet, /\.receipt-line-number \{ top: 10px; left: 14px; \}/)
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
  assert.match(form, /v-model:open="line\.itemMenuOpen"/)
  assert.match(form, /v-model:search-term="line\.searchTerm"/)
  assert.match(form, /:create-item="\{ when: 'always', position: 'top' \}"/)
  assert.match(form, /@update:search-term="searchItems\(line, \$event\)"/)
  assert.match(form, /@create="requestCreateItem\(line, \$event\)"/)
})

test('enter follows the row fields and finishes at unit', () => {
  assert.match(form, /v-model="line\.price"[^>]+@keydown\.enter\.exact\.prevent="focusLineSize\(line\)"/)
  assert.match(form, /v-model="line\.size"[^>]+@keydown\.enter\.exact\.prevent="focusLineUnit\(line\)"/)
  assert.match(form, /<UnitInput[^>]+v-model="line\.unit"[^>]+@commit="finishLine\(line\)"/)
})

test('tabbing past unit reaches the sale and details controls', () => {
  assert.match(unitInput, /@keydown\.tab\.exact="advanceOnTab"/)
  assert.match(unitInput, /open\.value = false[\s\S]+emit\('tabNext'\)/)
  assert.match(form, /<UnitInput[^>]+@tab-next="focusLineSale\(line\)"/)
  assert.match(form, /function focusLineSale[\s\S]+`\[data-line-sale="\$\{line\.key\}"\]`/)
  assert.match(form, /:data-line-sale="line\.key"[^>]+@keydown\.tab\.exact\.prevent="focusLineDetails\(line\)"/)
  assert.match(form, /function focusLineDetails[\s\S]+`\[data-line-details="\$\{line\.key\}"\]`/)
  assert.match(form, /:data-line-details="line\.key"[^>]+@keydown\.tab\.exact\.prevent="advanceFromLineDetails\(line\)"/)
  assert.match(form, /function advanceFromLineDetails[\s\S]+data-line-notes/)
  assert.match(form, /:data-line-notes="line\.key"[^>]+@keydown\.tab\.exact\.prevent="focusLineNonGrocery\(line\)"/)
  assert.match(form, /:data-line-non-grocery="line\.key"[^>]+@keydown\.tab\.exact\.prevent="finishLine\(line\)"/)
})

test('command/control-shift-enter adds or focuses a row and reveals it without losing the sticky total', () => {
  assert.match(form, /function handleAddLineShortcut\(event: KeyboardEvent\)/)
  assert.match(form, /!event\.shiftKey[\s\S]+\(!event\.metaKey && !event\.ctrlKey\)/)
  assert.match(form, /window\.addEventListener\('keydown', handleAddLineShortcut, \{ capture: true \}\)/)
  assert.match(form, /window\.removeEventListener\('keydown', handleAddLineShortcut, \{ capture: true \}\)/)
  assert.doesNotMatch(form, /keydown\.alt\.n/)
  assert.match(form, /:data-receipt-line="line\.key"/)
  assert.match(form, /item\?\.focus\(\{ preventScroll: reveal \}\)/)
  assert.match(form, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/)
  assert.match(stylesheet, /\.receipt-entry-form \{ overflow: visible;/)
  assert.match(stylesheet, /\.receipt-entry-footer \{ position: sticky; bottom: 0;/)
})

test('command-enter or control-enter finishes from every row field', () => {
  assert.equal((form.match(/@keydown\.meta\.enter\.exact\.prevent="finishLine\(line\)"/g) || []).length, 4)
  assert.equal((form.match(/@keydown\.ctrl\.enter\.exact\.prevent="finishLine\(line\)"/g) || []).length, 4)
})

test('enter advances only after the required item and price are complete', () => {
  assert.match(form, /if \(!line\.item\.trim\(\)\)[\s\S]+data-line-item/)
  assert.match(form, /if \(!receiptLineIsComplete\(line\)\)[\s\S]+data-line-price/)
})

test('selecting or creating an item advances focus to its price', () => {
  assert.match(form, /function chooseItem[\s\S]+line\.itemMenuOpen = false[\s\S]+requestAnimationFrame\(\(\) => document\.querySelector<HTMLInputElement>\(`\[data-line-price="\$\{line\.key\}"\]`\)\?\.focus\(\)\)/)
  assert.match(form, /function confirmCreateItem[\s\S]+line\.pendingItemCreation = ''[\s\S]+requestAnimationFrame\(\(\) => document\.querySelector<HTMLInputElement>\(`\[data-line-price="\$\{line\.key\}"\]`\)\?\.focus\(\)\)/)
  assert.match(form, /v-model="line\.price"[^>]+@focus="closeItemMenu\(line\)"/)
  assert.doesNotMatch(form, /Enter a price to complete this row/)
})

test('editing an item preserves existing dimensions and saved-row removal confirms first', () => {
  assert.match(form, /if \(!line\.id \|\| line\.size === ''\) line\.size = compactNumber/)
  assert.match(form, /if \(!line\.id \|\| !line\.unit\.trim\(\)\) line\.unit = suggestion\.unit/)
  assert.match(form, /function requestRemoveLine[\s\S]+line\.confirmingRemove = true/)
  assert.match(form, /v-if="line\.confirmingRemove"[^>]+role="alert"/)
  assert.match(form, /label="Keep item"/)
  assert.match(form, /label="Remove item"/)
})

test('a failed autosave waits for an edit or explicit retry', () => {
  assert.match(form, /attemptKey === failedAutosaveKey\.value\) return/)
  assert.match(form, /failedAutosaveKey\.value = autosaveAttemptKey\(\)/)
  assert.match(form, /function retryAutosave\(\)[\s\S]+saveCompletedRows\(\)/)
  assert.match(form, /v-if="autosaveFailed"[^>]+label="Retry"/)
})

test('new dimensions offer to backfill earlier purchases without overwriting values', () => {
  assert.match(form, /<UModal[\s\S]+title="Update previous entries\?"/)
  assert.match(form, /class="item-backfill-proposed"[\s\S]+pendingBackfill\.size[\s\S]+pendingBackfill\.unit/)
  assert.match(form, /<UCheckbox[\s\S]+label="Update missing sizes"/)
  assert.match(form, /<UCheckbox[\s\S]+label="Update missing units"/)
  assert.match(form, /label="Keep unchanged"/)
  assert.match(form, /`Update \$\{selectedBackfillCount\}/)
  assert.match(form, /if \(!backfillPromptsEnabled\.value \|\| !line\.id \|\| line\.backfillPrompted \|\| \(!size && !unit\)\) return false/)
  assert.match(form, /const size = String\(line\.size \?\? ''\)\.trim\(\)/)
  assert.match(form, /Boolean\(size\) && counts\.size > 0/)
  assert.match(form, /Boolean\(unit\) && counts\.unit > 0/)
  assert.match(form, /backfillSizeSelected\.value = Boolean\(size\) && counts\.size > 0/)
  assert.match(form, /backfillUnitSelected\.value = Boolean\(unit\) && counts\.unit > 0/)
  assert.match(form, /query: \{ item: line\.item\.trim\(\), excludeId: line\.id \}/)
  assert.match(form, /backfillPrompted: boolean/)
  assert.match(form, /if \(!backfillPromptsEnabled\.value \|\| !line\.id \|\| line\.backfillPrompted \|\| \(!size && !unit\)\) return false/)
  assert.match(form, /line\.backfillPrompted = true/)
  assert.match(form, /<UnitInput[^>]+@blur="checkItemBackfillOnUnitExit\(line\)"/)
  assert.match(form, /document\.activeElement\?\.matches\(`\[data-line-unit="\$\{line\.key\}"\]`\)/)
  assert.match(form, /if \(!unitFieldIsFocused\(line\) && await offerItemBackfill\(line\)\) \{[\s\S]+savedAllRows = false[\s\S]+break/)
  assert.match(form, /backfillKey: '',[\s\S]+backfillChecking: false/)
  assert.match(form, /line\.backfillKey === key \|\| line\.backfillChecking \|\| pendingBackfill\.value/)
  assert.match(form, /if \(saving\.value \|\| checkingReceiptMatch\.value \|\| pendingBackfill\.value\) return/)
})

test('maintenance can disable receipt history prompts', () => {
  assert.match(managePage, /label="Prompt before updating previous entries"/)
  assert.match(managePage, /localStorage\.getItem\('receipt-box:item-backfill-prompts'\) !== 'disabled'/)
  assert.match(managePage, /localStorage\.setItem\('receipt-box:item-backfill-prompts', enabled \? 'enabled' : 'disabled'\)/)
  assert.match(form, /localStorage\.getItem\('receipt-box:item-backfill-prompts'\) !== 'disabled'/)
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
  assert.match(form, /Ctrl Alt Enter<\/kbd> elsewhere saves the receipt and starts another/)
  assert.match(form, /aria-keyshortcuts="Meta\+Alt\+Enter Control\+Alt\+Enter"/)
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

test('receipt totals stay visible without clipping the item selector', () => {
  assert.match(stylesheet, /\.receipt-entry-form \{ overflow: visible;/)
  assert.match(stylesheet, /\.receipt-entry-footer \{ position: sticky; bottom: 0; z-index: 5;/)
  assert.match(stylesheet, /\.receipt-entry-footer \{[^}]+env\(safe-area-inset-bottom\)/)
  assert.match(form, /label="Save and add another"/)
})

test('new receipt items require inline confirmation', () => {
  assert.match(form, /@create="requestCreateItem\(line, \$event\)"/)
  assert.match(form, /v-if="line\.pendingItemCreation" class="receipt-item-create-confirmation" role="alert"/)
  assert.match(form, /label="Create item"/)
  assert.match(form, /label="Cancel"[^>]+@click="cancelCreateItem\(line\)"/)
})

test('receipt-key collisions require confirmation before autosave can merge', () => {
  assert.match(form, /if \(saving\.value \|\| checkingReceiptMatch\.value \|\| pendingBackfill\.value\) return/)
  assert.match(form, /pendingDuplicateMerge\.value =/)
  assert.match(form, /title="Merge duplicate receipt\?"/)
  assert.match(form, /Merge this receipt into it\?/)
  assert.match(form, /form\.purchasedOn = confirmedKey\.purchasedOn/)
  assert.match(form, /form\.location = confirmedKey\.location/)
  assert.match(form, /Could not check for an existing receipt\. The date and store were restored\./)
})
