<script setup lang="ts">
import { normalizedHistoricalPrice } from '../../../shared/utils/normalized-price'
import { prettyScale } from '../../../shared/utils/chart-scale'
import { formatCurrency } from '../../../shared/utils/money'

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
const tdBase = 'border-t border-line px-3 py-3.25 max-sm:border-0 max-sm:p-0'
const tdData = `${tdBase} max-sm:grid max-sm:gap-0.75 max-sm:before:content-[attr(data-label)] max-sm:before:label`

function updateChartWidth() {
  const available = document.querySelector<HTMLElement>('.price-chart-scroll')?.clientWidth
  // No upper cap: the viewBox must match the rendered width so one chart unit is one CSS pixel (design doc, Units).
  chartWidth.value = Math.max(300, available || window.innerWidth - 64)
}

onMounted(() => {
  nextTick(updateChartWidth)
  window.addEventListener('resize', updateChartWidth)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateChartWidth)
})

useEscapeDismiss(() => { selectedPoint.value = null })

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

// Entries with no size, unit or stored cost have no normalized price, so the table skips them; they still need a way to edit.
const unpriced = computed(() => {
  const priced = new Set(pricePoints.value.map(point => point.id))
  return (data.value?.entries || []).filter(entry => !priced.has(entry.id)).reverse()
})

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
  const { min, max, breaks } = prettyScale(rawMin, rawMax)
  const firstTime = Math.min(...timestamps)
  const lastTime = Math.max(...timestamps)
  const xRange = width - plot.left - plot.right
  const yRange = height - plot.top - plot.bottom
  const positioned = points.map((point, index) => ({
    ...point,
    x: firstTime === lastTime ? plot.left + xRange / 2 : plot.left + ((timestamps[index]! - firstTime) / (lastTime - firstTime)) * xRange,
    y: plot.top + ((max - point.normalizedPrice) / (max - min)) * yRange
  }))
  const ticks = breaks.map(value => ({ value, y: plot.top + ((max - value) / (max - min)) * yRange }))
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

function dateLabel(value: string) {
  const date = parseCalendarDate(value)
  return date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : value
}

function packageLabel(entry: HistoryEntry) {
  return entry.size ? `${Number(entry.size)} ${entry.unit || ''}`.trim() : entry.unit || 'No size'
}
</script>

<template>
  <div class="mx-auto w-full max-w-300">
    <header class="page-heading my-[0.9375rem] mb-8 flex items-end justify-between gap-6 max-sm:grid max-sm:items-start">
      <div>
        <h1 class="leading-[1.04] text-display">{{ data?.item || routeItem }}</h1>
        <p v-if="data">{{ data.entries.length.toLocaleString() }} recorded {{ data.entries.length === 1 ? 'purchase' : 'purchases' }}</p>
      </div>
      <UButton to="/history/receipts/calendar" label="Back to history" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
    </header>

    <div v-if="pending" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Loading item history…</div>
    <div v-else-if="error" class="error-state grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">
      <strong>Could not load this item’s history</strong>
      <UButton type="button" label="Try again" color="neutral" variant="outline" @click="refresh()" />
    </div>
    <template v-else-if="data">
      <div v-if="series.length > 1" class="series-picker m-[-0.75rem_0_1.125rem] flex flex-wrap items-center gap-1.5 rounded-card border border-line bg-surface p-2" aria-label="Normalized price basis">
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

      <!-- The latest price leads unboxed, with its range, so the page opens on the number the price line ends at (#26). -->
      <section v-if="summary" class="mb-6 grid gap-2" aria-label="Latest price">
        <p data-latest-price class="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <strong class="font-display text-hero font-extrabold"><MoneyAmount :value="summary.latest.normalizedPrice" /></strong>
          <span class="text-title text-muted">{{ summary.latest.basisLabel.toLowerCase() }}</span>
        </p>
        <p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          <span>{{ dateLabel(summary.latest.purchasedOn) }} at {{ summary.latest.location }}</span>
          <SaleMark v-if="summary.latest.saleItem" />
        </p>
        <p data-price-range class="m-0 text-title">
          Ranged from <strong><MoneyAmount :value="summary.low" /></strong> to <strong><MoneyAmount :value="summary.high" /></strong> over {{ chartPoints.length }} charted {{ chartPoints.length === 1 ? 'purchase' : 'purchases' }}.
        </p>
      </section>

      <UAlert
        v-if="excludedOutliers"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :description="`${excludedOutliers} unusually high normalized ${excludedOutliers === 1 ? 'value is' : 'values are'} excluded from the chart scale but retained in the purchase table for review.`"
        class="m-[0_0_1.125rem]"
      />

      <section v-if="chart" class="mt-[1.125rem] border-t border-line pt-6">
        <div class="mb-4.5 flex items-end justify-between gap-4.5">
          <div><h2 class="text-heading">{{ visiblePoints[0]?.basisLabel }}</h2></div>
          <div class="flex gap-3.5 text-xs text-muted"><span class="inline-flex items-center gap-[0.375rem]"><i class="size-2.5 rounded-full bg-chart-series" />Regular</span><span class="inline-flex items-center gap-[0.375rem]"><i class="size-2 rotate-45 bg-sale-mark" />Sale</span></div>
        </div>
        <div v-if="chartPoints.length < 2" class="grid min-h-[8.125rem] place-items-center text-center text-muted">Add another comparable purchase to draw a trend line.</div>
        <div v-else class="price-chart-scroll min-w-0 overflow-hidden">
          <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${data.item} normalized price chart, ${visiblePoints[0]?.basisLabel}`" class="block w-full h-[18.75rem]">
            <g>
              <g v-for="tick in chart.ticks" :key="tick.y">
                <line class="stroke-line" :x1="chart.plot.left" :x2="chart.width - chart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text class="fill-muted font-sans text-xs" :x="chart.plot.left - 12" :y="tick.y + 4" text-anchor="end">{{ formatCurrency(tick.value) }}</text>
              </g>
            </g>
            <g>
              <g v-for="tick in chart.xTicks" :key="tick.time">
                <line class="[stroke-dasharray:3_5] [stroke:color-mix(in_srgb,var(--line),transparent_42%)]" :x1="tick.x" :x2="tick.x" :y1="chart.plot.top" :y2="chart.height - chart.plot.bottom" />
                <text class="fill-muted font-sans text-xs" :x="tick.x" :y="chart.height - 11" :text-anchor="tick.anchor">{{ tick.label }}</text>
              </g>
            </g>
            <polyline class="fill-none stroke-(--chart-series) stroke-2 [stroke-linecap:round] [stroke-linejoin:round]" :points="chart.line" />
            <g
              v-for="point in chart.positioned"
              :key="point.id"
              class="group/point focus:outline-none!"
              role="button"
              tabindex="0"
              :aria-label="`${dateLabel(point.purchasedOn)}, ${formatCurrency(point.normalizedPrice)}, ${point.location}${point.saleItem ? ', sale' : ''}`"
              @click="selectedPoint = point"
              @pointerenter="selectedPoint = point"
              @focus="selectedPoint = point"
              @keydown.enter.prevent="selectedPoint = point"
              @keydown.space.prevent="selectedPoint = point"
            >
              <circle class="cursor-pointer fill-transparent group-focus-visible/point:stroke-3 group-focus-visible/point:stroke-(--focus-ring)" :cx="point.x" :cy="point.y" r="16" />
              <!-- Sale prices are diamonds as well as gold, so the encoding never relies on color alone. -->
              <path v-if="point.saleItem" class="fill-sale-mark stroke-surface stroke-2" :d="`M ${point.x} ${point.y - 7} L ${point.x + 7} ${point.y} L ${point.x} ${point.y + 7} L ${point.x - 7} ${point.y} Z`" />
              <circle v-else class="fill-chart-series stroke-surface stroke-2" :cx="point.x" :cy="point.y" r="6" />
            </g>
          </svg>
        </div>
        <div v-if="selectedPoint" class="mt-2 flex min-h-12 flex-wrap items-center gap-[0.4375rem_0.875rem] rounded-card border border-line bg-surface-muted p-[0.625rem_0.8125rem] text-sm" aria-live="polite">
          <strong>{{ formatCurrency(selectedPoint.normalizedPrice) }}</strong>
          <span class="text-muted">{{ dateLabel(selectedPoint.purchasedOn) }}</span>
          <span class="text-muted">{{ selectedPoint.location }}</span>
          <SaleMark v-if="selectedPoint.saleItem" />
        </div>
      </section>

      <section class="mt-10 border-t border-line pt-6">
        <div class="mb-2 flex items-end justify-between gap-5 pb-5"><div><h2 class="text-heading">Comparable history</h2></div></div>
        <div v-if="!newestFirst.length" class="grid min-h-[8.125rem] place-items-center text-center text-muted">No entries have enough information to calculate a normalized price.</div>
        <div v-else class="max-sm:[overflow:visible]">
          <table class="w-full border-collapse text-base max-sm:grid max-sm:gap-2.5">
            <caption class="sr-only">Purchases of {{ data.item }}, newest first, with package, price, and normalized price</caption>
            <thead class="max-sm:hidden">
              <tr>
                <th scope="col" class="label px-3 py-2.5 text-left">Date</th>
                <th scope="col" class="label px-3 py-2.5 text-left">Store</th>
                <th scope="col" class="label px-3 py-2.5 text-left">Package</th>
                <th scope="col" class="label px-3 py-2.5 text-right">Price</th>
                <th scope="col" class="label px-3 py-2.5 text-right">Normalized</th>
                <th scope="col" class="px-3 py-2.5"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody class="max-sm:grid max-sm:gap-2.5">
              <tr v-for="point in newestFirst" :key="point.id" class="max-sm:grid max-sm:grid-cols-2 max-sm:gap-2.5 max-sm:rounded-card max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-3.5">
                <td data-label="Date" :class="tdData">{{ dateLabel(point.purchasedOn) }} <SaleMark v-if="point.saleItem" /></td>
                <td data-label="Store" :class="tdData">{{ point.location }}</td>
                <td data-label="Package" :class="tdData">{{ packageLabel(point) }}</td>
                <td data-label="Price" :class="[tdData, 'text-right max-sm:text-left']">{{ formatCurrency(point.price) }}</td>
                <td data-label="Normalized" :class="[tdData, 'text-right max-sm:text-left']"><strong>{{ formatCurrency(point.normalizedPrice) }}</strong> <span class="mt-0.5 block text-sm text-muted">{{ point.basisLabel }}</span></td>
                <td :class="[tdBase, 'w-[1%] text-right whitespace-nowrap max-sm:col-span-full max-sm:block max-sm:w-full']">
                  <UButton
                    :to="{ path: '/history/entries', query: { edit: point.id } }"
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
      </section>

      <section v-if="unpriced.length" class="mt-10 border-t border-line pt-6" aria-labelledby="unpriced-heading">
        <h2 id="unpriced-heading" class="text-heading">Missing a package size</h2>
        <p class="mb-2 text-muted">These purchases have no usable size and unit, so they are left out of the comparison. Edit one to add them.</p>
        <ul class="m-0 list-none p-0">
          <li v-for="entry in unpriced" :key="entry.id" class="flex flex-wrap items-center justify-between gap-x-3 border-t border-line py-2">
            <span>{{ dateLabel(entry.purchasedOn) }} · {{ entry.location }} · <span class="tabular-nums">{{ formatCurrency(entry.price) }}</span> · {{ packageLabel(entry) }}</span>
            <UButton
              :to="{ path: '/history/entries', query: { edit: entry.id } }"
              label="Edit"
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="sm"
              class="touch-target"
              :aria-label="`Edit ${dateLabel(entry.purchasedOn)} purchase at ${entry.location}`"
            />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
