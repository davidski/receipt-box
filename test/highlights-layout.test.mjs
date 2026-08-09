import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const page = await readFile(new URL('../app/pages/highlights.vue', import.meta.url), 'utf8')
const endpoint = await readFile(new URL('../server/api/highlights.get.ts', import.meta.url), 'utf8')

test('the Highlights period field accommodates its longest option without overflowing', () => {
  assert.match(stylesheet, /\.period-field \{ width: 240px; \}/)
  assert.match(stylesheet, /\.period-field \[data-slot="base"\] \{ width: 100%; \}/)
  assert.match(stylesheet, /\.period-field \{ width: min\(240px, 100%\); \}/)
})

test('the monthly spending chart stays within its card and compresses wide ranges', () => {
  assert.match(page, /ref="monthlySpendContainer" class="monthly-spend-scroll"/)
  assert.match(page, /const width = monthlySpendWidth\.value/)
  assert.match(page, /const barWidth = Math\.max\(1, Math\.min\(28, slotWidth \* 0\.64\)\)/)
  assert.match(page, /const hitWidth = Math\.max\(barWidth, Math\.min\(28, slotWidth\)\)/)
  assert.match(page, /const labelEvery = Math\.max\(1, Math\.ceil\(54 \/ slotWidth\)\)/)
  assert.doesNotMatch(page, /minWidth: `\$\{monthlySpendChart\.width\}px`/)
  assert.match(stylesheet, /\.monthly-spend-scroll \{ width: 100%; max-width: 100%; overflow: hidden;/)
})

test('Highlights cards share the Purchases by month heading size', () => {
  assert.match(stylesheet, /\.highlights-page \.highlight-panel h2 \{ font-size: 25px; \}/)
  assert.doesNotMatch(stylesheet, /\.core-items-heading h2 \{[^}]*font-size:/)
  assert.doesNotMatch(stylesheet, /\.movers-panel \.section-heading h2 \{[^}]*font-size:/)
})

test('the Highlights page explains and renders core-item price velocity', () => {
  assert.match(page, /Core item price stability/)
  assert.match(page, /3\+ receipts across 2\+ months/)
  assert.match(page, /velocity compares non-sale prices/)
  assert.match(page, /data\.coreItems\.length/)
  assert.match(stylesheet, /\.core-items-table, \.core-items-table tbody \{ display: grid;/)
})

test('the core-item table uses compact desktop rows without losing mobile labels', () => {
  assert.match(stylesheet, /\.core-items-table td \{ padding: 9px 12px;/)
  assert.match(page, /class="core-items-table text-sm \[&_th\]:text-\[11px\]"/)
  assert.doesNotMatch(stylesheet, /\.core-items-table (?:th|td) \{[^}]*font-size:/)
  assert.match(stylesheet, /\.core-item-inline \{ display: flex;/)
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
  assert.match(stylesheet, /\.highlight-stats \{ display: grid; grid-template-columns: repeat\(3, 1fr\);/)
})

test('Top stores anchors each spend amount to the end of its bar', () => {
  assert.match(page, /class="store-spend-value text-xs" :style="\{ width:/)
  assert.match(page, /class="store-bar"><i :style="\{ width:/)
  assert.match(stylesheet, /\.store-spend-value \{[^}]*text-align: right;[^}]*white-space: nowrap;/)
  assert.match(stylesheet, /\.store-rank-list \{ display: grid; gap: 9px; \}/)
  assert.match(page, /class="store-name-label" :title="store\.name"/)
  assert.match(stylesheet, /\.store-name-label \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
})

test('Recent movers uses compact table rows with a mobile card fallback', () => {
  assert.match(page, /<table class="movers-table text-sm \[&_th\]:text-\[11px\]">/)
  assert.match(page, /<th>Item<\/th><th>Comparison<\/th><th>Change<\/th>/)
  assert.match(page, /class="mover-dates text-xs">\{\{ shortDate\(entry\.previousPurchasedOn\) \}\} → \{\{ shortDate\(entry\.purchasedOn\) \}\}/)
  assert.match(page, /class="mover-stores text-xs">\{\{ entry\.previousLocation \}\} → \{\{ entry\.location \}\}/)
  assert.doesNotMatch(page, /class="mover-list"/)
  assert.match(stylesheet, /\.movers-table td \{ padding: 9px;/)
  assert.match(stylesheet, /\.mover-context \{ display: grid; gap: 2px;/)
  assert.match(stylesheet, /\.movers-table, \.movers-table tbody \{ display: grid; gap: 10px; \}/)
})

test('Highlights avoids undersized nine-pixel text', () => {
  assert.doesNotMatch(stylesheet, /font-size: 9px/)
  assert.match(page, /class="mover-stores text-xs"/)
  assert.match(page, /class="store-spend-value text-xs"/)
})

test('Highlights renders the same-item price index with coverage context', () => {
  assert.match(page, /Regular purchase price index/)
  assert.match(page, /The first month is 100/)
  assert.match(page, /weighted by prior-month spending/)
  assert.match(page, /priceIndexSummary\.latest\.matchedItems/)
  assert.match(page, /normalizedStep <= 1 \? 1 : normalizedStep <= 2 \? 2 : normalizedStep <= 5 \? 5 : 10/)
  assert.match(page, /tick\.value\.toFixed\(0\)/)
  assert.match(page, /v-for="segment in priceIndexChart\.segments"/)
  assert.match(page, /At least three matched regular items/)
  assert.match(endpoint, /priceIndex: priceIndex\(reportObservations\)/)
  assert.match(stylesheet, /\.price-index-line \{[^}]*stroke: var\(--accent\)/)
  assert.match(page, /aria-label="How the price index is calculated"/)
  assert.match(page, /Find items purchased in both the current and previous month/)
  assert.match(page, /Weight each movement by spending on that item in the previous month/)
  assert.match(page, /weighted geometric mean/)
  assert.match(stylesheet, /\.price-index-help \{ width: min\(390px, calc\(100vw - 32px\)\)/)
})

test('core item rows include accessible regular-price sparklines', () => {
  assert.match(page, /class="core-sparkline"/)
  assert.match(page, /sparklinePoints\(item\.priceSeries\)/)
  assert.match(page, /:aria-label="`\$\{item\.name\} regular price trend`"/)
  assert.match(endpoint, /array_agg\(comparable_price::text ORDER BY purchased_on, id\) AS price_series/)
  assert.match(stylesheet, /\.core-sparkline \{[^}]*height: 24px;/)
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
  assert.match(stylesheet, /\.shrinkflation-table th > button \{/)
  assert.match(stylesheet, /\.shrinkflation-table th:last-child \{ width: 36%; \}/)
  assert.match(stylesheet, /\.shrinkflation-impact \{ display: flex;[^}]*justify-content: flex-end;[^}]*white-space: nowrap;/)
  assert.match(stylesheet, /\.shrinkflation-impact > strong, \.shrinkflation-impact > span \{ white-space: nowrap; \}/)
})
