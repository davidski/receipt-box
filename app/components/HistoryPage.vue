<script setup lang="ts">
type Entry = {
  id: string
  purchasedOn: string
  item: string
  category: string | null
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
const { apiUrl } = useApi()
const route = useRoute()
const router = useRouter()
type HistoryView = 'receipts-calendar' | 'receipts-list' | 'entries'
const queryValue = (value: unknown) => Array.isArray(value) ? String(value[0] || '') : String(value || '')
const validSortKeys: SortKey[] = ['purchasedOn', 'item', 'location', 'size', 'price', 'costPerUnit']
const validChangeFilters: ChangeFilter[] = ['all', 'changed', 'higher', 'lower', 'sale']
const initialPage = Math.max(1, Number.parseInt(queryValue(route.query.page), 10) || 1)
const search = ref(queryValue(route.query.search))

const routeSegments = computed(() => {
  const value = route.params.view
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
})
const historyView = computed<HistoryView>(() => {
  const segments = routeSegments.value.join('/')
  if (segments === 'receipts/list' || segments === 'list') return 'receipts-list'
  if (segments === 'entries') return 'entries'
  return 'receipts-calendar'
})
const view = computed(() => historyView.value === 'entries' ? 'entries' : 'receipts')
const receiptMode = computed(() => historyView.value === 'receipts-list' ? 'list' : 'calendar')
const receiptListOffset = ref((initialPage - 1) * 50)
const location = ref(queryValue(route.query.store) || allLocationsValue)
const sortBy = ref<SortKey>(validSortKeys.includes(queryValue(route.query.sort) as SortKey) ? queryValue(route.query.sort) as SortKey : 'purchasedOn')
const sortDirection = ref<'asc' | 'desc'>(queryValue(route.query.direction) === 'asc' ? 'asc' : 'desc')
const changeFilter = ref<ChangeFilter>(validChangeFilters.includes(queryValue(route.query.filter) as ChangeFilter) ? queryValue(route.query.filter) as ChangeFilter : 'all')
const category = ref(queryValue(route.query.category))
const categorySelection = computed({
  get: () => category.value ? `category:${category.value}` : 'all',
  set: (value: string) => { category.value = value === 'all' ? '' : value.slice('category:'.length) }
})
const changeFilters: { label: string, value: ChangeFilter, icon: string, activeColor: 'primary' | 'error' | 'success' }[] = [
  { label: 'All', value: 'all', icon: 'i-lucide-list', activeColor: 'primary' },
  { label: 'Price changed', value: 'changed', icon: 'i-lucide-arrow-left-right', activeColor: 'primary' },
  { label: 'Up 10%+', value: 'higher', icon: 'i-lucide-trending-up', activeColor: 'error' },
  { label: 'Down 10%+', value: 'lower', icon: 'i-lucide-trending-down', activeColor: 'success' },
  { label: 'On sale', value: 'sale', icon: 'i-lucide-tag', activeColor: 'primary' }
]
const offset = ref((initialPage - 1) * 50)
const limit = 50
const selectedDate = ref(queryValue(route.query.date))
const today = new Date()
const initialMonth = queryValue(route.query.month)
const visibleMonth = ref(/^\d{4}-\d{2}$/.test(initialMonth)
  ? new Date(`${initialMonth}-01T00:00:00Z`)
  : new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)))
const query = computed(() => ({
  search: search.value,
  location: location.value === allLocationsValue ? '' : location.value,
  sortBy: sortBy.value,
  sortDirection: sortDirection.value,
  changeFilter: changeFilter.value,
  category: category.value,
  limit,
  offset: offset.value
}))
const { data, pending, error, refresh } = await useFetch<EntryList>(apiUrl('/entries'), { query })
const receiptQuery = computed(() => ({
  date: receiptMode.value === 'calendar' ? selectedDate.value : '',
  summary: receiptMode.value === 'list' ? 'true' : undefined,
  limit: 50,
  offset: receiptMode.value === 'list' ? receiptListOffset.value : 0
}))
const { data: receiptData, pending: receiptsPending, error: receiptsError, refresh: refreshReceipts } = await useFetch<ReceiptList>(apiUrl('/receipts'), { query: receiptQuery })
const { data: receiptDates, refresh: refreshReceiptDates } = await useFetch<ReceiptDates>(apiUrl('/receipts/dates'))
const { data: stores, refresh: refreshStores } = await useFetch<Store[]>(apiUrl('/stores'))
const { data: categories } = await useFetch<string[]>(apiUrl('/categories'))
const editing = ref<EditableEntry | null>(null)
const editError = ref('')
const saving = ref(false)
const linkedEditError = ref('')
const deleteConfirmOpen = ref(false)
const editingSize = computed({
  get: () => editing.value?.size ?? '',
  set: (value: string | undefined) => { if (editing.value) editing.value.size = value || null }
})
const editingNotes = computed({
  get: () => editing.value?.notes ?? '',
  set: (value: string | undefined) => { if (editing.value) editing.value.notes = value || null }
})

watch([search, location, changeFilter, category], () => {
  offset.value = 0
})

function syncHistoryQuery() {
  const query = { ...route.query } as Record<string, string | string[] | undefined>
  query.search = search.value || undefined
  query.store = location.value !== allLocationsValue ? location.value : undefined
  query.filter = changeFilter.value !== 'all' ? changeFilter.value : undefined
  query.category = category.value || undefined
  query.sort = sortBy.value !== 'purchasedOn' ? sortBy.value : undefined
  query.direction = sortDirection.value !== 'desc' ? sortDirection.value : undefined
  query.page = (view.value === 'entries' ? offset.value : receiptListOffset.value) > 0
    ? String(Math.floor((view.value === 'entries' ? offset.value : receiptListOffset.value) / 50) + 1)
    : undefined
  query.date = view.value === 'receipts' && receiptMode.value === 'calendar' ? selectedDate.value || undefined : undefined
  query.month = view.value === 'receipts' && receiptMode.value === 'calendar' ? selectedCalendarMonth.value : undefined
  void router.replace({ query })
}

watch([search, location, sortBy, sortDirection, changeFilter, category, offset, receiptListOffset, selectedDate, () => selectedCalendarMonth.value, view, receiptMode], syncHistoryQuery)

watch(() => route.query, (query) => {
  const nextSearch = queryValue(query.search)
  const nextLocation = queryValue(query.store) || allLocationsValue
  const nextFilter = queryValue(query.filter)
  const nextCategory = queryValue(query.category)
  const nextSort = queryValue(query.sort)
  const nextDirection = queryValue(query.direction)
  const nextPage = Math.max(1, Number.parseInt(queryValue(query.page), 10) || 1)
  search.value = nextSearch
  location.value = nextLocation
  changeFilter.value = validChangeFilters.includes(nextFilter as ChangeFilter) ? nextFilter as ChangeFilter : 'all'
  category.value = nextCategory
  sortBy.value = validSortKeys.includes(nextSort as SortKey) ? nextSort as SortKey : 'purchasedOn'
  sortDirection.value = nextDirection === 'asc' ? 'asc' : 'desc'
  offset.value = (view.value === 'entries' ? nextPage - 1 : 0) * 50
  receiptListOffset.value = (view.value === 'receipts' && receiptMode.value === 'list' ? nextPage - 1 : 0) * 50
  selectedDate.value = queryValue(query.date)
  const month = queryValue(query.month)
  if (/^\d{4}-\d{2}$/.test(month)) visibleMonth.value = new Date(`${month}-01T00:00:00Z`)
}, { deep: true })

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
  if (!editing.value) return
  deleteConfirmOpen.value = true
}

async function confirmRemoveEntry() {
  if (!editing.value) return
  saving.value = true
  try {
    await $fetch(apiUrl(`/entries/${editing.value.id}`), { method: 'DELETE' })
    await closeEdit()
    await Promise.all([refresh(), refreshReceipts(), refreshReceiptDates()])
  } catch (error: any) {
    editError.value = error?.data?.statusMessage || error?.message || 'Could not delete entry'
  } finally {
    saving.value = false
    deleteConfirmOpen.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-[1200px] mx-auto history-page">
    <header class="page-heading my-[15px] mb-8 history-heading">
      <div>
        <p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Purchase records</p>
        <h1 class="text-[clamp(34px,3.5vw,42px)] leading-[1.04]">History</h1>
        <p>Browse receipts or individual purchase entries.</p>
      </div>
      <div class="history-view-switcher" aria-label="History view">
        <UButton to="/history/receipts/calendar" label="Receipts" icon="i-lucide-receipt-text" :color="view === 'receipts' ? 'primary' : 'neutral'" :variant="view === 'receipts' ? 'solid' : 'ghost'" :aria-current="view === 'receipts' ? 'page' : undefined" />
        <UButton to="/history/entries" label="All entries" icon="i-lucide-list" :color="view === 'entries' ? 'primary' : 'neutral'" :variant="view === 'entries' ? 'solid' : 'ghost'" :aria-current="view === 'entries' ? 'page' : undefined" />
      </div>
    </header>

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
        <USelect v-model="location" :items="[{ label: 'All stores', value: allLocationsValue }, ...(stores || []).map(store => ({ label: store.name, value: store.name }))]" :content="{ bodyLock: false }" />
      </label>
      <label class="category-filter-control">
        <span class="sr-only">Filter by category</span>
        <USelect v-model="categorySelection" :items="[{ label: 'All categories', value: 'all' }, ...(categories || []).map(name => ({ label: name, value: `category:${name}` }))]" aria-label="Filter by category" :content="{ bodyLock: false }" />
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
        <div v-if="!receiptDates?.dates.length" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">No receipt dates yet.</div>
      <div v-else class="receipt-browser">
        <template v-if="receiptMode === 'calendar'">
        <aside class="receipt-calendar-panel" aria-label="Choose a receipt date">
          <div class="calendar-heading">
            <UButton type="button" icon="i-lucide-chevron-left" aria-label="Previous month" color="neutral" variant="ghost" :disabled="!canMoveToPreviousMonth" @click="moveCalendarMonth(-1)" />
            <label>
              <span class="sr-only">Choose month</span>
              <USelect v-model="selectedCalendarMonth" :items="calendarMonthOptions" aria-label="Choose month" size="sm" :content="{ bodyLock: false }" />
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
            <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Selected date</p><h2 id="selected-receipt-date">{{ dateLabel(selectedDate) }}</h2></div>
            <div class="selected-receipts-controls">
              <span v-if="receiptData">{{ receiptData.total }} {{ receiptData.total === 1 ? 'receipt' : 'receipts' }}</span>
              <div class="receipt-mode-switcher" aria-label="Receipt display">
                <span>Display</span>
                <UButton to="/history/receipts/calendar" label="Calendar" icon="i-lucide-calendar-days" color="primary" variant="soft" aria-current="page" />
                <UButton to="/history/receipts/list" label="List" icon="i-lucide-list" color="neutral" variant="ghost" />
              </div>
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
          <div v-if="receiptsPending" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">Gathering receipts…</div>
          <div v-else-if="receiptsError" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)] error-state">Could not load receipts for this date.</div>
          <div v-else-if="!receiptData?.receipts.length" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">No receipts recorded for this date.</div>
          <div v-else class="receipt-grid">
          <article v-for="receipt in receiptData.receipts" :key="receipt.id" class="virtual-receipt">
            <header class="receipt-heading">
              <div class="receipt-store-mark" aria-hidden="true"><UIcon name="i-lucide-store" /></div>
              <div class="receipt-heading-copy">
                <h2>{{ receipt.location }}</h2>
                <p>{{ dateLabel(receipt.purchasedOn) }} · {{ receipt.itemCount }} {{ receipt.itemCount === 1 ? 'item' : 'items' }}</p>
              </div>
              <UButton :to="{ path: '/', query: { date: receipt.purchasedOn, location: receipt.location } }" label="Edit receipt" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" />
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
                    <UBadge v-if="entry.category" :label="entry.category" color="primary" variant="soft" size="sm" />
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
        </template>
        <section v-else class="receipt-list-panel" aria-labelledby="receipt-list-heading">
          <header class="receipt-list-heading">
            <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">All receipts</p><h2 id="receipt-list-heading">Shopping history</h2></div>
            <div class="receipt-list-heading-controls">
              <span v-if="receiptData" class="receipt-list-count">{{ receiptData.total.toLocaleString() }} {{ receiptData.total === 1 ? 'receipt' : 'receipts' }}</span>
              <div class="receipt-mode-switcher" aria-label="Receipt display">
                <span>Display</span>
                <UButton to="/history/receipts/calendar" label="Calendar" icon="i-lucide-calendar-days" color="neutral" variant="ghost" />
                <UButton to="/history/receipts/list" label="List" icon="i-lucide-list" color="primary" variant="soft" aria-current="page" />
              </div>
            </div>
          </header>
          <div v-if="receiptData && receiptData.total > 50" class="pagination flex items-center justify-center gap-[18px] mt-6 text-[13px] text-[var(--muted)] receipt-list-pagination receipt-list-pagination-top" aria-label="Receipt list pagination">
            <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="receiptListOffset === 0" @click="receiptListOffset = Math.max(0, receiptListOffset - 50)" />
            <span>{{ receiptListOffset + 1 }}–{{ Math.min(receiptListOffset + 50, receiptData.total) }} of {{ receiptData.total }}</span>
            <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="receiptListOffset + 50 >= receiptData.total" @click="receiptListOffset += 50" />
          </div>
          <div v-if="receiptsPending" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">Gathering receipts…</div>
          <div v-else-if="receiptsError" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)] error-state">Could not load the receipt list.</div>
          <div v-else-if="!receiptData?.receipts.length" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">No receipts recorded yet.</div>
          <template v-else>
            <div class="receipt-list-wrap">
              <table class="receipt-list">
                <caption class="sr-only">Receipt date, store, and total</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col">Items</th><th scope="col">Total</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
                <tbody>
                  <tr v-for="receipt in receiptData.receipts" :key="receipt.id">
                    <td data-label="Date"><strong>{{ dateLabel(receipt.purchasedOn) }}</strong></td>
                    <td data-label="Store"><span class="receipt-list-store"><UIcon name="i-lucide-store" aria-hidden="true" />{{ receipt.location }}</span></td>
                    <td data-label="Items" class="receipt-list-items">{{ receipt.itemCount }}</td>
                    <td data-label="Total" class="receipt-list-total">{{ currency(receipt.total) }}</td>
                    <td class="receipt-list-action"><NuxtLink :to="{ path: '/', query: { date: receipt.purchasedOn, location: receipt.location } }" :aria-label="`Edit ${receipt.location} receipt from ${dateLabel(receipt.purchasedOn)}`">Edit <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" /></NuxtLink></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="receiptData.total > 50" class="pagination flex items-center justify-center gap-[18px] mt-6 text-[13px] text-[var(--muted)] receipt-list-pagination" aria-label="Receipt list pagination">
              <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="receiptListOffset === 0" @click="receiptListOffset = Math.max(0, receiptListOffset - 50)" />
              <span>{{ receiptListOffset + 1 }}–{{ Math.min(receiptListOffset + 50, receiptData.total) }} of {{ receiptData.total }}</span>
              <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="receiptListOffset + 50 >= receiptData.total" @click="receiptListOffset += 50" />
            </div>
          </template>
        </section>
      </div>
    </template>

    <template v-else>
      <div v-if="pending" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">Loading price history…</div>
      <div v-else-if="error" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)] error-state">Could not load the price history.</div>
      <div v-else-if="!data?.entries.length" class="grid min-h-[220px] place-items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line)] p-9 text-center text-[var(--muted)]">No matching entries.</div>
      <template v-else>
      <div v-if="data && data.total > limit" class="pagination flex items-center justify-center gap-[18px] mt-6 text-[13px] text-[var(--muted)] pagination-top" aria-label="Price history pagination">
        <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit)" />
        <span>{{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}</span>
        <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="offset + limit >= data.total" @click="offset += limit" />
      </div>
      <div class="history-table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th :aria-sort="ariaSort('purchasedOn')"><UButton type="button" label="Date" :icon="sortBy === 'purchasedOn' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" @click="toggleSort('purchasedOn')" /></th>
            <th :aria-sort="ariaSort('item')"><UButton type="button" label="Item" :icon="sortBy === 'item' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" @click="toggleSort('item')" /></th>
            <th :aria-sort="ariaSort('location')"><UButton type="button" label="Store" :icon="sortBy === 'location' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" @click="toggleSort('location')" /></th>
            <th :aria-sort="ariaSort('size')"><UButton type="button" label="Size" :icon="sortBy === 'size' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" @click="toggleSort('size')" /></th>
            <th :aria-sort="ariaSort('price')"><UButton type="button" label="Price" :icon="sortBy === 'price' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" @click="toggleSort('price')" /></th>
            <th :aria-sort="ariaSort('costPerUnit')"><UButton type="button" label="Normalized" :icon="sortBy === 'costPerUnit' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" @click="toggleSort('costPerUnit')" /></th>
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

      <div v-if="data && data.total > limit" class="pagination flex items-center justify-center gap-[18px] mt-6 text-[13px] text-[var(--muted)]">
      <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit)" />
      <span>{{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}</span>
      <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="offset + limit >= data.total" @click="offset += limit" />
      </div>
    </template>

    <UModal :open="Boolean(editing)" title="Edit purchase" :dismissible="!saving" :close="!saving" @update:open="!$event && closeEdit()">
      <template #body>
        <form v-if="editing" id="edit-purchase-form" class="edit-dialog" @submit.prevent="saveEdit">
          <div class="form-grid grid gap-4 grid-cols-2">
            <UFormField label="Date" name="edit-date" required class="field">
              <UInput id="edit-date" v-model="editing.purchasedOn" type="date" required />
            </UFormField>
            <UFormField label="Store" name="edit-store" required class="field">
              <UInputMenu id="edit-store" v-model="editing.location" :items="(stores || []).map(store => store.name)" create-item placeholder="Choose or add a store…" required />
            </UFormField>
          </div>
          <UFormField label="Item" name="edit-item" required class="field">
            <UInput id="edit-item" v-model="editing.item" type="text" required />
          </UFormField>
          <div class="form-grid grid gap-4 grid-cols-3">
            <UFormField label="Size" name="edit-size" class="field">
              <UInput id="edit-size" v-model="editingSize" type="number" step="any" />
            </UFormField>
            <UFormField label="Unit" name="edit-unit" class="field"><UnitInput id="edit-unit" v-model="editing.unit" /></UFormField>
            <UFormField label="Price" name="edit-price" required class="field">
              <UInput id="edit-price" v-model="editing.price" type="number" min="0" step="0.01" required />
            </UFormField>
          </div>
          <div class="quick-toggles">
            <UCheckbox v-model="editing.saleItem" label="Sale item" />
            <UCheckbox v-model="editing.nonGrocery" label="Non-grocery" />
          </div>
          <UFormField label="Notes" name="edit-notes" class="field">
            <UTextarea id="edit-notes" v-model="editingNotes" :rows="3" />
          </UFormField>
          <UAlert v-if="editError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="editError" />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-between gap-2">
          <UButton type="button" label="Delete" color="error" variant="outline" :disabled="saving" @click="removeEntry" />
          <div class="flex gap-2">
            <UButton type="button" label="Cancel" color="neutral" variant="ghost" :disabled="saving" @click="closeEdit" />
            <UButton form="edit-purchase-form" type="submit" label="Save changes" :loading="saving" />
          </div>
        </div>
      </template>
    </UModal>
    <ConfirmModal
      v-if="editing"
      v-model:open="deleteConfirmOpen"
      title="Delete purchase?"
      :description="`Delete “${editing.item}” from ${editing.purchasedOn}? This cannot be undone.`"
      confirm-label="Delete purchase"
      confirm-color="error"
      :loading="saving"
      @confirm="confirmRemoveEntry"
    />
  </div>
</template>
