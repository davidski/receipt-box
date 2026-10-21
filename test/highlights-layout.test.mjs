import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const page = await readFile(new URL('../app/pages/highlights.vue', import.meta.url), 'utf8')
const endpoint = await readFile(new URL('../server/api/highlights.get.ts', import.meta.url), 'utf8')

test('the Highlights period field accommodates its longest option without overflowing', () => {
  assert.match(page, /class="period-field w-60[^"]*"/)
  assert.match(stylesheet, /\.period-field \[data-slot="base"\] \{ width: 100%; \}/)
  assert.match(page, /max-sm:w-\[min\(15rem,_100%\)\]/)
  assert.match(page, /:content="\{ bodyLock: false \}"/)
})

test('the monthly spending chart stays within its card and compresses wide ranges', () => {
  assert.match(page, /ref="monthlySpendContainer" class="w-full max-w-full overflow-hidden/)
  assert.match(page, /const width = monthlySpendWidth\.value/)
  assert.match(page, /const barWidth = Math\.max\(1, Math\.min\(28, slotWidth \* 0\.64\)\)/)
  assert.match(page, /const hitWidth = Math\.max\(barWidth, Math\.min\(28, slotWidth\)\)/)
  assert.match(page, /const labelEvery = Math\.max\(1, Math\.ceil\(54 \/ slotWidth\)\)/)
  assert.doesNotMatch(page, /minWidth: `\$\{monthlySpendChart\.width\}px`/)
})

test('the monthly spending bars use prettyScale from a zero baseline', () => {
  assert.match(page, /prettyScale\(0, Math\.max\(rawMax, 1\), \{ minStep: 1 \}\)/)
  assert.match(page, /const ticks = breaks\.map\(value => \(\{ value, y: plot\.top \+ \(\(max - value\) \/ max\) \* plotHeight \}\)\)/)
  assert.doesNotMatch(page, /roughStep/)
})

test('the Highlights chart and table styling lives in utilities, not main.css', () => {
  for (const selector of ['stat-card', 'price-index-', 'monthly-spend-', 'core-items-table', 'shrinkflation-table', 'movers-table', 'category-price-list']) {
    assert.ok(!stylesheet.includes(`.${selector}`), `main.css should not define .${selector}`)
  }
  assert.doesNotMatch(page, /max-\[\d+\.01px\]/)
  assert.doesNotMatch(page, /rounded-(?:\[1\.375rem\]|2xl|xl)\b/)
})

test('Highlights cards share the Purchases by month heading size', () => {
  assert.match(stylesheet, /\.highlights-page \.highlight-panel h2 \{ font-size: var\(--text-heading\); \}/)
  assert.doesNotMatch(stylesheet, /\.core-items-heading h2 \{[^}]*font-size:/)
  assert.doesNotMatch(stylesheet, /\.movers-panel \.section-heading h2 \{[^}]*font-size:/)
})

test('the Highlights page explains and renders core-item price velocity', () => {
  assert.match(page, /Core item price stability/)
  assert.match(page, /3\+ receipts across 2\+ months/)
  assert.match(page, /velocity compares non-sale prices/)
  assert.match(page, /data\.coreItems\.length/)
})

test('the core-item table uses compact desktop rows without losing mobile labels', () => {
  assert.match(page, /class="core-item-inline flex /)
  assert.match(page, /data-label="Regularity"/)
  assert.match(page, /data-label="Price behavior"/)
})

test('Highlights omits redundant recent and sale-frequency views', () => {
  assert.doesNotMatch(page, /Recent prices/)
  assert.doesNotMatch(page, /Frequent sale items/)
  assert.doesNotMatch(page, /unique items bought on sale/)
  assert.doesNotMatch(endpoint, /recentRows|saleItemRows|topSaleItems|saleItems:/)
  assert.match(page, /Recent movers/)
  assert.match(page, /Top stores/)
  assert.match(page, /class="[^"]*grid-cols-3/)
})

test('Top stores anchors each spend amount to the end of its bar', () => {
  assert.match(page, /class="[^"]*store-spend-value[^"]*" :style="\{ width:/)
  assert.match(page, /class="store-bar h-2 overflow-hidden rounded-full \[background:var\(--surface-muted\)\][^"]*"><i :style="\{ width:/)
  assert.match(page, /class="[^"]*store-spend-value[^"]*text-right[^"]*whitespace-nowrap/)
  assert.match(page, /class="[^"]*store-rank-list[^"]*list-none[^"]*gap-\[0.5625rem\][^"]*"/)
  assert.match(page, /class="[^"]*store-name-label[^"]*" :title="store\.name"/)
})

test('Recent movers uses compact table rows with a mobile card fallback', () => {
  assert.match(page, /class="[^"]*text-sm[^"]+">\{\{ shortDate\(entry\.previousPurchasedOn\) \}\} → \{\{ shortDate\(entry\.purchasedOn\) \}\}/)
  assert.match(page, /class="[^"]*text-sm[^"]*">\{\{ entry\.previousLocation \}\} → \{\{ entry\.location \}\}/)
  assert.doesNotMatch(page, /class="mover-list"/)
})

test('Highlights avoids undersized nine-pixel text', () => {
  assert.doesNotMatch(stylesheet, /font-size: 0.5625rem/)
  assert.match(page, /class="[^"]*text-sm[^"]*">\{\{ entry\.previousLocation/)
  assert.match(page, /class="[^"]*store-spend-value[^"]*text-xs/)
})

test('Highlights renders the same-item price index with coverage context', () => {
  assert.match(page, /Regular purchase price index/)
  assert.match(page, /The first month is 100/)
  assert.match(page, /weighted by prior-month spending/)
  assert.match(page, /priceIndexSummary\.latest\.matchedItems/)
  // Rounded 1-2-5 breaks now come from the shared prettyScale(), tested in chart-scale.test.mjs.
  assert.match(page, /prettyScale\(rawMin, rawMax, \{ minStep: 1 \}\)/)
  assert.match(page, /tick\.value\.toFixed\(0\)/)
  assert.match(page, /v-for="segment in priceIndexChart\.segments"/)
  assert.match(page, /At least three matched regular items/)
  assert.match(endpoint, /priceIndex: priceIndex\(reportObservations\)/)
  assert.match(page, /aria-label="How the price index is calculated"/)
  assert.match(page, /Find items purchased in both the current and previous month/)
  assert.match(page, /Weight each movement by spending on that item in the previous month/)
  assert.match(page, /weighted geometric mean/)
})

test('Highlights reports comparable regular-price movement by category', () => {
  assert.match(page, /Category price movement/)
  assert.match(page, /data\.categoryPriceChanges\.slice\(0, 5\)/)
  assert.match(page, /entry\.matchedItems/)
  assert.match(page, /No category has enough regular-price history/)
  assert.match(page, /Assign categories to more items/)
  assert.match(endpoint, /sale_item, category/)
  assert.match(endpoint, /categoryPriceChanges: categoryPriceChanges\(reportObservations\)/)
})

test('core item rows include accessible regular-price sparklines', () => {
  assert.match(page, /class="[^"]*core-sparkline[^"]*"/)
  assert.match(page, /sparklinePoints\(item\.priceSeries\)/)
  assert.match(page, /:aria-label="`\$\{item\.name\} regular price trend`"/)
  assert.match(endpoint, /array_agg\(comparable_price::text ORDER BY purchased_on, id\) AS price_series/)
  assert.match(page, /class="[^"]*core-sparkline[^"]*"/)
})

test('Highlights explains monthly spending changes without claiming quantity data', () => {
  assert.match(page, /Same-package price effect/)
  assert.match(page, /Different\/additional purchases/)
  assert.match(page, /basket composition and shopping frequency/)
  assert.match(endpoint, /spendChanges: spendChanges\(reportObservations\)/)
})

test('Highlights reports possible shrinkflation across the period boundary', () => {
  assert.match(page, /Possible shrinkflation/)
  assert.match(page, /Smaller packaged goods whose shelf price stayed the same or increased/)
  assert.match(page, /Variable-weight and per-item purchases are excluded/)
  assert.match(page, /unitCurrency\(entry\.previousUnitPrice\) \}\} → \{\{ unitCurrency\(entry\.unitPrice\)/)
  assert.match(page, /\{\{ entry\.unitPriceLabel \}\}/)
  assert.match(page, /wholeChangeLabel\(entry\.unitCostChangePercent\)/)
  assert.match(endpoint, /shrinkflation\(observations\(shrinkRows\)\)\.filter/)
  assert.match(endpoint, /WHERE NOT non_grocery\s+AND \(\$\{endDate\}::date IS NULL OR purchased_on < \$\{endDate\}::date\)/)
})

test('shrinkflation defaults to impact order and supports sorting every visible column', () => {
  assert.match(page, /const shrinkflationSort = ref<ShrinkflationSort>\('impact'\)/)
  assert.match(page, /const shrinkflationDirection = ref<'asc' \| 'desc'>\('desc'\)/)
  for (const column of ['item', 'package', 'price', 'impact']) {
    assert.match(page, new RegExp(`@click="setShrinkflationSort\\('${column}'\\)"`))
  }
  assert.match(page, /v-for="entry in sortedShrinkflation"/)
  assert.match(page, /:aria-sort="shrinkflationAriaSort\('impact'\)"/)
  assert.match(page, /class="shrinkflation-impact flex items-center justify-end gap-2 whitespace-nowrap[^"]*"/)
  assert.match(stylesheet, /\.shrinkflation-impact > strong, \.shrinkflation-impact > span \{ white-space: nowrap; \}/)
})
