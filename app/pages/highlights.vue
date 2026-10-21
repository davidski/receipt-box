<script setup lang="ts">
import { sparklinePoints } from '../../shared/utils/highlight-reports'
import { prettyScale } from '../../shared/utils/chart-scale'
import { formatCurrency, formatSignedCurrency } from '../../shared/utils/money'

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
  categoryPriceChanges: { category: string, change: number, startMonth: string, endMonth: string, matchedItems: number }[]
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
// Shared by the three tables: desktop rows, and below sm each row becomes a card whose cells show their column name (data-label).
const dataTable = [
  'w-full border-collapse text-base',
  '[&_th]:label [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th:last-child]:text-right',
  '[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle sm:[&_td:last-child]:text-right [&_tr:last-child_td]:border-b-0',
  'max-sm:grid max-sm:gap-2.5 max-sm:[&_thead]:hidden max-sm:[&_tbody]:grid max-sm:[&_tbody]:gap-2.5',
  'max-sm:[&_tr]:grid max-sm:[&_tr]:gap-3 max-sm:[&_tr]:rounded-card max-sm:[&_tr]:border max-sm:[&_tr]:border-line max-sm:[&_tr]:bg-surface max-sm:[&_tr]:p-3.5',
  'max-sm:[&_td]:grid max-sm:[&_td]:content-start max-sm:[&_td]:gap-[0.1875rem] max-sm:[&_td]:border-0 max-sm:[&_td]:p-0 max-sm:[&_td:first-child]:col-span-full',
  'max-sm:[&_td]:before:label max-sm:[&_td]:before:content-[attr(data-label)]'
].join(' ')

const summaryTiles = computed(() => [
  { icon: 'i-lucide-receipt-text', value: (data.value?.summary.receipts ?? 0).toLocaleString(), label: 'receipts' },
  { icon: 'i-lucide-shopping-basket', value: (data.value?.summary.items ?? 0).toLocaleString(), label: 'unique items' },
  { icon: 'i-lucide-wallet', value: formatCurrency(monthlySpendTotal.value, { whole: true }), label: 'total spend' }
])

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
  // Bars start at zero; the floor of 1 keeps an all-zero period from getting a flat-series scale below zero.
  const { max, breaks } = prettyScale(0, Math.max(rawMax, 1), { minStep: 1 })
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
  const ticks = breaks.map(value => ({ value, y: plot.top + ((max - value) / max) * plotHeight }))

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
  const { min, max, breaks } = prettyScale(rawMin, rawMax, { minStep: 1 })
  const xRange = width - plot.left - plot.right
  const yRange = height - plot.top - plot.bottom
  const positioned = points.map((point, index) => ({
    ...point,
    x: plot.left + (index / (points.length - 1)) * xRange,
    y: point.value === null ? null : plot.top + ((max - point.value) / (max - min)) * yRange,
    showLabel: index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0
  }))
  const ticks = breaks.map(value => ({ value, y: plot.top + ((max - value) / (max - min)) * yRange }))
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


function unitCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}
</script>

<template>
  <div class="highlights-page mx-auto w-full max-w-300">
    <header class="page-heading my-[0.9375rem] mb-8 flex items-end justify-between gap-6 max-sm:grid max-sm:items-start">
      <div>
        <h1 class="leading-[1.04] text-display">Price highlights</h1>
        <p>Recent activity and notable price movement.</p>
      </div>
      <div class="flex items-end gap-2.5 max-sm:justify-between">
        <UFormField label="Period" class="period-field w-60 max-sm:w-[min(15rem,_100%)]">
          <USelect v-model="selectedPeriod" class="touch-target" :items="periodOptions" icon="i-lucide-calendar-range" aria-label="Highlight period" :content="{ bodyLock: false }" />
        </UFormField>
      </div>
    </header>

    <div v-if="pending" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-(--line) p-9 text-center text-(--muted)">Loading highlights…</div>
    <div v-else-if="error" class="error-state grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-(--line) p-9 text-center text-(--muted)">
      <strong>Could not load highlights</strong>
      <UButton type="button" label="Try again" color="neutral" variant="outline" @click="refresh()" />
    </div>
    <template v-else-if="data">
      <p class="m-[0.8125rem_0.125rem_1.5rem] text-sm text-(--muted)">
        {{ coverageText }}
      </p>

      <section class="mb-5 grid grid-cols-3 gap-3.5 max-sm:grid-cols-2" aria-label="Receipt Box summary">
        <UCard
          v-for="tile in summaryTiles"
          :key="tile.label"
          class="rounded-card max-sm:last:col-span-full"
          :ui="{ body: 'grid grid-cols-[auto_1fr] items-center gap-x-[0.6875rem]' }"
        >
          <UIcon :name="tile.icon" class="row-span-2 size-8 text-accent" />
          <strong class="font-display text-heading leading-none tabular-nums">{{ tile.value }}</strong>
          <span class="mt-[0.1875rem] text-xs text-muted">{{ tile.label }}</span>
        </UCard>
      </section>

      <UCard class="highlight-panel mb-5 rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
        <div class="mb-4 flex items-end justify-between gap-5 max-sm:items-start">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Same-item prices</p>
            <div class="flex items-center gap-[0.3125rem]">
              <h2 class="mt-1">Regular purchase price index</h2>
              <UPopover>
                <UButton class="shrink-0" type="button" icon="i-lucide-circle-help" color="neutral" variant="ghost" size="sm" aria-label="How the price index is calculated" title="How the price index is calculated" />
                <template #content>
                  <div class="price-index-help w-[min(24.375rem,calc(100vw-2rem))] p-[0.9375rem_1.0625rem] text-left text-(--ink)">
                    <strong class="block mb-[0.5625rem] text-sm">How the index is calculated</strong>
                    <ol class="grid gap-[0.4375rem] [margin:0] [padding-left:1.25rem] text-(--muted) text-xs leading-[1.45]">
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
            <p class="mt-[0.3125rem] max-w-170 text-xs text-muted">Month-to-month price movement for recurring, comparable non-sale items, weighted by prior-month spending. The first month is 100.</p>
          </div>
          <UBadge v-if="priceIndexSummary" :label="`${changeLabel(priceIndexSummary.change)} overall`" :color="priceIndexSummary.change > 0 ? 'error' : priceIndexSummary.change < 0 ? 'success' : 'neutral'" variant="soft" />
        </div>
        <div v-if="priceIndexChart" ref="priceIndexContainer" class="w-full max-w-full overflow-hidden">
          <svg :viewBox="`0 0 ${priceIndexChart.width} ${priceIndexChart.height}`" role="img" aria-label="Same-item regular purchase price index over time" class="block w-full h-[16.25rem]">
            <title>Regular purchase price index</title>
            <g>
              <g v-for="tick in priceIndexChart.ticks" :key="tick.y">
                <line class="stroke-line" :x1="priceIndexChart.plot.left" :x2="priceIndexChart.width - priceIndexChart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text class="fill-muted text-xs" :x="priceIndexChart.plot.left - 10" :y="tick.y + 4" text-anchor="end">{{ tick.value.toFixed(0) }}</text>
              </g>
            </g>
            <polyline v-for="segment in priceIndexChart.segments" :key="segment" class="fill-none stroke-(--chart-series) stroke-2 [stroke-linecap:round] [stroke-linejoin:round]" :points="segment" />
            <g v-for="point in priceIndexChart.positioned" :key="point.month">
              <g v-if="point.y !== null && point.value !== null"><title>{{ monthLabel(point.month) }} · {{ point.value.toFixed(1) }} · {{ point.matchedItems }} matched items</title><circle class="fill-transparent" :cx="point.x" :cy="point.y" r="16" /><circle class="fill-(--chart-series) stroke-(--surface) stroke-2" :cx="point.x" :cy="point.y" r="6" /></g>
              <text v-if="point.showLabel" class="fill-muted text-xs" :x="point.x" :y="priceIndexChart.height - 16" :text-anchor="point.x < priceIndexChart.plot.left + 20 ? 'start' : point.x > priceIndexChart.width - priceIndexChart.plot.right - 20 ? 'end' : 'middle'">{{ monthLabel(point.month, true) }}</text>
            </g>
          </svg>
        </div>
        <div v-else class="grid min-h-[8.125rem] place-items-center text-center text-(--muted)">At least three matched regular items across consecutive months are needed.</div>
        <p v-if="priceIndexSummary" class="m-[0.375rem_0_0] text-right text-xs text-(--muted)">Latest month uses {{ priceIndexSummary.latest.matchedItems }} matched {{ priceIndexSummary.latest.matchedItems === 1 ? 'item' : 'items' }}.</p>
      </UCard>

      <UCard class="highlight-panel mb-5 rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]" aria-labelledby="category-price-heading">
        <div class="mb-4 flex items-end justify-between gap-5 max-sm:items-start">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">By category</p>
            <h2 id="category-price-heading" class="mt-1">Category price movement</h2>
            <p class="mt-[0.3125rem] max-w-170 text-xs text-muted">Weighted regular-price changes for matching items. Each month-to-month comparison needs at least three matched items.</p>
          </div>
        </div>
        <ul v-if="data.categoryPriceChanges.length" class="category-price-list m-0 grid list-none gap-0 p-0">
          <li v-for="entry in data.categoryPriceChanges.slice(0, 5)" :key="entry.category">
            <strong>{{ entry.category }}</strong>
            <span class="text-xs text-(--muted) max-sm:col-start-1">{{ monthLabel(entry.startMonth) }}–{{ monthLabel(entry.endMonth) }} · {{ entry.matchedItems }} matched items</span>
            <UBadge class="max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1" :label="changeLabel(entry.change)" :color="entry.change > 0 ? 'error' : entry.change < 0 ? 'success' : 'neutral'" variant="soft" />
          </li>
        </ul>
        <p v-else class="category-price-empty m-0 text-sm text-(--muted)">No category has enough regular-price history to compare yet. <NuxtLink to="/data/items">Assign categories to more items</NuxtLink>.</p>
      </UCard>

      <UCard class="highlight-panel mb-5 rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
        <div class="mb-4 flex items-end justify-between gap-5 max-sm:items-start">
          <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Monthly spending</p><h2 class="mt-1">Purchases by month</h2></div>
        </div>
        <div v-if="monthlySpendChart" ref="monthlySpendContainer" class="w-full max-w-full overflow-hidden pb-[0.3125rem]">
          <svg
            :viewBox="`0 0 ${monthlySpendChart.width} ${monthlySpendChart.height}`"
            role="img"
            aria-label="Total purchase dollars by month"
           class="block w-full h-[18.75rem]">
            <title>Monthly purchase spending</title>
            <g>
              <g v-for="tick in monthlySpendChart.ticks" :key="tick.y">
                <line class="stroke-line" :x1="monthlySpendChart.plot.left" :x2="monthlySpendChart.width - monthlySpendChart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text class="fill-muted text-xs" :x="monthlySpendChart.plot.left - 10" :y="tick.y + 4" text-anchor="end">{{ formatCurrency(tick.value, { whole: true }) }}</text>
              </g>
            </g>
            <g>
              <g
                v-for="bar in monthlySpendChart.bars"
                :key="bar.month"
                class="group focus-visible:outline-none!"
                role="button"
                tabindex="0"
                :aria-label="`${monthLabel(bar.month)}: ${formatCurrency(bar.totalSpent, { whole: true })}`"
                @click="selectedSpendMonth = bar.month"
                @keydown.enter.prevent="selectedSpendMonth = bar.month"
                @keydown.space.prevent="selectedSpendMonth = bar.month"
              >
                <rect
                  class="cursor-pointer fill-transparent"
                  :x="bar.x - bar.hitWidth / 2"
                  :y="monthlySpendChart.plot.top"
                  :width="bar.hitWidth"
                  :height="monthlySpendChart.plotBottom - monthlySpendChart.plot.top"
                />
                <rect
                  :class="['fill-chart-series group-hover:brightness-90 group-focus-visible:stroke-(--focus-ring) group-focus-visible:stroke-3', { 'brightness-90': selectedSpendMonth === bar.month }]"
                  :x="bar.x - bar.barWidth / 2"
                  :y="bar.y"
                  :width="bar.barWidth"
                  :height="Math.max(bar.height, bar.totalSpent > 0 ? 2 : 0)"
                  rx="3"
                >
                  <title>{{ monthLabel(bar.month) }} · {{ formatCurrency(bar.totalSpent, { whole: true }) }}</title>
                </rect>
                <text v-if="bar.showLabel" class="fill-muted text-xs" :x="bar.x" :y="monthlySpendChart.height - 20" text-anchor="middle">{{ bar.label }}</text>
              </g>
            </g>
          </svg>
        </div>
        <div v-else class="grid min-h-[8.125rem] place-items-center text-center text-(--muted)">No purchases in this period.</div>
        <div v-if="selectedSpendChange" class="spend-explanation mt-2 grid grid-cols-[repeat(4,1fr)] gap-px overflow-hidden rounded-card [background:var(--line)] [border:1px_solid_var(--line)] max-sm:grid-cols-[1fr_1fr]" aria-live="polite">
          <div><strong>{{ monthLabel(selectedSpendChange.month) }}</strong><span>{{ formatCurrency(selectedSpendChange.totalSpent, { whole: true }) }} spent</span></div>
          <template v-if="selectedSpendChange.change !== null">
            <div><span>Change from prior month</span><strong>{{ formatSignedCurrency(selectedSpendChange.change, { whole: true }) }}</strong></div>
            <div><span>Same-package price effect</span><strong>{{ formatSignedCurrency(selectedSpendChange.priceEffect, { whole: true }) }}</strong></div>
            <div><span>Different/additional purchases</span><strong>{{ formatSignedCurrency(selectedSpendChange.basketEffect, { whole: true }) }}</strong></div>
            <small>Price effect uses {{ selectedSpendChange.matchedItems }} matched {{ selectedSpendChange.matchedItems === 1 ? 'item' : 'items' }}; the remainder reflects basket composition and shopping frequency.</small>
          </template>
        </div>
      </UCard>

      <UCard class="highlight-panel mb-5 rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]" aria-labelledby="core-items-heading">
        <div class="core-items-heading mb-0 flex items-start justify-between gap-5 pb-3">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Regular purchases</p>
            <h2 id="core-items-heading">Core item price stability</h2>
            <p>Items bought on 3+ receipts across 2+ months; velocity compares non-sale prices.</p>
          </div>
        </div>
        <div v-if="data.coreItems.length" class="overflow-x-auto max-sm:overflow-visible">
          <table :class="[dataTable, 'max-sm:[&_tr]:grid-cols-2']">
            <caption class="sr-only">Core item regularity, price behavior, trend, and net change</caption>
            <thead>
              <tr><th scope="col" class="w-1/4">Item</th><th scope="col" class="w-[22%]">Regularity</th><th scope="col" class="w-[28%]">Price behavior</th><th scope="col" class="w-[15%]">Trend</th><th scope="col">Net change</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in data.coreItems" :key="item.name">
                <td data-label="Item">
                  <NuxtLink :to="itemPath(item.name)" class="item-history-link inline-flex max-w-full items-center gap-[0.4375rem] text-inherit no-underline" :aria-label="`View normalized price history for ${item.name}`" :title="`Last bought ${shortDate(item.lastPurchasedOn)}`">
                    <strong>{{ item.name }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                </td>
                <td data-label="Regularity"><div class="core-item-inline flex items-center gap-2 whitespace-nowrap max-sm:grid max-sm:justify-items-start max-sm:gap-[0.3125rem] max-sm:whitespace-normal"><strong>{{ item.purchases }} receipts</strong><span class="text-sm">{{ cadenceLabel(item.averageDaysBetween) }} · {{ item.activeMonths }} mo.</span></div></td>
                <td data-label="Price behavior" class="max-sm:justify-items-start">
                  <div class="core-item-inline flex items-center gap-2 whitespace-nowrap max-sm:grid max-sm:justify-items-start max-sm:gap-[0.3125rem] max-sm:whitespace-normal">
                    <UBadge v-bind="stabilityDetails[item.stability]" variant="soft" />
                    <span class="text-sm">{{ item.averageChangePercent === null ? 'Limited comparable history' : `${changeLabel(item.averageChangePercent)} avg. · ${item.priceObservations} prices` }}</span>
                  </div>
                </td>
                <td data-label="Trend">
                  <svg v-if="item.priceSeries.length > 1" class="core-sparkline block h-6 w-full max-w-30 min-w-20" viewBox="0 0 120 32" role="img" :aria-label="`${item.name} regular price trend`">
                    <polyline :points="sparklinePoints(item.priceSeries)" />
                  </svg>
                  <span v-else class="text-(--muted)">—</span>
                </td>
                <td data-label="Net change" class="max-sm:justify-items-start">
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
        <p v-else class="m-[1.125rem_0_0.25rem] text-sm text-(--muted)">Not enough repeat purchases in this period yet.</p>
      </UCard>

      <UCard class="highlight-panel mb-5 rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]" aria-labelledby="shrinkflation-heading">
        <div class="core-items-heading mb-0 flex items-start justify-between gap-5 pb-3">
          <div>
            <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Package changes</p>
            <h2 id="shrinkflation-heading">Possible shrinkflation</h2>
            <p>Smaller packaged goods whose shelf price stayed the same or increased. Variable-weight and per-item purchases are excluded.</p>
          </div>
        </div>
        <div v-if="data.shrinkflation.length" class="overflow-x-auto max-sm:overflow-visible">
          <table :class="[dataTable, 'table-fixed max-sm:[&_tr]:grid-cols-2']">
            <caption class="sr-only">Packages that shrank, with shelf price and unit-cost impact; sortable by column</caption>
            <thead>
              <tr>
                <th scope="col" class="w-[26%]" :aria-sort="shrinkflationAriaSort('item')"><UButton class="-mx-2.25 -my-1.5 min-h-[2.125rem] font-bold tracking-[0.08em] text-inherit uppercase hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" label="Item" :icon="shrinkflationSortIcon('item')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('item')" /></th>
                <th scope="col" class="w-[22%]" :aria-sort="shrinkflationAriaSort('package')"><UButton class="-mx-2.25 -my-1.5 min-h-[2.125rem] font-bold tracking-[0.08em] text-inherit uppercase hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" label="Package change" :icon="shrinkflationSortIcon('package')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('package')" /></th>
                <th scope="col" class="w-[16%]" :aria-sort="shrinkflationAriaSort('price')"><UButton class="-mx-2.25 -my-1.5 min-h-[2.125rem] font-bold tracking-[0.08em] text-inherit uppercase hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" label="Shelf price" :icon="shrinkflationSortIcon('price')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('price')" /></th>
                <th scope="col" class="w-[36%]" :aria-sort="shrinkflationAriaSort('impact')"><UButton class="-mx-2.25 -my-1.5 min-h-[2.125rem] font-bold tracking-[0.08em] text-inherit uppercase hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" label="Unit-cost impact" :icon="shrinkflationSortIcon('impact')" color="neutral" variant="ghost" size="xs" @click="setShrinkflationSort('impact')" /></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in sortedShrinkflation" :key="`${entry.item}-${entry.purchasedOn}`">
                <td data-label="Item"><NuxtLink :to="itemPath(entry.item)" class="item-history-link inline-flex max-w-full items-center gap-[0.4375rem] text-inherit no-underline"><strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" /></NuxtLink><span class="mt-[0.1875rem] block text-sm text-muted">{{ shortDate(entry.previousPurchasedOn) }} → {{ shortDate(entry.purchasedOn) }}</span></td>
                <td data-label="Package change"><strong>{{ entry.previousSize }} → {{ entry.size }} {{ entry.unit }}</strong><span class="mt-[0.1875rem] block text-sm text-muted">{{ changeLabel(entry.sizeChangePercent) }}</span></td>
                <td data-label="Shelf price"><strong>{{ formatCurrency(entry.previousPrice) }} → {{ formatCurrency(entry.price) }}</strong></td>
                <td data-label="Unit-cost impact">
                  <div class="shrinkflation-impact flex items-center justify-end gap-2 whitespace-nowrap max-sm:grid max-sm:justify-items-start max-sm:whitespace-normal">
                    <strong>{{ unitCurrency(entry.previousUnitPrice) }} → {{ unitCurrency(entry.unitPrice) }}</strong>
                    <span>{{ entry.unitPriceLabel }}</span>
                    <UBadge :label="wholeChangeLabel(entry.unitCostChangePercent)" color="error" variant="soft" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="m-[1.125rem_0_0.25rem] text-sm text-(--muted)">No smaller same-price packages found in this period.</p>
      </UCard>

      <div class="grid grid-cols-[minmax(26.25rem,1.15fr)_minmax(21.25rem,.85fr)] items-start gap-5 max-[56.25rem]:grid-cols-1">
        <UCard class="highlight-panel movers-panel rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]" aria-labelledby="movers-heading">
            <div class="mb-2 flex items-end justify-between gap-5 pb-5">
              <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Since last purchase</p><h2 id="movers-heading">Recent movers</h2></div>
            </div>
            <div v-if="data.movers.length" class="overflow-x-auto max-sm:overflow-visible">
              <table :class="[dataTable, 'table-fixed max-sm:[&_tr]:grid-cols-[1fr_auto]']">
                <caption class="sr-only">Items whose price changed since the previous purchase</caption>
                <thead><tr><th scope="col" class="w-[40%]">Item</th><th scope="col" class="w-[40%]">Comparison</th><th scope="col" class="w-[20%]">Change</th></tr></thead>
                <tbody>
                  <tr v-for="entry in data.movers" :key="entry.id">
                    <td data-label="Item">
                  <NuxtLink :to="itemPath(entry.item)" class="item-history-link inline-flex max-w-full items-center gap-[0.4375rem] text-inherit no-underline" :aria-label="`View normalized price history for ${entry.item}`">
                    <strong class="truncate">{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                    </td>
                    <td data-label="Comparison" class="grid gap-[0.125rem] overflow-hidden max-sm:overflow-visible">
                      <strong class="truncate text-sm text-(--ink) max-sm:overflow-visible max-sm:text-clip max-sm:whitespace-normal">{{ shortDate(entry.previousPurchasedOn) }} → {{ shortDate(entry.purchasedOn) }}</strong>
                      <span class="truncate text-sm text-(--muted) max-sm:overflow-visible max-sm:text-clip max-sm:whitespace-normal">{{ entry.previousLocation }} → {{ entry.location }}</span>
                    </td>
                    <td data-label="Change" class="max-sm:justify-items-end">
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
            <p v-else class="m-[1.125rem_0_0.25rem] text-sm text-(--muted)">No significant price changes in this period.</p>
        </UCard>

        <UCard class="highlight-panel rounded-card shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
            <div class="mb-2 flex items-end justify-between gap-5 pb-5">
              <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Highest spending</p><h2>Top stores</h2></div>
              <UButton to="/data/stores" label="Manage stores" icon="i-lucide-settings-2" color="neutral" variant="outline" size="sm" />
            </div>
            <ul v-if="data.topStores.length" class="store-rank-list m-0 grid list-none gap-[0.5625rem] p-0">
              <li v-for="store in data.topStores" :key="store.name" class="grid grid-cols-[minmax(6.5625rem,_.7fr)_1fr] gap-[0.875rem] items-end">
                <strong class="store-name-label min-w-0 truncate block" :title="store.name">{{ store.name }}</strong>
                <div class="grid min-w-0 gap-[0.1875rem]">
                  <span class="store-spend-value text-right text-xs leading-none whitespace-nowrap text-(--muted) tabular-nums block" :style="{ width: `${(store.totalSpent / maxStoreSpend) * 100}%` }">{{ formatCurrency(store.totalSpent, { whole: true }) }}</span>
                  <span class="store-bar h-2 overflow-hidden rounded-full [background:var(--surface-muted)] block"><i :style="{ width: `${(store.totalSpent / maxStoreSpend) * 100}%` }" class="block h-full rounded-[inherit] bg-(--chart-series)" /></span>
                </div>
              </li>
            </ul>
            <p v-else class="m-[1.125rem_0_0.25rem] text-sm text-(--muted)">No store activity in this period.</p>
        </UCard>

      </div>
    </template>
  </div>
</template>
