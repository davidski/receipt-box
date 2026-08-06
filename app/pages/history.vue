<script setup lang="ts">
type Entry = {
  id: string
  purchasedOn: string
  item: string
  location: string
  size: string | null
  unit: string | null
  price: string
  costPerUnit: string | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
  previousPrice: string | null
  previousCostPerUnit: string | null
  previousPurchasedOn: string | null
  priceChangePercent: string | null
  comparisonBasis: 'normalized' | 'package' | null
}

type EntryList = { entries: Entry[], total: number }
type ReceiptEntry = Omit<Entry, 'previousPrice' | 'previousCostPerUnit' | 'previousPurchasedOn' | 'priceChangePercent' | 'comparisonBasis'>
type Receipt = { id: string, purchasedOn: string, location: string, total: string, itemCount: number, entries: ReceiptEntry[] }
type ReceiptList = { receipts: Receipt[], total: number }
type ReceiptDate = { date: string, receiptCount: number, itemCount: number }
type ReceiptDates = { dates: ReceiptDate[] }
type CalendarDay = ReceiptDate & { day: number, currentMonth: boolean }
type EditableEntry = Omit<Entry, 'unit'> & { unit: string }
type Store = { id: string, name: string, uses: number }
type SortKey = 'purchasedOn' | 'item' | 'location' | 'size' | 'price' | 'costPerUnit'
type ChangeFilter = 'all' | 'changed' | 'higher' | 'lower' | 'sale'

const allLocationsValue = '__all_locations__'
const search = ref('')
const { apiUrl } = useApi()
const route = useRoute()
const router = useRouter()
const view = ref<'receipts' | 'entries'>('receipts')
const location = ref(allLocationsValue)
const sortBy = ref<SortKey>('purchasedOn')
const sortDirection = ref<'asc' | 'desc'>('desc')
const changeFilter = ref<ChangeFilter>('all')
const changeFilters: { label: string, value: ChangeFilter, icon: string, activeColor: 'primary' | 'error' | 'success' }[] = [
  { label: 'All', value: 'all', icon: 'i-lucide-list', activeColor: 'primary' },
  { label: 'Price changed', value: 'changed', icon: 'i-lucide-arrow-left-right', activeColor: 'primary' },
  { label: 'Up 10%+', value: 'higher', icon: 'i-lucide-trending-up', activeColor: 'error' },
  { label: 'Down 10%+', value: 'lower', icon: 'i-lucide-trending-down', activeColor: 'success' },
  { label: 'On sale', value: 'sale', icon: 'i-lucide-tag', activeColor: 'primary' }
]
const offset = ref(0)
const limit = 50
const selectedDate = ref('')
const today = new Date()
const visibleMonth = ref(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)))
const query = computed(() => ({
  search: search.value,
  location: location.value === allLocationsValue ? '' : location.value,
  sortBy: sortBy.value,
  sortDirection: sortDirection.value,
  changeFilter: changeFilter.value,
  limit,
  offset: offset.value
}))
const { data, pending, error, refresh } = await useFetch<EntryList>(apiUrl('/entries'), { query })
const receiptQuery = computed(() => ({
  date: selectedDate.value,
  limit: 50
}))
const { data: receiptData, pending: receiptsPending, error: receiptsError, refresh: refreshReceipts } = await useFetch<ReceiptList>(apiUrl('/receipts'), { query: receiptQuery })
const { data: receiptDates, refresh: refreshReceiptDates } = await useFetch<ReceiptDates>(apiUrl('/receipts/dates'))
const { data: stores, refresh: refreshStores } = await useFetch<Store[]>(apiUrl('/stores'))
const editing = ref<EditableEntry | null>(null)
const editingReceipt = ref<Receipt | null>(null)
const editError = ref('')
const saving = ref(false)
const linkedEditError = ref('')

watch([search, location, changeFilter], () => {
  offset.value = 0
})

const receiptDateMap = computed(() => new Map((receiptDates.value?.dates || []).map(date => [date.date, date])))
const selectedReceiptDateIndex = computed(() => (receiptDates.value?.dates || []).findIndex(date => date.date === selectedDate.value))
const olderReceiptDate = computed(() => {
  const dates = receiptDates.value?.dates || []
  const index = selectedReceiptDateIndex.value
  return index >= 0 ? dates[index + 1] || null : null
})
const newerReceiptDate = computed(() => {
  const dates = receiptDates.value?.dates || []
  const index = selectedReceiptDateIndex.value
  return index > 0 ? dates[index - 1] || null : null
})
const calendarMonthOptions = computed(() => {
  const dates = receiptDates.value?.dates || []
  if (!dates.length) return []
  const newest = new Date(`${dates[0]!.date.slice(0, 7)}-01T00:00:00Z`)
  const oldest = new Date(`${dates.at(-1)!.date.slice(0, 7)}-01T00:00:00Z`)
  const options: { label: string, value: string }[] = []
  const cursor = new Date(oldest)
  while (cursor <= newest) {
    options.push({
      label: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(cursor),
      value: cursor.toISOString().slice(0, 7)
    })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return options
})
const selectedCalendarMonth = computed({
  get: () => visibleMonth.value.toISOString().slice(0, 7),
  set: (value: string) => { visibleMonth.value = new Date(`${value}-01T00:00:00Z`) }
})
const canMoveToPreviousMonth = computed(() => selectedCalendarMonth.value > (calendarMonthOptions.value[0]?.value || ''))
const canMoveToNextMonth = computed(() => selectedCalendarMonth.value < (calendarMonthOptions.value.at(-1)?.value || ''))
const calendarDays = computed<CalendarDay[]>(() => {
  const year = visibleMonth.value.getUTCFullYear()
  const month = visibleMonth.value.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1 - visibleMonth.value.getUTCDay()))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)
    return {
      date: key,
      day: date.getUTCDate(),
      currentMonth: date.getUTCMonth() === month,
      receiptCount: receiptDateMap.value.get(key)?.receiptCount ?? 0,
      itemCount: receiptDateMap.value.get(key)?.itemCount ?? 0
    }
  })
})
const calendarWeeks = computed(() => Array.from({ length: 6 }, (_, index) => calendarDays.value.slice(index * 7, index * 7 + 7)))

watch(receiptDates, (value) => {
  const dates = value?.dates || []
  if (!dates.length) {
    selectedDate.value = ''
    return
  }
  if (!dates.some(date => date.date === selectedDate.value)) selectedDate.value = dates[0]!.date
  const selected = new Date(`${selectedDate.value}T00:00:00Z`)
  visibleMonth.value = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1))
}, { immediate: true })

function moveCalendarMonth(amount: number) {
  visibleMonth.value = new Date(Date.UTC(visibleMonth.value.getUTCFullYear(), visibleMonth.value.getUTCMonth() + amount, 1))
}

function selectReceiptDateValue(value: string) {
  selectedDate.value = value
  const date = new Date(`${value}T00:00:00Z`)
  visibleMonth.value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function selectReceiptDate(day: CalendarDay) {
  if (day.receiptCount) selectReceiptDateValue(day.date)
}

function toggleSort(column: SortKey) {
  if (sortBy.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = column
    sortDirection.value = column === 'purchasedOn' ? 'desc' : 'asc'
  }
  offset.value = 0
}

function ariaSort(column: SortKey) {
  if (sortBy.value !== column) return 'none' as const
  return sortDirection.value === 'asc' ? 'ascending' as const : 'descending' as const
}

function clearSearch() {
  if (!search.value) return
  search.value = ''
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search-control input')?.focus())
}

function currency(value: string | number | null) {
  return value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value))
}

function packageSize(size: string | null, unit: string | null) {
  if (size === null) return unit || '—'
  const number = Number(size)
  const formatted = Number.isFinite(number)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(number)
    : size
  return `${formatted} ${unit || ''}`.trim()
}

function dateLabel(value: string) {
  const date = parseCalendarDate(value)
  return date
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
    : 'Unknown date'
}

function percentage(value: string | null) {
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number)}%`
}

function changeTitle(entry: Entry) {
  const basis = entry.comparisonBasis === 'normalized' ? 'normalized unit price' : 'package price'
  const date = entry.previousPurchasedOn ? dateLabel(entry.previousPurchasedOn) : 'the previous purchase'
  return `${percentage(entry.priceChangePercent)} versus the ${basis} on ${date}`
}

function startEdit(entry: Entry | ReceiptEntry) {
  editing.value = {
    ...entry,
    size: entry.size === null ? null : String(Number(entry.size)),
    unit: entry.unit || '',
    previousPrice: 'previousPrice' in entry ? entry.previousPrice : null,
    previousCostPerUnit: 'previousCostPerUnit' in entry ? entry.previousCostPerUnit : null,
    previousPurchasedOn: 'previousPurchasedOn' in entry ? entry.previousPurchasedOn : null,
    priceChangePercent: 'priceChangePercent' in entry ? entry.priceChangePercent : null,
    comparisonBasis: 'comparisonBasis' in entry ? entry.comparisonBasis : null
  }
  editError.value = ''
}

function startReceiptEdit(receipt: Receipt) {
  editingReceipt.value = receipt
}

function closeReceiptEdit() {
  editingReceipt.value = null
}

async function receiptChanged() {
  editingReceipt.value = null
  await Promise.all([refresh(), refreshReceiptDates(), refreshStores()])
  await refreshReceipts()
}

async function openLinkedEdit(value: unknown) {
  const id = Array.isArray(value) ? String(value[0] || '') : String(value || '')
  if (!/^\d+$/.test(id)) return
  linkedEditError.value = ''
  try {
    const entry = await $fetch<Entry>(apiUrl(`/entries/${id}`))
    startEdit(entry)
  } catch (error: any) {
    linkedEditError.value = error?.data?.statusMessage || error?.message || 'Could not open that purchase'
  }
}

async function closeEdit() {
  editing.value = null
  if (route.query.edit) {
    await router.replace({ query: { ...route.query, edit: undefined } })
  }
}

onMounted(() => openLinkedEdit(route.query.edit))
watch(() => route.query.edit, (value, previous) => {
  if (value !== previous && value) openLinkedEdit(value)
})

async function saveEdit() {
  if (!editing.value) return
  saving.value = true
  editError.value = ''
  try {
    await $fetch(apiUrl(`/entries/${editing.value.id}`), { method: 'PUT', body: editing.value })
    await closeEdit()
    await Promise.all([refresh(), refreshReceipts(), refreshReceiptDates(), refreshStores()])
  } catch (error: any) {
    editError.value = error?.data?.statusMessage || error?.message || 'Could not save changes'
  } finally {
    saving.value = false
  }
}

async function removeEntry() {
  if (!editing.value || !confirm(`Delete “${editing.value.item}” from ${editing.value.purchasedOn}?`)) return
  saving.value = true
  try {
    await $fetch(apiUrl(`/entries/${editing.value.id}`), { method: 'DELETE' })
    await closeEdit()
    await Promise.all([refresh(), refreshReceipts(), refreshReceiptDates()])
  } catch (error: any) {
    editError.value = error?.data?.statusMessage || error?.message || 'Could not delete entry'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="content-page history-page">
    <header class="page-heading history-heading">
      <div>
        <p class="eyebrow">{{ view === 'receipts' ? 'Shopping trips' : 'The full pricebook' }}</p>
        <h1>{{ view === 'receipts' ? 'Receipt history' : 'Price history' }}</h1>
        <p v-if="view === 'receipts' && receiptDates">{{ receiptDates.dates.length.toLocaleString() }} shopping {{ receiptDates.dates.length === 1 ? 'date' : 'dates' }}</p>
        <p v-else-if="view === 'entries' && data">{{ data.total.toLocaleString() }} {{ data.total === 1 ? 'entry' : 'entries' }}</p>
      </div>
    </header>

    <div class="history-view-switcher" aria-label="History view">
      <UButton type="button" label="Receipts" icon="i-lucide-receipt-text" :color="view === 'receipts' ? 'primary' : 'neutral'" :variant="view === 'receipts' ? 'solid' : 'ghost'" :aria-pressed="view === 'receipts'" @click="view = 'receipts'" />
      <UButton type="button" label="All entries" icon="i-lucide-list" :color="view === 'entries' ? 'primary' : 'neutral'" :variant="view === 'entries' ? 'solid' : 'ghost'" :aria-pressed="view === 'entries'" @click="view = 'entries'" />
    </div>

    <div v-if="view === 'entries'" class="filter-bar">
      <label class="search-control">
        <span class="sr-only">Search items</span>
        <UInput v-model="search" type="search" icon="i-lucide-search" placeholder="Search items or notes…" @keydown.esc="clearSearch">
          <template v-if="search" #trailing>
            <UButton type="button" icon="i-lucide-x" aria-label="Clear search" color="neutral" variant="ghost" size="xs" @click="clearSearch" />
          </template>
        </UInput>
      </label>
      <label class="store-filter-control">
        <span class="sr-only">Filter by store</span>
        <USelect v-model="location" :items="[{ label: 'All stores', value: allLocationsValue }, ...(stores || []).map(store => ({ label: store.name, value: store.name }))]" />
      </label>
      <div class="quick-filter-row" aria-label="Quick history filters">
        <UButton
          v-for="filter in changeFilters"
          :key="filter.value"
          type="button"
          :label="filter.label"
          :icon="filter.icon"
          size="sm"
          class="touch-target"
          :color="changeFilter === filter.value ? filter.activeColor : 'neutral'"
          :variant="changeFilter === filter.value ? 'soft' : 'ghost'"
          @click="changeFilter = filter.value"
        />
      </div>
    </div>

    <UAlert v-if="linkedEditError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="linkedEditError" class="notice" />

    <template v-if="view === 'receipts'">
      <div v-if="!receiptDates?.dates.length" class="empty-state">No receipt dates yet.</div>
      <div v-else class="receipt-browser">
        <aside class="receipt-calendar-panel" aria-label="Choose a receipt date">
          <div class="calendar-heading">
            <UButton type="button" icon="i-lucide-chevron-left" aria-label="Previous month" color="neutral" variant="ghost" :disabled="!canMoveToPreviousMonth" @click="moveCalendarMonth(-1)" />
            <label>
              <span class="sr-only">Choose month</span>
              <select v-model="selectedCalendarMonth" aria-live="polite">
                <option v-for="month in calendarMonthOptions" :key="month.value" :value="month.value">{{ month.label }}</option>
              </select>
            </label>
            <UButton type="button" icon="i-lucide-chevron-right" aria-label="Next month" color="neutral" variant="ghost" :disabled="!canMoveToNextMonth" @click="moveCalendarMonth(1)" />
          </div>
          <table class="receipt-calendar">
            <caption class="sr-only">Dates with recorded purchases</caption>
            <thead><tr><th v-for="weekday in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="weekday" scope="col">{{ weekday.slice(0, 1) }}</th></tr></thead>
            <tbody>
              <tr v-for="(week, weekIndex) in calendarWeeks" :key="weekIndex">
                <td v-for="day in week" :key="day.date">
                  <button
                    type="button"
                    :class="{ available: day.receiptCount, selected: day.date === selectedDate, outside: !day.currentMonth }"
                    :disabled="!day.receiptCount"
                    :aria-label="day.receiptCount ? `${dateLabel(day.date)}, ${day.receiptCount} ${day.receiptCount === 1 ? 'receipt' : 'receipts'}, ${day.itemCount} ${day.itemCount === 1 ? 'item' : 'items'}` : dateLabel(day.date)"
                    :aria-pressed="day.date === selectedDate"
                    @click="selectReceiptDate(day)"
                  >
                    <span>{{ day.day }}</span><i v-if="day.receiptCount" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="calendar-legend"><i aria-hidden="true" /> Dates with purchases</p>
        </aside>

        <section class="selected-receipts" :aria-labelledby="'selected-receipt-date'">
          <header class="selected-receipts-heading">
            <div><p class="eyebrow">Selected date</p><h2 id="selected-receipt-date">{{ dateLabel(selectedDate) }}</h2></div>
            <div class="selected-receipts-controls">
              <span v-if="receiptData">{{ receiptData.total }} {{ receiptData.total === 1 ? 'receipt' : 'receipts' }}</span>
              <nav class="receipt-day-navigation" aria-label="Receipt day navigation">
                <UButton
                  type="button"
                  label="Older"
                  icon="i-lucide-chevron-left"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :disabled="!olderReceiptDate"
                  :aria-label="olderReceiptDate ? `Older receipt day, ${dateLabel(olderReceiptDate.date)}` : 'No older receipt days'"
                  @click="olderReceiptDate && selectReceiptDateValue(olderReceiptDate.date)"
                />
                <UButton
                  type="button"
                  label="Newer"
                  trailing-icon="i-lucide-chevron-right"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :disabled="!newerReceiptDate"
                  :aria-label="newerReceiptDate ? `Newer receipt day, ${dateLabel(newerReceiptDate.date)}` : 'No newer receipt days'"
                  @click="newerReceiptDate && selectReceiptDateValue(newerReceiptDate.date)"
                />
              </nav>
            </div>
          </header>
          <div v-if="receiptsPending" class="empty-state">Gathering receipts…</div>
          <div v-else-if="receiptsError" class="empty-state error-state">Could not load receipts for this date.</div>
          <div v-else-if="!receiptData?.receipts.length" class="empty-state">No receipts recorded for this date.</div>
          <div v-else class="receipt-grid">
          <article v-for="receipt in receiptData.receipts" :key="receipt.id" class="virtual-receipt">
            <header class="receipt-heading">
              <div class="receipt-store-mark" aria-hidden="true"><UIcon name="i-lucide-store" /></div>
              <div class="receipt-heading-copy">
                <h2>{{ receipt.location }}</h2>
                <p>{{ dateLabel(receipt.purchasedOn) }} · {{ receipt.itemCount }} {{ receipt.itemCount === 1 ? 'item' : 'items' }}</p>
              </div>
              <UButton type="button" label="Edit receipt" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" @click="startReceiptEdit(receipt)" />
            </header>
            <div class="receipt-rule"><span>Item</span><span>Price</span></div>
            <ul class="receipt-lines">
              <li v-for="entry in receipt.entries" :key="entry.id">
                <div class="receipt-item-copy">
                  <NuxtLink :to="itemPath(entry.item)" class="item-history-link" :aria-label="`View normalized price history for ${entry.item}`">
                    <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
                  </NuxtLink>
                  <span class="receipt-item-meta">
                    {{ packageSize(entry.size, entry.unit) }}
                    <UBadge v-if="entry.saleItem" label="Sale" color="warning" variant="soft" size="sm" />
                    <UBadge v-if="entry.nonGrocery" label="Non-grocery" color="neutral" variant="soft" size="sm" />
                  </span>
                  <small v-if="entry.notes">{{ entry.notes }}</small>
                </div>
                <strong class="receipt-line-price">{{ currency(entry.price) }}</strong>
              </li>
            </ul>
            <footer class="receipt-total">
              <span>Total</span>
              <strong>{{ currency(receipt.total) }}</strong>
            </footer>
          </article>
          </div>
        </section>
      </div>
    </template>

    <template v-else>
      <div v-if="pending" class="empty-state">Loading price history…</div>
      <div v-else-if="error" class="empty-state error-state">Could not load the price history.</div>
      <div v-else-if="!data?.entries.length" class="empty-state">No matching entries.</div>
      <template v-else>
      <div v-if="data && data.total > limit" class="pagination pagination-top" aria-label="Price history pagination">
        <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit)" />
        <span>{{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}</span>
        <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="offset + limit >= data.total" @click="offset += limit" />
      </div>
      <div class="history-table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th :aria-sort="ariaSort('purchasedOn')"><button type="button" @click="toggleSort('purchasedOn')">Date <UIcon :name="sortBy === 'purchasedOn' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" /></button></th>
            <th :aria-sort="ariaSort('item')"><button type="button" @click="toggleSort('item')">Item <UIcon :name="sortBy === 'item' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" /></button></th>
            <th :aria-sort="ariaSort('location')"><button type="button" @click="toggleSort('location')">Store <UIcon :name="sortBy === 'location' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" /></button></th>
            <th :aria-sort="ariaSort('size')"><button type="button" @click="toggleSort('size')">Size <UIcon :name="sortBy === 'size' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" /></button></th>
            <th :aria-sort="ariaSort('price')"><button type="button" @click="toggleSort('price')">Price <UIcon :name="sortBy === 'price' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" /></button></th>
            <th :aria-sort="ariaSort('costPerUnit')"><button type="button" @click="toggleSort('costPerUnit')">Normalized <UIcon :name="sortBy === 'costPerUnit' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" /></button></th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in data.entries" :key="entry.id">
            <td data-label="Date">{{ dateLabel(entry.purchasedOn) }}</td>
            <td data-label="Item">
              <NuxtLink :to="itemPath(entry.item)" class="item-history-link" :aria-label="`View normalized price history for ${entry.item}`">
                <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
              </NuxtLink>
              <span v-if="entry.saleItem || entry.nonGrocery || Math.abs(Number(entry.priceChangePercent)) >= 10" class="row-badges">
                <UBadge v-if="entry.saleItem" label="Sale" icon="i-lucide-tag" color="warning" variant="soft" size="sm" />
                <UBadge
                  v-if="Number(entry.priceChangePercent) >= 10"
                  :label="`${percentage(entry.priceChangePercent)} higher`"
                  icon="i-lucide-trending-up"
                  color="error"
                  variant="soft"
                  size="sm"
                  :title="changeTitle(entry)"
                />
                <UBadge
                  v-else-if="Number(entry.priceChangePercent) <= -10"
                  :label="`${percentage(entry.priceChangePercent)} lower`"
                  icon="i-lucide-trending-down"
                  color="success"
                  variant="soft"
                  size="sm"
                  :title="changeTitle(entry)"
                />
                <UBadge v-if="entry.nonGrocery" label="Non-grocery" color="neutral" variant="soft" size="sm" />
              </span>
            </td>
            <td data-label="Store">{{ entry.location }}</td>
            <td data-label="Size">{{ packageSize(entry.size, entry.unit) }}</td>
            <td data-label="Price" class="numeric"><strong>{{ currency(entry.price) }}</strong></td>
            <td data-label="Normalized" class="numeric">{{ currency(entry.costPerUnit) }}</td>
            <td class="row-action"><UButton class="touch-target" type="button" label="Edit" icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" @click="startEdit(entry)" /></td>
          </tr>
        </tbody>
      </table>
      </div>
      </template>

      <div v-if="data && data.total > limit" class="pagination">
      <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit)" />
      <span>{{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}</span>
      <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="offset + limit >= data.total" @click="offset += limit" />
      </div>
    </template>

    <div v-if="editingReceipt" class="modal-backdrop" role="presentation" @mousedown.self="closeReceiptEdit">
      <div class="receipt-edit-dialog" role="dialog" aria-modal="true" aria-label="Edit receipt">
        <ReceiptEntryForm :receipt="editingReceipt" @saved="receiptChanged" @deleted="receiptChanged" @cancel="closeReceiptEdit" />
      </div>
    </div>

    <div v-if="editing" class="modal-backdrop" role="presentation" @mousedown.self="closeEdit">
      <form class="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" @submit.prevent="saveEdit">
        <div class="dialog-heading">
          <div><p class="eyebrow">Correct a record</p><h2 id="edit-title">Edit purchase</h2></div>
          <button class="icon-button" type="button" aria-label="Close" @click="closeEdit">×</button>
        </div>
        <div class="form-grid two-up">
          <div class="field"><label for="edit-date">Date</label><input id="edit-date" v-model="editing.purchasedOn" type="date" required></div>
          <div class="field">
            <label for="edit-store">Store</label>
            <UInputMenu id="edit-store" v-model="editing.location" :items="(stores || []).map(store => store.name)" create-item placeholder="Choose or add a store…" required />
          </div>
        </div>
        <div class="field"><label for="edit-item">Item</label><input id="edit-item" v-model="editing.item" type="text" required></div>
        <div class="form-grid three-up">
          <div class="field"><label for="edit-size">Size</label><input id="edit-size" v-model="editing.size" type="number" step="any"></div>
          <div class="field"><label for="edit-unit">Unit</label><UnitInput id="edit-unit" v-model="editing.unit" /></div>
          <div class="field"><label for="edit-price">Price</label><input id="edit-price" v-model="editing.price" type="number" min="0" step="0.01" required></div>
        </div>
        <div class="quick-toggles">
          <label><input v-model="editing.saleItem" type="checkbox"><span>Sale item</span></label>
          <label><input v-model="editing.nonGrocery" type="checkbox"><span>Non-grocery</span></label>
        </div>
        <div class="field"><label for="edit-notes">Notes</label><textarea id="edit-notes" v-model="editing.notes" rows="3" /></div>
        <p v-if="editError" class="notice error" role="alert">{{ editError }}</p>
        <div class="dialog-actions">
          <button class="danger-button" type="button" :disabled="saving" @click="removeEntry">Delete</button>
          <span class="spacer" />
          <button class="secondary-button" type="button" @click="closeEdit">Cancel</button>
          <button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>
