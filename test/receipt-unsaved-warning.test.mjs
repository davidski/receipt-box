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
const preference = await readFile(new URL('../app/composables/useBackfillPromptPreference.ts', import.meta.url), 'utf8')
const preferenceGet = await readFile(new URL('../server/api/preferences/backfill-prompts.get.ts', import.meta.url), 'utf8')
const preferencePut = await readFile(new URL('../server/api/preferences/backfill-prompts.put.ts', import.meta.url), 'utf8')
const databaseReset = await readFile(new URL('../server/utils/database-reset.ts', import.meta.url), 'utf8')
const manageMiddleware = await readFile(new URL('../app/middleware/manage.ts', import.meta.url), 'utf8')

test('category guidance sits under and is associated with the selector', () => {
  assert.match(form, /CategoryInput[^>]+aria-describedby="`category-scope-\$\{line\.key\}`"/)
  assert.match(form, /id="`category-scope-\$\{line\.key\}`" class="[^"]*category-scope-hint[^"]*mt-\[0.3125rem\][^"]*">Applies to all purchases of this item\./)
  assert.match(stylesheet, /\[data-line-panel\] \.category-input \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/)
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
  assert.match(stylesheet, /\[data-line-panel\] \.category-input \[data-category-clear\] \{ min-width: 2.625rem; min-height: 2.625rem; justify-content: center; \}/)
  for (const attr of ['data-line-sale', 'data-line-details', 'data-line-remove']) {
    assert.match(form.match(new RegExp(`<UButton[^>]*${attr}=[^>]*>`, 's'))[0] ?? '', /min-h-10\.5 min-w-10\.5 justify-center/, `${attr} keeps its touch size`)
  }
  assert.match(form, /class="[^"]*hover:text-danger focus-visible:text-danger[^"]*"[^>]*:data-line-remove="line\.key"/)
})

test('the details toggle explains its action on hover', () => {
  assert.match(form, /:aria-label="line\.expanded \? 'Hide details' : 'Show details'"[^>]+:title="line\.expanded \? 'Hide item details' : 'Show item details'"/)
})

test('the remove-line button explains which line it will remove on hover', () => {
  assert.match(form, /:aria-label="`Remove line \$\{index \+ 1\}`" :title="`Remove line \$\{index \+ 1\}`"/)
})

test('tablet receipt rows right-align theme controls and compact the row actions', () => {
  assert.match(form, /data-line-labels class="[^"]*grid-cols-\[minmax\(14.375rem,2fr\)_7.5rem_6.25rem_8.125rem_7.875rem\][^"]*"/)
  assert.match(form, /<UButton[^>]*class="absolute top-1\/2 right-6 -translate-y-1\/2" aria-label="Keyboard entry help"/)
  assert.match(form, /:data-receipt-line="line\.key"[^>]*class="[^"]*grid-cols-\[minmax\(14.375rem,2fr\)_7.5rem_6.25rem_8.125rem_7.875rem\][^"]*"/)
  assert.match(header, /max-\[900\.01px\]:grid-cols-\[minmax\(0,_1fr\)_auto\]/)
  assert.match(form, /max-lg:grid-cols-\[minmax\(0,_1fr\)_7rem_6.25rem_6rem_7.875rem\]/)
  assert.match(form, /<div class="(?=[^"]*self-end)(?=[^"]*gap-0)[^"]*">[\s\S]*?:data-line-sale="line\.key"[\s\S]*?:data-line-details="line\.key"[\s\S]*?:data-line-remove="line\.key"/)
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
  for (const notice of [/<UAlert v-if="errorMessage"[^>]*>/, /<UButton v-if="receiptMatchFailed"[^>]*>/]) {
    assert.match(form.match(notice)[0], /data-receipt-notice class="mx-6 mt-3\.75 w-auto [^"]*max-sm:mx-3/)
  }
})

test('expanding line details keeps the row number aligned with the item field', () => {
  assert.match(form, /class="group absolute top-\[1.375rem\][^"]*left-5[^"]*"/)
  assert.match(form, /class="group absolute[^"]*max-lg:top-\[0.625rem\][^"]*max-lg:left-\[0.875rem\]/)
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
  assert.match(form, /<form class="overflow-visible/)
  assert.match(form, /<footer[^>]*data-receipt-footer class="[^"]*sticky[^"]*bottom-0[^"]*"/)
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
  assert.match(form, /v-if="autosaveFailed"[^>]+label="Retry"[^>]+size="md"/)
  assert.match(form, /v-if="orderStatus === 'error'"[^>]+label="Retry"[^>]+size="md"/)
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
  assert.match(managePage, /When enabled, ask before filling missing quantity or unit values in older entries for the same item\. When disabled, older entries stay unchanged\./)
  assert.match(managePage, /to="\/data\/preferences"/)
  assert.match(managePage, /@update:model-value="saveBackfillPrompts\(\$event === true\)"/)
  assert.match(manageMiddleware, /'preferences'/)
  assert.match(preference, /if \(await loadAuthMode\(\)\)[\s\S]+apiUrl\('\/preferences\/backfill-prompts'\)/)
  assert.match(preference, /localStorage\.getItem\('receipt-box:item-backfill-prompts'\) !== 'disabled'/)
  assert.match(preference, /localStorage\.setItem\('receipt-box:item-backfill-prompts', value \? 'enabled' : 'disabled'\)/)
  assert.match(form, /loadBackfillPrompts\(\)/)
  assert.match(preferenceGet, /WHERE user_sub = \$\{user\.sub\}/)
  assert.match(preferenceGet, /preference\?\.enabled \?\? true/)
  assert.match(preferencePut, /typeof body\?\.enabled !== 'boolean'/)
  assert.match(preferencePut, /ON CONFLICT \(user_sub\) DO UPDATE SET backfill_prompts_enabled = EXCLUDED\.backfill_prompts_enabled/)
  assert.doesNotMatch(databaseReset, /grocery_user_preferences/)
})

test('receipt entry provides keyboard workflow help', () => {
  const labelsStart = form.indexOf('data-line-labels')
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
  assert.match(form, /class="[^"]*receipt-keyboard-help[^"]*w-\[min\(20rem,calc\(100vw-2rem\)\)\][^"]*text-left[^"]*"/)
  assert.match(form, /data-line-labels class="label relative grid[^\"]+ items-center/)
})

test('receipt footer actions use the xl size, so their text is 16px', () => {
  // Nuxt UI sizes lg at 14px, so 16px footer text needs xl.
  const sized = (label, size) => new RegExp(`(?:label="${label}"[^>]*size="${size}"|size="${size}"[^>]*label="${label}")`)
  for (const label of ['Cancel split', 'Delete receipt', 'Export receipt', 'Split receipt', 'Save and add another', 'Keep receipt', 'Delete permanently']) {
    assert.match(form, sized(label, 'xl'), `${label} is not xl`)
  }
  assert.doesNotMatch(form, /label="(Cancel split|Delete receipt|Export receipt|Split receipt|Save and add another)"[^>]*size="(xs|sm|md|lg)"/)
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
  assert.match(form, /<form class="overflow-visible/)
  assert.match(form, /<footer[^>]*data-receipt-footer class="[^"]*sticky[^"]*bottom-0[^"]*"/)
  assert.match(form, /px-6 pt-4 pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/)
  assert.match(form, /label="Save and add another"/)
})

test('sticky footer keeps the current date and store visible as read-only text', () => {
  assert.match(form, /<dl class="[^"]*" data-receipt-footer-context aria-label="Current receipt">/)
  assert.match(form, /<dt class="label">Date<\/dt>[\s\S]*<time class="block truncate" :datetime="form\.purchasedOn">\{\{ dateDisplayLabel\(form\.purchasedOn\) \}\}<\/time>/)
  assert.match(form, /<dt class="label">Store<\/dt>[\s\S]*<dd class="[^"]*" :title="form\.location">\{\{ form\.location \}\}<\/dd>/)
  assert.match(form, /max-\[900\.01px\]:bottom-\[calc\(4.75rem_\+_env\(safe-area-inset-bottom\)\)\]/)
  assert.match(form, /<dl class="[^"]*max-xl:flex-\[1_0_100%\]/)
})

test('the receipt footer reads in the same order it is drawn', () => {
  const footer = form.slice(form.indexOf('<footer'), form.indexOf('</footer>'))
  assert.doesNotMatch(footer, /(?:^|[\s:"])-?order-/, 'footer content is never reordered with CSS')
  const positions = ['data-receipt-footer-context', 'label="Delete receipt"', 'label="Save and add another"', 'role="status"', 'MoneyAmount']
    .map((marker) => footer.indexOf(marker))
  assert.ok(positions.every((position) => position > -1))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
})

test('the receipt footer buttons meet the 44px phone target', () => {
  const footer = form.slice(form.indexOf('<footer'), form.indexOf('</footer>'))
  // Whole lines: some buttons have `>=` inside their attributes.
  const buttons = footer.split('\n').filter((line) => line.includes('<UButton') && line.includes('size="xl"'))
  assert.equal(buttons.length, 7)
  for (const button of buttons) assert.match(button, /class="touch-target[ "]/, button)
})

test('the receipt form uses named radii, rem breakpoints, and shared money formatting', () => {
  assert.doesNotMatch(form, /rounded-\[|rounded-(?:xl|lg|3xl)\b/)
  // The footer offset is the one px breakpoint: it tracks AppHeader's bottom navigation, which is still px.
  assert.deepEqual(form.match(/(?:max|min)-\[[^\]]*px\]:/g), ['max-[900.01px]:'])
  assert.doesNotMatch(form, /toFixed\(2\)\}|\$\$\{/, 'displayed prices go through formatCurrency')
  assert.match(form, /\{\{ formatCurrency\(line\.price\) \}\}/)
  assert.match(form, /<MoneyAmount :value="receiptTotal" \/>/)
})

test('sticky footer shrinks only its status text, not button labels or the store', () => {
  assert.doesNotMatch(stylesheet, /\.receipt-(entry-footer|footer-|autosave-status|delete-)/)
  const footer = form.slice(form.indexOf('<footer'), form.indexOf('</footer>'))
  assert.match(footer, /<span class="block text-xs text-muted">\{\{ enteredLines\.length \}\}/)
})

test('receipt routes retain the date when starting another receipt', () => {
  assert.match(receiptEditorPage, /definePageMeta\(\{ key: 'receipt-editor' \}\)/)
  assert.match(form, /router\.replace\(\{ path: '\/receipts\/new', query: \{ date: nextDate \} \}\)/)
})

test('new receipt items require inline confirmation', () => {
  assert.match(form, /@create="requestCreateItem\(line, \$event\)"/)
  assert.match(form, /v-if="line\.pendingItemCreation" class="[^"]*bg-accent-soft[^"]*" role="alert"/)
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
