import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../app/components/HistoryPage.vue', import.meta.url), 'utf8')
const indexRoute = await readFile(new URL('../app/pages/history/index.vue', import.meta.url), 'utf8')
const viewRoute = await readFile(new URL('../app/pages/history/[...view].vue', import.meta.url), 'utf8')
const middleware = await readFile(new URL('../app/middleware/history.ts', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('History keeps its page heading stable across views', () => {
  assert.match(page, /Purchase records<\/p>/)
  assert.match(page, /<h1 class="text-\[clamp\(34px,3\.5vw,42px\)\] leading-\[1\.04\]">Receipts<\/h1>/)
  assert.match(page, /Browse receipts by date\./)
  assert.match(page, /class="page-heading my-\[15px\] mb-8 history-heading">[\s\S]*class="receipt-mode-switcher receipt-views" aria-label="Receipts view"/)
  assert.doesNotMatch(page, /history-view-summary/)
  assert.match(viewRoute, /middleware: 'history'/)
  assert.match(middleware, /to\.path === '\/history'/)
  assert.match(middleware, /entries.*receipts\/calendar.*receipts\/list/s)
  assert.match(page, /to="\/" label="Calendar"/)
  assert.match(page, /to="\/history\/receipts\/list" label="Receipt list"/)
  assert.match(page, /to="\/history\/entries"/)
  assert.match(page, /label="Calendar" icon="i-lucide-calendar-days"/)
  assert.match(page, /label="Item entries" icon="i-lucide-list"/)
  assert.match(page, /<th scope="col">Date<\/th><th scope="col">Store<\/th><th scope="col">Items<\/th><th scope="col">Total<\/th>/)
  assert.match(page, /Receipt date, store, and total/)
  assert.equal((page.match(/aria-label="Receipt list pagination"/g) || []).length, 2)
  assert.doesNotMatch(page, /view === 'receipts' \? 'Shopping trips'/)
  assert.doesNotMatch(page, /The full Receipt Box/)
})

test('Purchase editor uses consistent spacing between form rows', () => {
  assert.match(stylesheet, /\.edit-dialog \.form-grid, \.edit-dialog \.quick-toggles \{ margin-top: 16px; \}/)
  assert.match(stylesheet, /\.edit-dialog \.form-grid \+ \.field, \.edit-dialog \.quick-toggles \+ \.field \{ margin-top: 16px; \}/)
  assert.match(stylesheet, /\.edit-dialog \.form-grid \.field \+ \.field \{ margin-top: 0; \}/)
})

test('Calendar receipt store headings keep wrapped lines compact', () => {
  assert.match(stylesheet, /\.receipt-heading h2 \{ font-size: 23px; line-height: 1\.05; \}/)
  assert.match(stylesheet, /\.receipt-heading > button, \.receipt-heading > a \{ align-self: flex-start; \}/)
})

test('Calendar lets an empty date become the selected date', () => {
  const calendarButton = page.match(/<button\s+type="button"\s+:class="\{ available:[\s\S]*?@click="selectReceiptDate\(day\)"[\s\S]*?<\/button>/)?.[0]
  assert.ok(calendarButton)
  assert.doesNotMatch(calendarButton, /:disabled=/)
  assert.match(calendarButton, /@click="selectReceiptDate\(day\)"/)
  assert.match(page, /function selectReceiptDate\(day: CalendarDay\) \{\s*selectReceiptDateValue\(day\.date\)/)
})

test('Calendar month state initializes before URL sync watches it', () => {
  assert.ok(page.indexOf('const selectedCalendarMonth = computed') < page.indexOf('watch([search, location, sortBy'))
})

test('Calendar offers a same-day add link for populated and empty dates', () => {
  const addReceiptControl = page.indexOf(":to=\"{ path: '/receipts/new', query: { date: selectedDate } }\" label=\"Add receipt\"")
  assert.ok(addReceiptControl > -1)
  assert.ok(addReceiptControl < page.indexOf('v-else-if="!receiptData?.receipts.length"'))
  assert.match(page, /No receipts for this date/)
})

test('Page content reserves the scrollbar gutter', () => {
  assert.match(stylesheet, /html \{ min-height: 100%; background: var\(--bg\); overflow-y: scroll; scrollbar-gutter: stable both-edges; \}/)
})

test('History filters keep the store selector from widening the filter bar', () => {
  assert.match(stylesheet, /\.filter-bar \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 220px\) minmax\(0, 220px\)/)
  assert.match(stylesheet, /\.store-filter-control, \.store-filter-control > \[data-slot="base"\], \.category-filter-control, \.category-filter-control > \[data-slot="base"\] \{ min-width: 0; \}/)
})

test('History store filtering does not lock the page scroll', () => {
  assert.match(page, /:content="\{ bodyLock: false \}"/)
})

test('History preserves navigation state in the URL and uses Nuxt UI controls', () => {
  assert.match(page, /route\.query\.search/)
  assert.match(page, /query\.store = location\.value !== allLocationsValue/)
  assert.match(page, /query\.category = category\.value \|\| undefined/)
  assert.match(page, /USelect v-model="categorySelection" :items=.*All categories/)
  assert.match(page, /Filter by category/)
  assert.match(page, /query\.filter = changeFilter\.value !== 'all'/)
  assert.match(page, /query\.sort = sortBy\.value !== 'purchasedOn'/)
  assert.match(page, /query\.page =/)
  assert.match(page, /query\.date = view\.value === 'receipts'/)
  assert.match(page, /query\.month = view\.value === 'receipts'/)
  assert.doesNotMatch(page, /<select /)
  assert.doesNotMatch(page, /<button type="button" @click="toggleSort/)
  assert.match(page, /<UModal :open="Boolean\(editing\)" title="Edit purchase"/)
  assert.match(page, /<ConfirmModal[\s\S]+title="Delete purchase\?"/)
  assert.doesNotMatch(page, /confirm\(/)
})

test('History filters entries by category and labels categorized receipt lines', async () => {
  const entriesApi = await readFile(new URL('../server/api/entries/index.get.ts', import.meta.url), 'utf8')
  assert.match(entriesApi, /const category = String\(query\.category \?\? ''\)\.trim\(\)/)
  assert.equal((entriesApi.match(/category = \$\{category\}/g) || []).length, 3)
  assert.match(page, /UBadge v-if="entry\.category" :label="entry\.category"/)
})

test('Receipts keeps headings intact and uses tablet space without widening mobile pages', () => {
  assert.match(stylesheet, /\.selected-receipts-heading \{ display: grid;/)
  assert.match(stylesheet, /@media \(min-width: 760px\) and \(max-width: 900px\) \{\s*\.receipt-browser \{ grid-template-columns: 280px minmax\(0, 1fr\); \}/)
  assert.match(stylesheet, /\.history-heading \{ display: grid; align-items: start; \}/)
})
