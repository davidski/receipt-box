<script setup lang="ts">
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
  }[]
  monthlySpend: { month: string, totalSpent: number }[]
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
</script>

<template>
  <div class="content-page highlights-page">
    <header class="page-heading highlights-heading">
      <div>
        <p class="eyebrow">At a glance</p>
        <h1>Price highlights</h1>
        <p>Recent activity and notable price movement.</p>
      </div>
      <div class="highlights-actions">
        <UFormField label="Period" class="period-field">
          <USelect v-model="selectedPeriod" class="touch-target" :items="periodOptions" icon="i-lucide-calendar-range" aria-label="Highlight period" />
        </UFormField>
      </div>
    </header>

    <div v-if="pending" class="empty-state">Loading highlights…</div>
    <div v-else-if="error" class="empty-state error-state">
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

      <UCard class="monthly-spend-panel highlight-panel">
        <div class="monthly-spend-heading">
          <div><p class="eyebrow">Monthly spending</p><h2>Purchases by month</h2></div>
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
        <div v-if="selectedMonthlySpend" class="monthly-spend-detail" aria-live="polite">
          <strong>{{ monthLabel(selectedMonthlySpend.month) }}</strong>
          <span>{{ wholeCurrency(selectedMonthlySpend.totalSpent) }} spent</span>
        </div>
      </UCard>

      <UCard class="core-items-panel highlight-panel" aria-labelledby="core-items-heading">
        <div class="section-heading core-items-heading">
          <div>
            <p class="eyebrow">Regular purchases</p>
            <h2 id="core-items-heading">Core item price stability</h2>
            <p>Items bought on 3+ receipts across 2+ months; velocity compares non-sale prices.</p>
          </div>
        </div>
        <div v-if="data.coreItems.length" class="core-items-table-wrap">
          <table class="core-items-table">
            <thead>
              <tr><th>Item</th><th>Regularity</th><th>Price behavior</th><th>Net change</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in data.coreItems" :key="item.name">
                <td data-label="Item">
                  <NuxtLink :to="itemPath(item.name)" class="item-history-link" :aria-label="`View normalized price history for ${item.name}`" :title="`Last bought ${shortDate(item.lastPurchasedOn)}`">
                    <strong>{{ item.name }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                </td>
                <td data-label="Regularity"><div class="core-item-inline"><strong>{{ item.purchases }} receipts</strong><span>{{ cadenceLabel(item.averageDaysBetween) }} · {{ item.activeMonths }} mo.</span></div></td>
                <td data-label="Price behavior">
                  <div class="core-item-inline">
                    <UBadge v-bind="stabilityDetails[item.stability]" variant="soft" />
                    <span>{{ item.averageChangePercent === null ? 'Limited comparable history' : `${changeLabel(item.averageChangePercent)} avg. · ${item.priceObservations} prices` }}</span>
                  </div>
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

      <div class="highlights-grid">
        <UCard class="highlight-panel movers-panel" aria-labelledby="movers-heading">
            <div class="section-heading">
              <div><p class="eyebrow">Since last purchase</p><h2 id="movers-heading">Recent movers</h2></div>
            </div>
            <div v-if="data.movers.length" class="movers-table-wrap">
              <table class="movers-table">
                <thead><tr><th>Item</th><th>Comparison</th><th>Change</th></tr></thead>
                <tbody>
                  <tr v-for="entry in data.movers" :key="entry.id">
                    <td data-label="Item">
                  <NuxtLink :to="itemPath(entry.item)" class="item-history-link" :aria-label="`View normalized price history for ${entry.item}`">
                    <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                    </td>
                    <td data-label="Comparison" class="mover-context">
                      <strong class="mover-dates">{{ shortDate(entry.previousPurchasedOn) }} → {{ shortDate(entry.purchasedOn) }}</strong>
                      <span class="mover-stores">{{ entry.previousLocation }} → {{ entry.location }}</span>
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
            <div class="section-heading">
              <div><p class="eyebrow">Highest spending</p><h2>Top stores</h2></div>
              <UButton to="/data" label="Manage stores" icon="i-lucide-settings-2" color="neutral" variant="outline" size="sm" />
            </div>
            <ul v-if="data.topStores.length" class="store-rank-list">
              <li v-for="store in data.topStores" :key="store.name">
                <strong>{{ store.name }}</strong>
                <div class="store-spend-visual">
                  <span class="store-spend-value" :style="{ width: `${(store.totalSpent / maxStoreSpend) * 100}%` }">{{ wholeCurrency(store.totalSpent) }}</span>
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
