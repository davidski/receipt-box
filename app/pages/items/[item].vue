<script setup lang="ts">
import { normalizedHistoricalPrice } from '../../../shared/utils/normalized-price'

type HistoryEntry = {
  id: string
  purchasedOn: string
  item: string
  location: string
  size: string | null
  unit: string | null
  price: string
  costPerUnit: string | null
  saleItem: boolean
}

type ItemHistory = { item: string, entries: HistoryEntry[] }
type PricePoint = HistoryEntry & { basis: string, basisLabel: string, normalizedPrice: number }

const route = useRoute()
const router = useRouter()
const { apiUrl } = useApi()
const routeItem = computed(() => String(route.params.item ?? ''))
const { data, pending, error, refresh } = await useFetch<ItemHistory>(apiUrl('/items/history'), {
  query: computed(() => ({ item: routeItem.value, slug: routeItem.value }))
})
const selectedBasis = ref('')
const selectedPoint = ref<PricePoint | null>(null)
const chartWidth = ref(860)

function updateChartWidth() {
  const available = document.querySelector<HTMLElement>('.price-chart-scroll')?.clientWidth
  chartWidth.value = Math.max(300, Math.min(860, available || window.innerWidth - 64))
}

onMounted(() => {
  nextTick(updateChartWidth)
  window.addEventListener('resize', updateChartWidth)
})

onBeforeUnmount(() => window.removeEventListener('resize', updateChartWidth))

useHead(() => ({ title: data.value?.item ? `${data.value.item} price history` : 'Item price history' }))

watch(() => data.value?.item, (item) => {
  if (!item || route.path === itemPath(item)) return
  router.replace(itemPath(item))
}, { immediate: true })

const pricePoints = computed<PricePoint[]>(() => (data.value?.entries || []).flatMap((entry) => {
  const normalized = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
  return normalized ? [{ ...entry, basis: normalized.basis, basisLabel: normalized.label, normalizedPrice: normalized.value }] : []
}))

const series = computed(() => {
  const grouped = new Map<string, { value: string, label: string, count: number }>()
  for (const point of pricePoints.value) {
    const current = grouped.get(point.basis)
    grouped.set(point.basis, { value: point.basis, label: point.basisLabel, count: (current?.count || 0) + 1 })
  }
  return [...grouped.values()]
})

watch(series, (available) => {
  if (available.some(option => option.value === selectedBasis.value)) return
  const mostRecent = pricePoints.value.at(-1)?.basis
  selectedBasis.value = available.find(option => option.value === mostRecent)?.value || available[0]?.value || ''
}, { immediate: true })

watch(selectedBasis, () => { selectedPoint.value = null })

const visiblePoints = computed(() => pricePoints.value.filter(point => point.basis === selectedBasis.value))
const newestFirst = computed(() => [...visiblePoints.value].reverse())

const chartPoints = computed(() => {
  const points = visiblePoints.value
  if (points.length < 5) return points
  const values = points.map(point => point.normalizedPrice).sort((a, b) => a - b)
  const median = values[Math.floor(values.length / 2)] || 0
  const q1 = values[Math.floor(values.length * 0.25)] || 0
  const q3 = values[Math.floor(values.length * 0.75)] || 0
  const highLimit = Math.max(median * 5, q3 + (q3 - q1) * 6)
  return points.filter(point => point.normalizedPrice <= highLimit)
})

const excludedOutliers = computed(() => visiblePoints.value.length - chartPoints.value.length)

function dateTicks(firstTime: number, lastTime: number, width: number, plotLeft: number, plotRight: number) {
  const day = 24 * 60 * 60 * 1000
  if (firstTime === lastTime) {
    return [{
      time: firstTime,
      x: plotLeft + (width - plotLeft - plotRight) / 2,
      label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(firstTime)),
      anchor: 'middle'
    }]
  }
  const spanDays = Math.max(1, (lastTime - firstTime) / day)
  const target = width < 500 ? 3 : width < 760 ? 5 : 6
  const idealDays = spanDays / Math.max(1, target - 1)
  const dates: number[] = []

  if (idealDays <= 3) {
    const step = (idealDays <= 1.5 ? 1 : 2) * day
    for (let time = Math.ceil(firstTime / step) * step; time <= lastTime; time += step) dates.push(time)
  } else if (idealDays <= 21) {
    const step = 7 * day
    for (let time = Math.ceil(firstTime / step) * step; time <= lastTime; time += step) dates.push(time)
  } else {
    const monthStep = idealDays <= 50 ? 1 : idealDays <= 120 ? 3 : idealDays <= 300 ? 6 : 12
    const cursor = new Date(firstTime)
    cursor.setDate(1)
    cursor.setHours(0, 0, 0, 0)
    cursor.setMonth(Math.floor(cursor.getMonth() / monthStep) * monthStep)
    if (cursor.getTime() < firstTime) cursor.setMonth(cursor.getMonth() + monthStep)
    while (cursor.getTime() <= lastTime) {
      dates.push(cursor.getTime())
      cursor.setMonth(cursor.getMonth() + monthStep)
    }
  }

  if (dates.length < 2) dates.splice(0, dates.length, firstTime, lastTime)
  const xRange = width - plotLeft - plotRight
  return dates.map((time, index) => {
    const date = new Date(time)
    const x = firstTime === lastTime ? plotLeft + xRange / 2 : plotLeft + ((time - firstTime) / (lastTime - firstTime)) * xRange
    const showYear = spanDays > 330 && (index === 0 || date.getMonth() === 0)
    const label = spanDays <= 21
      ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
      : new Intl.DateTimeFormat(undefined, showYear ? { month: 'short', year: 'numeric' } : { month: 'short' }).format(date)
    return {
      time,
      x,
      label,
      anchor: x - plotLeft < 28 ? 'start' : width - plotRight - x < 28 ? 'end' : 'middle'
    }
  })
}

const chart = computed(() => {
  const points = chartPoints.value
  if (!points.length) return null
  const width = chartWidth.value
  const height = 300
  const plot = { left: 78, right: 24, top: 24, bottom: 46 }
  const values = points.map(point => point.normalizedPrice)
  const timestamps = points.map(point => parseCalendarDate(point.purchasedOn)?.getTime() || 0)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const padding = rawMin === rawMax ? Math.max(rawMax * 0.1, 0.05) : (rawMax - rawMin) * 0.12
  const min = Math.max(0, rawMin - padding)
  const max = rawMax + padding
  const firstTime = Math.min(...timestamps)
  const lastTime = Math.max(...timestamps)
  const xRange = width - plot.left - plot.right
  const yRange = height - plot.top - plot.bottom
  const positioned = points.map((point, index) => ({
    ...point,
    x: firstTime === lastTime ? plot.left + xRange / 2 : plot.left + ((timestamps[index]! - firstTime) / (lastTime - firstTime)) * xRange,
    y: plot.top + ((max - point.normalizedPrice) / (max - min)) * yRange
  }))
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max - ((max - min) * index) / 4
    return { value, y: plot.top + (yRange * index) / 4 }
  })
  const xTicks = dateTicks(firstTime, lastTime, width, plot.left, plot.right)
  return {
    width,
    height,
    plot,
    positioned,
    ticks,
    xTicks,
    line: positioned.map(point => `${point.x},${point.y}`).join(' '),
    firstDate: points[0]?.purchasedOn || '',
    lastDate: points.at(-1)?.purchasedOn || ''
  }
})

const summary = computed(() => {
  if (!chartPoints.value.length) return null
  const values = chartPoints.value.map(point => point.normalizedPrice)
  return {
    latest: chartPoints.value.at(-1)!,
    low: Math.min(...values),
    high: Math.max(...values)
  }
})

function currency(value: string | number | null) {
  return value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value))
}

function dateLabel(value: string) {
  const date = parseCalendarDate(value)
  return date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : value
}

function packageLabel(entry: HistoryEntry) {
  return entry.size ? `${Number(entry.size)} ${entry.unit || ''}`.trim() : entry.unit || 'No size'
}
</script>

<template>
  <div class="content-page item-history-page">
    <header class="page-heading item-history-heading">
      <div>
        <p class="eyebrow">Normalized price history</p>
        <h1>{{ data?.item || routeItem }}</h1>
        <p v-if="data">{{ data.entries.length.toLocaleString() }} recorded {{ data.entries.length === 1 ? 'purchase' : 'purchases' }}</p>
      </div>
      <UButton to="/history" label="Back to history" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
    </header>

    <div v-if="pending" class="empty-state">Loading item history…</div>
    <div v-else-if="error" class="empty-state error-state">
      <strong>Could not load this item’s history</strong>
      <UButton type="button" label="Try again" color="neutral" variant="outline" @click="refresh()" />
    </div>
    <template v-else-if="data">
      <div v-if="series.length > 1" class="series-picker" aria-label="Normalized price basis">
        <span>Compare by</span>
        <UButton
          v-for="option in series"
          :key="option.value"
          type="button"
          :label="`${option.label} (${option.count})`"
          :color="selectedBasis === option.value ? 'primary' : 'neutral'"
          :variant="selectedBasis === option.value ? 'soft' : 'ghost'"
          size="sm"
          @click="selectedBasis = option.value"
        />
      </div>

      <div v-if="summary" class="item-price-stats">
        <UCard><span>Latest normalized</span><strong>{{ currency(summary.latest.normalizedPrice) }}</strong><small>{{ summary.latest.basisLabel }}</small></UCard>
        <UCard><span>Historical low</span><strong>{{ currency(summary.low) }}</strong><small>{{ chartPoints.length }} charted purchases</small></UCard>
        <UCard><span>Historical high</span><strong>{{ currency(summary.high) }}</strong><small>{{ dateLabel(summary.latest.purchasedOn) }} latest</small></UCard>
      </div>

      <UAlert
        v-if="excludedOutliers"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :description="`${excludedOutliers} unusually high normalized ${excludedOutliers === 1 ? 'value is' : 'values are'} excluded from the chart scale but retained in the purchase table for review.`"
        class="outlier-notice"
      />

      <UCard v-if="chart" class="price-chart-card">
        <div class="chart-heading">
          <div><p class="eyebrow">Price trend</p><h2>{{ visiblePoints[0]?.basisLabel }}</h2></div>
          <div class="chart-legend"><span><i />Regular</span><span><i class="sale" />Sale</span></div>
        </div>
        <div v-if="chartPoints.length < 2" class="chart-empty">Add another comparable purchase to draw a trend line.</div>
        <div v-else class="price-chart-scroll">
          <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${data.item} normalized price chart, ${visiblePoints[0]?.basisLabel}`">
            <title>{{ data.item }} normalized price history</title>
            <g class="chart-grid">
              <g v-for="tick in chart.ticks" :key="tick.y">
                <line :x1="chart.plot.left" :x2="chart.width - chart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text :x="chart.plot.left - 12" :y="tick.y + 4" text-anchor="end">{{ currency(tick.value) }}</text>
              </g>
            </g>
            <g class="chart-date-ticks">
              <g v-for="tick in chart.xTicks" :key="tick.time">
                <line :x1="tick.x" :x2="tick.x" :y1="chart.plot.top" :y2="chart.height - chart.plot.bottom" />
                <text :x="tick.x" :y="chart.height - 11" :text-anchor="tick.anchor">{{ tick.label }}</text>
              </g>
            </g>
            <polyline class="price-chart-line" :points="chart.line" />
            <g
              v-for="point in chart.positioned"
              :key="point.id"
              class="price-chart-point-group"
              role="button"
              tabindex="0"
              :aria-label="`${dateLabel(point.purchasedOn)}, ${currency(point.normalizedPrice)}, ${point.location}${point.saleItem ? ', sale' : ''}`"
              @click="selectedPoint = point"
              @focus="selectedPoint = point"
              @keydown.enter.prevent="selectedPoint = point"
              @keydown.space.prevent="selectedPoint = point"
            >
              <circle class="price-chart-hit" :cx="point.x" :cy="point.y" r="16" />
              <circle :class="['price-chart-point', { sale: point.saleItem }]" :cx="point.x" :cy="point.y" r="5">
                <title>{{ dateLabel(point.purchasedOn) }} · {{ currency(point.normalizedPrice) }} · {{ point.location }}{{ point.saleItem ? ' · Sale' : '' }}</title>
              </circle>
            </g>
          </svg>
        </div>
        <div v-if="selectedPoint" class="chart-point-detail" aria-live="polite">
          <strong>{{ currency(selectedPoint.normalizedPrice) }}</strong>
          <span>{{ dateLabel(selectedPoint.purchasedOn) }}</span>
          <span>{{ selectedPoint.location }}</span>
          <UBadge v-if="selectedPoint.saleItem" label="Sale" icon="i-lucide-tag" color="warning" variant="soft" size="sm" />
        </div>
      </UCard>

      <UCard class="item-purchases-card">
        <div class="section-heading"><div><p class="eyebrow">Source purchases</p><h2>Comparable history</h2></div></div>
        <div v-if="!newestFirst.length" class="chart-empty">No entries have enough information to calculate a normalized price.</div>
        <div v-else class="item-purchases-table-wrap">
          <table class="item-purchases-table">
            <thead><tr><th>Date</th><th>Store</th><th>Package</th><th>Price</th><th>Normalized</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              <tr v-for="point in newestFirst" :key="point.id">
                <td data-label="Date">{{ dateLabel(point.purchasedOn) }} <UBadge v-if="point.saleItem" label="Sale" icon="i-lucide-tag" color="warning" variant="soft" size="sm" /></td>
                <td data-label="Store">{{ point.location }}</td>
                <td data-label="Package">{{ packageLabel(point) }}</td>
                <td data-label="Price">{{ currency(point.price) }}</td>
                <td data-label="Normalized"><strong>{{ currency(point.normalizedPrice) }}</strong> <span>{{ point.basisLabel }}</span></td>
                <td class="item-purchase-action">
                  <UButton
                    :to="{ path: '/history', query: { edit: point.id } }"
                    label="Edit"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="touch-target"
                    :aria-label="`Edit ${dateLabel(point.purchasedOn)} purchase at ${point.location}`"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>
  </div>
</template>
