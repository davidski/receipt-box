import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
const managePage = await readFile(new URL('../app/components/ManagePage.vue', import.meta.url), 'utf8')
const history = await readFile(new URL('../app/components/HistoryPage.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const header = await readFile(new URL('../app/components/AppHeader.vue', import.meta.url), 'utf8')
const receiptEditorPage = await readFile(new URL('../app/pages/receipts/[id].vue', import.meta.url), 'utf8')
const matchApi = await readFile(new URL('../server/api/receipts/match.get.ts', import.meta.url), 'utf8')
const unitInput = await readFile(new URL('../app/components/UnitInput.vue', import.meta.url), 'utf8')

test('category guidance sits under and is associated with the selector', () => {
  assert.match(form, /CategoryInput[^>]+aria-describedby="`category-scope-\$\{line\.key\}`"/)
  assert.match(form, /id="`category-scope-\$\{line\.key\}`" class="[^"]*category-scope-hint[^"]*mt-\[5px\][^"]*">Applies to all purchases of this item\./)
  assert.match(stylesheet, /\.receipt-line-details \.category-input \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/)
})

test('receipt entry warns before in-app navigation and page unload when dirty', () => {
  assert.match(form, /onBeforeRouteLeave\(to => confirmDiscardNavigation\(to\)/)
  assert.match(form, /onBeforeRouteUpdate\(to => confirmDiscardNavigation\(to\)/)
  assert.match(form, /@click="openMatchingReceipt"/)
  assert.match(form, /function openMatchingReceipt\(\) \{\s*if \(matchingReceipt\.value\) return navigateTo\(`\/receipts\/\$\{matchingReceipt\.value\.id\}`\)/)
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
  assert.match(form, /hasReceipt \? 'Edit receipt' : 'Add receipt'/)
  assert.match(form, /Completed rows save automatically\./)
  assert.match(form, /unsaved .* in progress/)
})

test('the sale-price toggle explains its state on hover and to assistive technology', () => {
  assert.match(form, /:aria-label="line\.saleItem \? 'Remove sale-price flag' : 'Mark as purchased at a sale price'"/)
  assert.match(form, /:title="line\.saleItem \? 'Purchased at a sale price\. Click to remove\.' : 'Mark as purchased at a sale price\.'"/)
  assert.match(stylesheet, /\.receipt-line-options button, \.receipt-line-details \.category-input \[data-category-clear\] \{ min-width: 42px; min-height: 42px; justify-content: center; \}/)
  assert.match(stylesheet, /\.receipt-line-remove:hover, \.receipt-line-remove:focus-visible \{ color: var\(--error\); \}/)
})

test('the details toggle explains its action on hover', () => {
  assert.match(form, /:aria-label="line\.expanded \? 'Hide details' : 'Show details'"[^>]+:title="line\.expanded \? 'Hide item details' : 'Show item details'"/)
})

test('the remove-line button explains which line it will remove on hover', () => {
  assert.match(form, /:aria-label="`Remove line \$\{index \+ 1\}`" :title="`Remove line \$\{index \+ 1\}`"/)
})

test('tablet receipt rows right-align theme controls and compact the row actions', () => {
  assert.match(form, /class="[^"]*receipt-line-labels[^"]*grid-cols-\[minmax\(230px,2fr\)_120px_100px_130px_126px\][^"]*"/)
  assert.match(stylesheet, /\.receipt-line-labels > :last-child \{ position: absolute; top: 50%; right: 24px; transform: translateY\(-50%\); \}/)
  assert.match(form, /class="[^"]*receipt-entry-line[^"]*grid-cols-\[minmax\(230px,2fr\)_120px_100px_130px_126px\][^"]*"/)
  assert.match(stylesheet, /@media \(max-width: 900px\) \{[\s\S]*?\.app-header \{ grid-template-columns: minmax\(0, 1fr\) auto;/)
  assert.match(stylesheet, /\.receipt-entry-line \{ grid-template-columns: minmax\(0, 1fr\) 112px 100px 96px 126px;/)
  assert.match(form, /class="(?=[^"]*receipt-line-options)(?=[^"]*\[align-self:end\])(?=[^"]*gap-0)[^"]*"/)
  assert.match(form, /<div class="(?=[^"]*receipt-line-options)(?=[^"]*\[align-self:end\])[^\"]*">[\s\S]*?:data-line-sale="line\.key"[\s\S]*?:data-line-details="line\.key"[\s\S]*?:data-line-remove="line\.key"/)
})

test('duplicate matches stay with the blocked editor state', () => {
  const footerEnd = form.indexOf('</footer>')
  const blockedEditorStart = form.indexOf('<div v-else class="receipt-store-prompt ')
  assert.ok(footerEnd > -1)
  assert.ok(form.indexOf('<UAlert v-if="errorMessage"') > footerEnd)
  assert.ok(blockedEditorStart > -1)
  assert.ok(form.indexOf('<template v-if="matchingReceiptMessage">') > blockedEditorStart)
  assert.match(form, /Your draft lines are kept while you choose another store\./)
  assert.doesNotMatch(form, /color="success"/)
  assert.match(stylesheet, /\.receipt-entry-form > \.notice \{ width: auto; margin-inline: 24px; \}/)
})

test('expanding line details keeps the row number aligned with the item field', () => {
  assert.match(form, /class="[^"]*receipt-line-number[^"]*top-\[22px\][^"]*left-5[^"]*"/)
  assert.match(stylesheet, /\.receipt-line-number \{ top: 10px; left: 14px; \}/)
})

test('add and edit use one receipt editor that loads existing lines', () => {
  assert.match(header, /label: 'Receipts'/)
  assert.match(form, /Choose a store and enter its purchases\. Completed rows save automatically\./)
  assert.doesNotMatch(form, /Existing receipt lines load for editing\./)
  assert.match(form, /loadReceipt\(result\.receipt\)/)
  assert.match(form, /@create="createLocation"/)
  assert.match(matchApi, /entries: entries\.map\(publicEntry\)/)
  assert.match(history, /:to="`\/receipts\/\$\{receipt\.id\}`"/)
  assert.doesNotMatch(history, /<ReceiptEntryForm/)
})

test('changing a receipt ID keeps the editor page instance', () => {
  assert.match(receiptEditorPage, /definePageMeta\(\{ key: 'receipt-editor' \}\)/)
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
  assert.match(form, /<form class="receipt-entry-form overflow-visible/)
  assert.match(form, /class="[^"]*receipt-entry-footer[^"]*sticky[^"]*bottom-0[^"]*"/)
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
  assert.match(form, /class="item-backfill-proposed flex gap-3"[\s\S]+pendingBackfill\.size[\s\S]+pendingBackfill\.unit/)
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
  assert.match(form, /if \(saving\.value \|\| checkingReceiptMatch\.value \|\| receiptMatchFailed\.value \|\| matchingReceipt\.value \|\| pendingDuplicateMerge\.value \|\| pendingBackfill\.value\) return/)
  assert.match(form, /receiptMatchFailed\.value = true[\s\S]+Retry the check before saving/)
  assert.match(form, /v-if="receiptMatchFailed"[^>]+label="Retry receipt check"/)
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
  assert.match(form, /class="[^"]*receipt-keyboard-help[^"]*w-\[min\(320px,calc\(100vw-32px\)\)\][^"]*text-left[^"]*"/)
  assert.match(form, /class="receipt-line-labels relative grid[^\"]+ items-center/)
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
  assert.match(form, /<form class="receipt-entry-form overflow-visible/)
  assert.match(form, /class="[^"]*receipt-entry-footer[^"]*sticky[^"]*bottom-0[^"]*"/)
  assert.match(form, /p-\[16px_24px_max\(16px,env\(safe-area-inset-bottom\)\)\]/)
  assert.match(form, /label="Save and add another"/)
})

test('sticky footer keeps the current date and store visible as read-only text', () => {
  assert.match(form, /<dl class="[^"]*receipt-footer-context[^"]*" data-receipt-footer-context aria-label="Current receipt">/)
  assert.match(form, /<dt>Date<\/dt>[\s\S]*<time :datetime="form\.purchasedOn">\{\{ dateDisplayLabel\(form\.purchasedOn\) \}\}<\/time>/)
  assert.match(form, /<dt>Store<\/dt>[\s\S]*<dd><span :title="form\.location">\{\{ form\.location \}\}<\/span><\/dd>/)
  assert.match(stylesheet, /@media \(max-width: 900px\) \{[\s\S]*\.receipt-entry-footer \{ bottom: calc\(76px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(stylesheet, /@media \(max-width: 1280px\) \{[\s\S]*\.receipt-footer-context \{ order: -1; flex: 1 1 calc\(100% - 144px\);/)
  assert.match(stylesheet, /\.receipt-footer-context \{ flex: 1 0 100%;/)
})

test('receipt routes retain the date when starting another receipt', () => {
  assert.match(receiptEditorPage, /definePageMeta\(\{ key: 'receipt-editor' \}\)/)
  assert.match(form, /router\.replace\(\{ path: '\/receipts\/new', query: \{ date: nextDate \} \}\)/)
})

test('new receipt items require inline confirmation', () => {
  assert.match(form, /@create="requestCreateItem\(line, \$event\)"/)
  assert.match(form, /v-if="line\.pendingItemCreation" class="[^"]*receipt-item-create-confirmation[^"]*" role="alert"/)
  assert.match(form, /label="Create item"/)
  assert.match(form, /label="Cancel"[^>]+@click="cancelCreateItem\(line\)"/)
})

test('receipt-key collisions require confirmation before autosave can merge', () => {
  assert.match(form, /if \(saving\.value \|\| checkingReceiptMatch\.value \|\| pendingDuplicateMerge\.value\) return false/)
  assert.match(form, /if \(!currentReceiptId\.value && receiptMatchFailed\.value\) return false/)
  assert.match(form, /&& !matchingReceipt\.value/)
  assert.match(form, /&& !pendingDuplicateMerge\.value/)
  assert.match(form, /checkingReceiptMatch\.value \|\| receiptMatchFailed\.value \|\| matchingReceipt\.value \|\| pendingDuplicateMerge\.value \|\| pendingBackfill\.value/)
  assert.match(form, /checkingReceiptMatch\.value \|\| pendingDuplicateMerge\.value\) return false/)
  assert.match(form, /pendingDuplicateMerge\.value =/)
  assert.match(form, /title="Merge duplicate receipt\?"/)
  assert.match(form, /Merge this receipt into it\?/)
  assert.match(form, /form\.purchasedOn = confirmedKey\.purchasedOn/)
  assert.match(form, /form\.location = confirmedKey\.location/)
  assert.match(form, /Could not check for an existing receipt\. The date and store were restored\./)
})
