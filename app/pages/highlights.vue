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
  priceChangePercent: string
  comparisonBasis: 'normalized' | 'package'
}

type Highlights = {
  availableYears: number[]
  reportingPeriod: { startDate: string, endDate: string } | null
  summary: { entries: number, receipts: number, items: number, saleEntries: number, stores: number, firstDate: string | null, lastDate: string | null }
  recent: HighlightEntry[]
  movers: PriceMover[]
  topStores: { name: string, totalSpent: number, lastUsed: string }[]
  topSaleItems: { name: string, sales: number, lastSale: string }[]
  monthlySpend: { month: string, totalSpent: number }[]
}

const { apiUrl } = useApi()
const selectedPeriod = ref('12m')
const periodQuery = computed(() => ({ period: selectedPeriod.value }))
const { data, pending, error, refresh } = await useFetch<Highlights>(apiUrl('/highlights'), { query: periodQuery })
const periodOptions = computed(() => [
  { label: 'All time', value: 'all' },
  { label: 'Current month', value: 'current-month' },
  { label: 'Past 12 months', value: '12m' },
  ...(data.value?.availableYears || []).map(year => ({ label: String(year), value: String(year) }))
])
const maxStoreSpend = computed(() => Math.max(1, ...(data.value?.topStores.map(store => store.totalSpent) || [])))
const selectedSpendMonth = ref<string | null>(null)

watch(selectedPeriod, () => {
  selectedSpendMonth.value = null
})

function currency(value: string | number | null) {
  return value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value))
}

function wholeCurrency(value: string | number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(Number(value))
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

const monthlySpendChart = computed(() => {
  const months = data.value?.monthlySpend || []
  if (!months.length) return null

  const width = Math.max(720, months.length * 38 + 94)
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
  const barWidth = Math.max(8, Math.min(28, slotWidth * 0.64))
  const labelEvery = months.length <= 18 ? 1 : months.length <= 48 ? 3 : months.length <= 96 ? 6 : 12
  const bars = months.map((month, index) => {
    const x = plot.left + slotWidth * index + slotWidth / 2
    const y = plot.top + ((max - month.totalSpent) / max) * plotHeight
    return {
      ...month,
      x,
      y,
      height: plot.top + plotHeight - y,
      barWidth,
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
</script>

<template>
  <div class="content-page highlights-page">
    <header class="page-heading highlights-heading">
      <div>
        <p class="eyebrow">At a glance</p>
        <h1>Price highlights</h1>
        <p>Recent activity, notable price movement, and the shape of your pricebook.</p>
      </div>
      <div class="highlights-actions">
        <UFormField label="Period" class="period-field">
          <USelect v-model="selectedPeriod" class="touch-target" :items="periodOptions" icon="i-lucide-calendar-range" aria-label="Highlight period" />
        </UFormField>
        <UButton class="touch-target" to="/" label="Add receipt" icon="i-lucide-plus" />
      </div>
    </header>

    <div v-if="pending" class="empty-state">Loading highlights…</div>
    <div v-else-if="error" class="empty-state error-state">
      <strong>Could not load highlights</strong>
      <UButton type="button" label="Try again" color="neutral" variant="outline" @click="refresh()" />
    </div>
    <template v-else-if="data">
      <section class="highlight-stats" aria-label="Pricebook summary">
        <UCard class="stat-card"><UIcon name="i-lucide-receipt-text" /><strong>{{ data.summary.receipts.toLocaleString() }}</strong><span>receipts</span></UCard>
        <UCard class="stat-card"><UIcon name="i-lucide-shopping-basket" /><strong>{{ data.summary.items.toLocaleString() }}</strong><span>unique items</span></UCard>
        <UCard class="stat-card"><UIcon name="i-lucide-store" /><strong>{{ data.summary.stores.toLocaleString() }}</strong><span>stores</span></UCard>
        <UCard class="stat-card"><UIcon name="i-lucide-tags" /><strong>{{ data.summary.saleEntries.toLocaleString() }}</strong><span>sale purchases</span></UCard>
      </section>

      <p class="coverage-line">
        {{ coverageText }}
      </p>

      <UCard class="monthly-spend-panel highlight-panel">
        <div class="monthly-spend-heading">
          <div><p class="eyebrow">Monthly spending</p><h2>Purchases by month</h2></div>
          <div class="monthly-spend-total"><strong>{{ wholeCurrency(monthlySpendTotal) }}</strong><span>in selected period</span></div>
        </div>
        <div v-if="monthlySpendChart" class="monthly-spend-scroll">
          <svg
            :viewBox="`0 0 ${monthlySpendChart.width} ${monthlySpendChart.height}`"
            :style="{ minWidth: `${monthlySpendChart.width}px` }"
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
                  :x="bar.x - Math.max(bar.barWidth, 28) / 2"
                  :y="monthlySpendChart.plot.top"
                  :width="Math.max(bar.barWidth, 28)"
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

      <div class="highlights-grid">
        <UCard class="recent-panel highlight-panel" aria-labelledby="recent-heading">
          <div class="section-heading">
            <div><p class="eyebrow">Latest activity</p><h2 id="recent-heading">Recent prices</h2></div>
            <UButton to="/history" label="View history" trailing-icon="i-lucide-arrow-right" color="neutral" variant="ghost" size="sm" />
          </div>
          <ol v-if="data.recent.length" class="recent-list">
            <li v-for="entry in data.recent" :key="entry.id">
              <div class="item-avatar" aria-hidden="true">{{ entry.item.charAt(0).toUpperCase() }}</div>
              <div class="recent-copy">
                <NuxtLink :to="itemPath(entry.item)" class="item-history-link" :aria-label="`View normalized price history for ${entry.item}`">
                  <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                </NuxtLink>
                <span class="recent-meta">{{ entry.location }} · {{ entry.size ? `${Number(entry.size)} ${entry.unit || ''}` : entry.unit || 'No size' }}</span>
              </div>
              <div class="recent-price">
                <strong>{{ currency(entry.price) }}</strong>
                <span class="recent-date">{{ shortDate(entry.purchasedOn) }}</span>
                <UBadge v-if="entry.saleItem" class="sale-badge" label="Sale" icon="i-lucide-tag" color="warning" variant="soft" size="sm" />
              </div>
            </li>
          </ol>
          <p v-else class="panel-empty">No purchases in this period.</p>
        </UCard>

        <UCard class="highlight-panel movers-panel">
            <div class="section-heading">
              <div><p class="eyebrow">Since last purchase</p><h2>Recent movers</h2></div>
            </div>
            <ul v-if="data.movers.length" class="mover-list">
              <li v-for="entry in data.movers" :key="entry.id">
                <div>
                  <NuxtLink :to="itemPath(entry.item)" class="item-history-link" :aria-label="`View normalized price history for ${entry.item}`">
                    <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                  <span>{{ entry.location }} · {{ shortDate(entry.purchasedOn) }}</span>
                </div>
                <UBadge
                  :label="percentage(entry.priceChangePercent)"
                  :icon="Number(entry.priceChangePercent) > 0 ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                  :color="Number(entry.priceChangePercent) > 0 ? 'error' : 'success'"
                  variant="soft"
                  size="lg"
                  :title="`Compared with the ${entry.comparisonBasis} price on ${shortDate(entry.previousPurchasedOn)}`"
                />
              </li>
            </ul>
            <p v-else class="panel-empty">No significant price changes in this period.</p>
        </UCard>

        <UCard class="highlight-panel stores-panel">
            <div class="section-heading">
              <div><p class="eyebrow">Highest spending</p><h2>Top stores</h2></div>
              <UButton to="/data" label="Manage stores" icon="i-lucide-settings-2" color="neutral" variant="outline" size="sm" />
            </div>
            <ul v-if="data.topStores.length" class="store-rank-list">
              <li v-for="store in data.topStores" :key="store.name">
                <div><strong>{{ store.name }}</strong><span>{{ wholeCurrency(store.totalSpent) }} spent</span></div>
                <span class="store-bar"><i :style="{ width: `${(store.totalSpent / maxStoreSpend) * 100}%` }" /></span>
              </li>
            </ul>
            <p v-else class="panel-empty">No store activity in this period.</p>
        </UCard>

        <UCard class="highlight-panel sale-items-panel">
            <div class="section-heading">
              <div><p class="eyebrow">Sale frequency</p><h2>Frequent sale items</h2></div>
            </div>
            <ol v-if="data.topSaleItems.length" class="sale-rank-list">
              <li v-for="(item, index) in data.topSaleItems" :key="item.name">
                <span class="sale-rank" aria-hidden="true">{{ index + 1 }}</span>
                <div>
                  <NuxtLink :to="itemPath(item.name)" class="item-history-link" :aria-label="`View normalized price history for ${item.name}`">
                    <strong>{{ item.name }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                  <span>Last on sale {{ shortDate(item.lastSale) }}</span>
                </div>
                <UBadge :label="`${item.sales} ${item.sales === 1 ? 'sale' : 'sales'}`" icon="i-lucide-tag" color="warning" variant="soft" />
              </li>
            </ol>
            <p v-else class="panel-empty">No sale purchases in this period.</p>
        </UCard>
      </div>
    </template>
  </div>
</template>
