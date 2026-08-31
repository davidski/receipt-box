<script setup lang="ts">
import { sparklinePoints } from '../../shared/utils/highlight-reports'

type HighlightEntry = {
  id: string
  purchasedOn: string
  item: string
  location: string
  size: string | null
  unit: string | null
  price: string
  saleItem: boolean
}

type PriceMover = HighlightEntry & {
  previousPurchasedOn: string
  previousLocation: string
  priceChangePercent: string
  comparisonBasis: 'normalized' | 'package'
}

type Highlights = {
  availableYears: number[]
  reportingPeriod: { startDate: string, endDate: string } | null
  summary: { entries: number, receipts: number, items: number, stores: number, firstDate: string | null, lastDate: string | null }
  movers: PriceMover[]
  topStores: { name: string, totalSpent: number, lastUsed: string }[]
  coreItems: {
    name: string
    purchases: number
    activeMonths: number
    averageDaysBetween: number | null
    lastPurchasedOn: string
    priceObservations: number
    averageChangePercent: number | null
    netChangePercent: number | null
    stability: 'limited' | 'stable' | 'steady' | 'changing' | 'volatile'
    trend: 'flat' | 'up' | 'down' | 'unknown'
    priceSeries: number[]
  }[]
  monthlySpend: { month: string, totalSpent: number }[]
  priceIndex: { month: string, value: number | null, matchedItems: number }[]
  spendChanges: { month: string, totalSpent: number, change: number | null, priceEffect: number | null, basketEffect: number | null, matchedItems: number }[]
  shrinkflation: {
    item: string
    previousPurchasedOn: string
    purchasedOn: string
    previousSize: number
    size: number
    unit: string
    previousPrice: number
    price: number
    previousUnitPrice: number
    unitPrice: number
    unitPriceLabel: string
    sizeChangePercent: number
    unitCostChangePercent: number
  }[]
}

const { apiUrl } = useApi()
const selectedPeriod = ref('12m')
const periodQuery = computed(() => ({ period: selectedPeriod.value }))
const { data, pending, error, refresh } = await useFetch<Highlights>(apiUrl('/highlights'), { query: periodQuery })
const periodOptions = computed(() => [
  { label: 'All time', value: 'all' },
  { label: 'Current month', value: 'current-month' },
  { label: 'Previous 12 full months', value: '12m' },
  ...(data.value?.availableYears || []).map(year => ({ label: String(year), value: String(year) }))
])
const maxStoreSpend = computed(() => Math.max(1, ...(data.value?.topStores.map(store => store.totalSpent) || [])))
const selectedSpendMonth = ref<string | null>(null)

watch(selectedPeriod, () => {
  selectedSpendMonth.value = null
})

function wholeCurrency(value: string | number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(Number(value))
}

function wholeNumber(value: string | number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value))
}

function monthLabel(value: string, compact = false) {
  const date = parseCalendarDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(undefined, compact
    ? { month: 'short', year: '2-digit' }
    : { month: 'long', year: 'numeric' }).format(date)
}

const monthlySpendTotal = computed(() => (data.value?.monthlySpend || []).reduce((total, month) => total + month.totalSpent, 0))
const selectedMonthlySpend = computed(() => data.value?.monthlySpend.find(month => month.month === selectedSpendMonth.value) || null)
const selectedSpendChange = computed(() => data.value?.spendChanges.find(month => month.month === selectedSpendMonth.value)
  || data.value?.spendChanges.at(-1) || null)
type ShrinkflationSort = 'item' | 'package' | 'price' | 'impact'
const shrinkflationSort = ref<ShrinkflationSort>('impact')
const shrinkflationDirection = ref<'asc' | 'desc'>('desc')

function setShrinkflationSort(column: ShrinkflationSort) {
  if (shrinkflationSort.value === column) {
    shrinkflationDirection.value = shrinkflationDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }
  shrinkflationSort.value = column
  shrinkflationDirection.value = column === 'item' ? 'asc' : 'desc'
}

function shrinkflationSortIcon(column: ShrinkflationSort) {
  if (shrinkflationSort.value !== column) return 'i-lucide-chevrons-up-down'
  return shrinkflationDirection.value === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}

function shrinkflationAriaSort(column: ShrinkflationSort) {
  if (shrinkflationSort.value !== column) return 'none' as const
  return shrinkflationDirection.value === 'asc' ? 'ascending' as const : 'descending' as const
}

const sortedShrinkflation = computed(() => [...(data.value?.shrinkflation || [])].sort((left, right) => {
  let comparison = 0
  if (shrinkflationSort.value === 'item') comparison = left.item.localeCompare(right.item)
  if (shrinkflationSort.value === 'package') comparison = left.sizeChangePercent - right.sizeChangePercent
  if (shrinkflationSort.value === 'price') comparison = (left.price - left.previousPrice) - (right.price - right.previousPrice)
  if (shrinkflationSort.value === 'impact') comparison = left.unitCostChangePercent - right.unitCostChangePercent
  if (comparison === 0) comparison = left.purchasedOn.localeCompare(right.purchasedOn) || left.item.localeCompare(right.item)
  return shrinkflationDirection.value === 'asc' ? comparison : -comparison
}))
const monthlySpendContainer = ref<HTMLElement | null>(null)
const monthlySpendWidth = ref(720)
let monthlySpendResizeObserver: ResizeObserver | null = null

watch(monthlySpendContainer, (element) => {
  monthlySpendResizeObserver?.disconnect()
  monthlySpendResizeObserver = null
  if (!element || typeof ResizeObserver === 'undefined') return

  const setWidth = (width: number) => {
    monthlySpendWidth.value = Math.max(280, Math.floor(width))
  }
  setWidth(element.clientWidth)
  monthlySpendResizeObserver = new ResizeObserver(([entry]) => {
    if (entry) setWidth(entry.contentRect.width)
  })
  monthlySpendResizeObserver.observe(element)
}, { flush: 'post' })

onBeforeUnmount(() => monthlySpendResizeObserver?.disconnect())

const monthlySpendChart = computed(() => {
  const months = data.value?.monthlySpend || []
  if (!months.length) return null

  const width = monthlySpendWidth.value
  const height = 300
  const plot = { left: 72, right: 18, top: 16, bottom: 52 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const rawMax = Math.max(...months.map(month => month.totalSpent), 0)
  const roughStep = Math.max(rawMax / 4, 1)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude
  const max = step * 4
  const slotWidth = plotWidth / months.length
  const barWidth = Math.max(1, Math.min(28, slotWidth * 0.64))
  const hitWidth = Math.max(barWidth, Math.min(28, slotWidth))
  const labelEvery = Math.max(1, Math.ceil(54 / slotWidth))
  const bars = months.map((month, index) => {
    const x = plot.left + slotWidth * index + slotWidth / 2
    const y = plot.top + ((max - month.totalSpent) / max) * plotHeight
    return {
      ...month,
      x,
      y,
      height: plot.top + plotHeight - y,
      barWidth,
      hitWidth,
      showLabel: index % labelEvery === 0 || index === months.length - 1,
      label: months.length > 96
        ? String(parseCalendarDate(month.month)?.getFullYear() || '')
        : monthLabel(month.month, true)
    }
  })
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max - step * index
    return { value, y: plot.top + (plotHeight * index) / 4 }
  })

  return { width, height, plot, bars, ticks, plotBottom: plot.top + plotHeight }
})

const priceIndexContainer = ref<HTMLElement | null>(null)
const priceIndexWidth = ref(720)
let priceIndexResizeObserver: ResizeObserver | null = null

watch(priceIndexContainer, (element) => {
  priceIndexResizeObserver?.disconnect()
  priceIndexResizeObserver = null
  if (!element || typeof ResizeObserver === 'undefined') return
  const setWidth = (width: number) => { priceIndexWidth.value = Math.max(280, Math.floor(width)) }
  setWidth(element.clientWidth)
  priceIndexResizeObserver = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width) })
  priceIndexResizeObserver.observe(element)
}, { flush: 'post' })

onBeforeUnmount(() => priceIndexResizeObserver?.disconnect())

const priceIndexChart = computed(() => {
  const points = data.value?.priceIndex || []
  const validPoints = points.filter((point): point is typeof point & { value: number } => point.value !== null)
  if (validPoints.length < 2) return null
  const width = priceIndexWidth.value
  const height = 260
  const plot = { left: 62, right: 18, top: 20, bottom: 44 }
  const values = validPoints.map(point => point.value)
  const rawMin = Math.min(...values, 100)
  const rawMax = Math.max(...values, 100)
  const roughStep = Math.max((rawMax - rawMin) / 4, 1)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalizedStep = roughStep / magnitude
  const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude
  let min = Math.floor(rawMin / step) * step
  let max = Math.ceil(rawMax / step) * step
  if (min === max) {
    min -= step * 2
    max += step * 2
  }
  const xRange = width - plot.left - plot.right
  const yRange = height - plot.top - plot.bottom
  const positioned = points.map((point, index) => ({
    ...point,
    x: plot.left + (index / (points.length - 1)) * xRange,
    y: point.value === null ? null : plot.top + ((max - point.value) / (max - min)) * yRange,
    showLabel: index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0
  }))
  const tickCount = Math.round((max - min) / step) + 1
  const ticks = Array.from({ length: tickCount }, (_, index) => ({ value: max - step * index, y: plot.top + (yRange * index) / (tickCount - 1) }))
  const segments: string[] = []
  let segment: string[] = []
  for (const point of positioned) {
    if (point.y === null) {
      if (segment.length > 1) segments.push(segment.join(' '))
      segment = []
    } else {
      segment.push(`${point.x},${point.y}`)
    }
  }
  if (segment.length > 1) segments.push(segment.join(' '))
  return { width, height, plot, positioned, ticks, segments }
})

const priceIndexSummary = computed(() => {
  const points = (data.value?.priceIndex || []).filter((point): point is typeof point & { value: number } => point.value !== null)
  const first = points[0]
  const latest = points.at(-1)
  if (!first || !latest || points.length < 2) return null
  return { change: latest.value - first.value, latest }
})

function shortDate(value: string | null) {
  const date = parseCalendarDate(value)
  return date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : '—'
}

const coverageText = computed(() => {
  if (data.value?.reportingPeriod) {
    return `History from ${shortDate(data.value.reportingPeriod.startDate)} through ${shortDate(data.value.reportingPeriod.endDate)}`
  }
  return data.value?.summary.firstDate
    ? `History from ${shortDate(data.value.summary.firstDate)} through ${shortDate(data.value.summary.lastDate)}`
    : 'No purchases in this period.'
})

function percentage(value: string) {
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number)}%`
}

const stabilityDetails = {
  limited: { label: 'Limited history', color: 'neutral' as const, icon: 'i-lucide-circle-help' },
  stable: { label: 'Stable', color: 'success' as const, icon: 'i-lucide-equal-approximately' },
  steady: { label: 'Slow-moving', color: 'primary' as const, icon: 'i-lucide-move-right' },
  changing: { label: 'Changing', color: 'warning' as const, icon: 'i-lucide-activity' },
  volatile: { label: 'Volatile', color: 'error' as const, icon: 'i-lucide-zap' }
}

function cadenceLabel(days: number | null) {
  if (days === null) return '—'
  if (days < 10) return `Every ${Math.max(1, Math.round(days))} days`
  const weeks = Math.round(days / 7)
  return weeks === 1 ? 'About weekly' : `Every ${weeks} weeks`
}

function changeLabel(value: number | null) {
  if (value === null) return '—'
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`
}

function wholeChangeLabel(value: number) {
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}%`
}

function signedCurrency(value: number | null) {
  if (value === null) return '—'
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${wholeCurrency(Math.abs(value))}`
}

function unitCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}
</script>

<template>
  <div class="w-full max-w-[1200px] mx-auto highlights-page">
    <header class="page-heading my-[15px] mb-8 highlights-heading">
      <div>
        <p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">At a glance</p>
        <h1>Price highlights</h1>
        <p>Recent activity and notable price movement.</p>
      </div>
      <div class="highlights-actions">
        <UFormField label="Period" class="period-field">
          <USelect v-model="selectedPeriod" class="touch-target" :items="periodOptions" icon="i-lucide-calendar-range" aria-label="Highlight period" />
        </UFormField>
      </div>
    </header>

    <div v-if="pending" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">Loading highlights…</div>
    <div v-else-if="error" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)] error-state">
      <strong>Could not load highlights</strong>
      <UButton type="button" label="Try again" color="neutral" variant="outline" @click="refresh()" />
    </div>
    <template v-else-if="data">
      <p class="coverage-line">
        {{ coverageText }}
      </p>

      <section class="highlight-stats" aria-label="Pricebook summary">
        <UCard class="stat-card"><UIcon name="i-lucide-receipt-text" /><strong>{{ data.summary.receipts.toLocaleString() }}</strong><span>receipts</span></UCard>
        <UCard class="stat-card"><UIcon name="i-lucide-shopping-basket" /><strong>{{ data.summary.items.toLocaleString() }}</strong><span>unique items</span></UCard>
        <UCard class="stat-card"><UIcon name="i-lucide-dollar-sign" /><strong>{{ wholeNumber(monthlySpendTotal) }}</strong><span>total spend</span></UCard>
      </section>

      <UCard class="price-index-panel highlight-panel">
        <div class="monthly-spend-heading">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Same-item prices</p>
            <div class="price-index-title">
              <h2>Regular purchase price index</h2>
              <UPopover>
                <UButton type="button" icon="i-lucide-circle-help" color="neutral" variant="ghost" size="sm" aria-label="How the price index is calculated" title="How the price index is calculated" />
                <template #content>
                  <div class="price-index-help">
                    <strong>How the index is calculated</strong>
                    <ol>
                      <li>Find items purchased in both the current and previous month.</li>
                      <li>Compare each item using its normalized, non-sale price.</li>
                      <li>Calculate the percentage price movement for each item.</li>
                      <li>Weight each movement by spending on that item in the previous month.</li>
                      <li>Combine the movements using a weighted geometric mean.</li>
                    </ol>
                  </div>
                </template>
              </UPopover>
            </div>
            <p>Month-to-month price movement for recurring, comparable non-sale items, weighted by prior-month spending. The first month is 100.</p>
          </div>
          <UBadge v-if="priceIndexSummary" :label="`${changeLabel(priceIndexSummary.change)} overall`" :color="priceIndexSummary.change > 0 ? 'error' : priceIndexSummary.change < 0 ? 'success' : 'neutral'" variant="soft" />
        </div>
        <div v-if="priceIndexChart" ref="priceIndexContainer" class="price-index-chart">
          <svg :viewBox="`0 0 ${priceIndexChart.width} ${priceIndexChart.height}`" role="img" aria-label="Same-item regular purchase price index over time">
            <title>Regular purchase price index</title>
            <g class="price-index-grid">
              <g v-for="tick in priceIndexChart.ticks" :key="tick.y">
                <line :x1="priceIndexChart.plot.left" :x2="priceIndexChart.width - priceIndexChart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text :x="priceIndexChart.plot.left - 10" :y="tick.y + 4" text-anchor="end">{{ tick.value.toFixed(0) }}</text>
              </g>
            </g>
            <polyline v-for="segment in priceIndexChart.segments" :key="segment" class="price-index-line" :points="segment" />
            <g v-for="point in priceIndexChart.positioned" :key="point.month">
              <circle v-if="point.y !== null && point.value !== null" class="price-index-point" :cx="point.x" :cy="point.y" r="4"><title>{{ monthLabel(point.month) }} · {{ point.value.toFixed(1) }} · {{ point.matchedItems }} matched items</title></circle>
              <text v-if="point.showLabel" class="price-index-month" :x="point.x" :y="priceIndexChart.height - 16" :text-anchor="point.x < priceIndexChart.plot.left + 20 ? 'start' : point.x > priceIndexChart.width - priceIndexChart.plot.right - 20 ? 'end' : 'middle'">{{ monthLabel(point.month, true) }}</text>
            </g>
          </svg>
        </div>
        <div v-else class="chart-empty">At least three matched regular items across consecutive months are needed.</div>
        <p v-if="priceIndexSummary" class="index-coverage">Latest month uses {{ priceIndexSummary.latest.matchedItems }} matched {{ priceIndexSummary.latest.matchedItems === 1 ? 'item' : 'items' }}.</p>
      </UCard>

      <UCard class="monthly-spend-panel highlight-panel">
        <div class="monthly-spend-heading">
          <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Monthly spending</p><h2>Purchases by month</h2></div>
        </div>
        <div v-if="monthlySpendChart" ref="monthlySpendContainer" class="monthly-spend-scroll">
          <svg
            :viewBox="`0 0 ${monthlySpendChart.width} ${monthlySpendChart.height}`"
            role="img"
            aria-label="Total purchase dollars by month"
          >
            <title>Monthly purchase spending</title>
            <g class="monthly-spend-grid">
              <g v-for="tick in monthlySpendChart.ticks" :key="tick.y">
                <line :x1="monthlySpendChart.plot.left" :x2="monthlySpendChart.width - monthlySpendChart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text :x="monthlySpendChart.plot.left - 10" :y="tick.y + 4" text-anchor="end">{{ wholeCurrency(tick.value) }}</text>
              </g>
            </g>
            <g class="monthly-spend-bars">
              <g
                v-for="bar in monthlySpendChart.bars"
                :key="bar.month"
                class="monthly-spend-bar-group"
                role="button"
                tabindex="0"
                :aria-label="`${monthLabel(bar.month)}: ${wholeCurrency(bar.totalSpent)}`"
                @click="selectedSpendMonth = bar.month"
                @keydown.enter.prevent="selectedSpendMonth = bar.month"
                @keydown.space.prevent="selectedSpendMonth = bar.month"
              >
                <rect
                  class="monthly-spend-hit"
                  :x="bar.x - bar.hitWidth / 2"
                  :y="monthlySpendChart.plot.top"
                  :width="bar.hitWidth"
                  :height="monthlySpendChart.plotBottom - monthlySpendChart.plot.top"
                />
                <rect
                  :class="['monthly-spend-bar', { selected: selectedSpendMonth === bar.month }]"
                  :x="bar.x - bar.barWidth / 2"
                  :y="bar.y"
                  :width="bar.barWidth"
                  :height="Math.max(bar.height, bar.totalSpent > 0 ? 2 : 0)"
                  rx="3"
                >
                  <title>{{ monthLabel(bar.month) }} · {{ wholeCurrency(bar.totalSpent) }}</title>
                </rect>
                <text v-if="bar.showLabel" class="monthly-spend-month" :x="bar.x" :y="monthlySpendChart.height - 20" text-anchor="middle">{{ bar.label }}</text>
              </g>
            </g>
          </svg>
        </div>
        <div v-else class="chart-empty">No purchases in this period.</div>
        <div v-if="selectedSpendChange" class="spend-explanation" aria-live="polite">
          <div><strong>{{ monthLabel(selectedSpendChange.month) }}</strong><span>{{ wholeCurrency(selectedSpendChange.totalSpent) }} spent</span></div>
          <template v-if="selectedSpendChange.change !== null">
            <div><span>Change from prior month</span><strong>{{ signedCurrency(selectedSpendChange.change) }}</strong></div>
            <div><span>Same-package price effect</span><strong>{{ signedCurrency(selectedSpendChange.priceEffect) }}</strong></div>
            <div><span>Different/additional purchases</span><strong>{{ signedCurrency(selectedSpendChange.basketEffect) }}</strong></div>
            <small>Price effect uses {{ selectedSpendChange.matchedItems }} matched {{ selectedSpendChange.matchedItems === 1 ? 'item' : 'items' }}; the remainder reflects basket composition and shopping frequency.</small>
          </template>
        </div>
      </UCard>

      <UCard class="core-items-panel highlight-panel" aria-labelledby="core-items-heading">
        <div class="flex items-end justify-between gap-5 pb-5 mb-2 core-items-heading">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Regular purchases</p>
            <h2 id="core-items-heading">Core item price stability</h2>
            <p>Items bought on 3+ receipts across 2+ months; velocity compares non-sale prices.</p>
          </div>
        </div>
        <div v-if="data.coreItems.length" class="core-items-table-wrap">
          <table class="core-items-table text-sm [&_th]:text-[11px]">
            <thead>
              <tr><th>Item</th><th>Regularity</th><th>Price behavior</th><th>Trend</th><th>Net change</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in data.coreItems" :key="item.name">
                <td data-label="Item">
                  <NuxtLink :to="itemPath(item.name)" class="item-history-link" :aria-label="`View normalized price history for ${item.name}`" :title="`Last bought ${shortDate(item.lastPurchasedOn)}`">
                    <strong>{{ item.name }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                </td>
                <td data-label="Regularity"><div class="core-item-inline"><strong>{{ item.purchases }} receipts</strong><span class="text-xs">{{ cadenceLabel(item.averageDaysBetween) }} · {{ item.activeMonths }} mo.</span></div></td>
                <td data-label="Price behavior">
                  <div class="core-item-inline">
                    <UBadge v-bind="stabilityDetails[item.stability]" variant="soft" />
                    <span class="text-xs">{{ item.averageChangePercent === null ? 'Limited comparable history' : `${changeLabel(item.averageChangePercent)} avg. · ${item.priceObservations} prices` }}</span>
                  </div>
                </td>
                <td data-label="Trend">
                  <svg v-if="item.priceSeries.length > 1" class="core-sparkline" viewBox="0 0 120 32" role="img" :aria-label="`${item.name} regular price trend`">
                    <polyline :points="sparklinePoints(item.priceSeries)" />
                  </svg>
                  <span v-else class="sparkline-empty">—</span>
                </td>
                <td data-label="Net change" class="core-item-change">
                  <UBadge
                    :label="changeLabel(item.netChangePercent)"
                    :icon="item.trend === 'up' ? 'i-lucide-trending-up' : item.trend === 'down' ? 'i-lucide-trending-down' : item.trend === 'flat' ? 'i-lucide-move-right' : 'i-lucide-minus'"
                    :color="item.trend === 'up' ? 'error' : item.trend === 'down' ? 'success' : 'neutral'"
                    variant="soft"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="panel-empty">Not enough repeat purchases in this period yet.</p>
      </UCard>

      <UCard class="shrinkflation-panel highlight-panel" aria-labelledby="shrinkflation-heading">
        <div class="flex items-end justify-between gap-5 pb-5 mb-2 core-items-heading">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Package changes</p>
            <h2 id="shrinkflation-heading">Possible shrinkflation</h2>
            <p>Smaller packaged goods whose shelf price stayed the same or increased. Variable-weight and per-item purchases are excluded.</p>
          </div>
        </div>
        <div v-if="data.shrinkflation.length" class="shrinkflation-table-wrap">
          <table class="shrinkflation-table text-sm [&_th]:text-[11px]">
            <thead>
              <tr>
                <th :aria-sort="shrinkflationAriaSort('item')"><UButton label="Item" :icon="shrinkflationSortIcon('item')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('item')" /></th>
                <th :aria-sort="shrinkflationAriaSort('package')"><UButton label="Package change" :icon="shrinkflationSortIcon('package')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('package')" /></th>
                <th :aria-sort="shrinkflationAriaSort('price')"><UButton label="Shelf price" :icon="shrinkflationSortIcon('price')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('price')" /></th>
                <th :aria-sort="shrinkflationAriaSort('impact')"><UButton label="Unit-cost impact" :icon="shrinkflationSortIcon('impact')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('impact')" /></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in sortedShrinkflation" :key="`${entry.item}-${entry.purchasedOn}`">
                <td data-label="Item"><NuxtLink :to="itemPath(entry.item)" class="item-history-link"><strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" /></NuxtLink><span>{{ shortDate(entry.previousPurchasedOn) }} → {{ shortDate(entry.purchasedOn) }}</span></td>
                <td data-label="Package change"><strong>{{ entry.previousSize }} → {{ entry.size }} {{ entry.unit }}</strong><span>{{ changeLabel(entry.sizeChangePercent) }}</span></td>
                <td data-label="Shelf price"><strong>{{ wholeCurrency(entry.previousPrice) }} → {{ wholeCurrency(entry.price) }}</strong></td>
                <td data-label="Unit-cost impact">
                  <div class="shrinkflation-impact">
                    <strong>{{ unitCurrency(entry.previousUnitPrice) }} → {{ unitCurrency(entry.unitPrice) }}</strong>
                    <span>{{ entry.unitPriceLabel }}</span>
                    <UBadge :label="wholeChangeLabel(entry.unitCostChangePercent)" color="error" variant="soft" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="panel-empty">No smaller same-price packages found in this period.</p>
      </UCard>

      <div class="highlights-grid">
        <UCard class="highlight-panel movers-panel" aria-labelledby="movers-heading">
            <div class="flex items-end justify-between gap-5 pb-5 mb-2">
              <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Since last purchase</p><h2 id="movers-heading">Recent movers</h2></div>
            </div>
            <div v-if="data.movers.length" class="movers-table-wrap">
              <table class="movers-table text-sm [&_th]:text-[11px]">
                <thead><tr><th>Item</th><th>Comparison</th><th>Change</th></tr></thead>
                <tbody>
                  <tr v-for="entry in data.movers" :key="entry.id">
                    <td data-label="Item">
                  <NuxtLink :to="itemPath(entry.item)" class="item-history-link" :aria-label="`View normalized price history for ${entry.item}`">
                    <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                    </td>
                    <td data-label="Comparison" class="mover-context">
                      <strong class="mover-dates text-xs">{{ shortDate(entry.previousPurchasedOn) }} → {{ shortDate(entry.purchasedOn) }}</strong>
                      <span class="mover-stores text-xs">{{ entry.previousLocation }} → {{ entry.location }}</span>
                    </td>
                    <td data-label="Change" class="mover-change">
                      <UBadge
                        :label="percentage(entry.priceChangePercent)"
                        :icon="Number(entry.priceChangePercent) > 0 ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                        :color="Number(entry.priceChangePercent) > 0 ? 'error' : 'success'"
                        variant="soft"
                        :title="`Compared with the ${entry.comparisonBasis} price on ${shortDate(entry.previousPurchasedOn)}`"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="panel-empty">No significant price changes in this period.</p>
        </UCard>

        <UCard class="highlight-panel stores-panel">
            <div class="flex items-end justify-between gap-5 pb-5 mb-2">
              <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Highest spending</p><h2>Top stores</h2></div>
              <UButton to="/data/stores" label="Manage stores" icon="i-lucide-settings-2" color="neutral" variant="outline" size="sm" />
            </div>
            <ul v-if="data.topStores.length" class="store-rank-list">
              <li v-for="store in data.topStores" :key="store.name">
                <strong class="store-name-label" :title="store.name">{{ store.name }}</strong>
                <div class="store-spend-visual">
                  <span class="store-spend-value text-xs" :style="{ width: `${(store.totalSpent / maxStoreSpend) * 100}%` }">{{ wholeCurrency(store.totalSpent) }}</span>
                  <span class="store-bar"><i :style="{ width: `${(store.totalSpent / maxStoreSpend) * 100}%` }" /></span>
                </div>
              </li>
            </ul>
            <p v-else class="panel-empty">No store activity in this period.</p>
        </UCard>

      </div>
    </template>
  </div>
</template>
