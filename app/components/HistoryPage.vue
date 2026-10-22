<script setup lang="ts">
import { maxEntryNotesLength } from '../../shared/utils/entry-notes'
import { formatCurrency, formatSignedPercent } from '../../shared/utils/money'

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
const today = new Date()
const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
const initialDate = queryValue(route.query.date)
const selectedDate = ref(validDate(initialDate) ? initialDate : todayDate)
const visibleMonth = ref(new Date(`${selectedDate.value.slice(0, 7)}-01T00:00:00Z`))
const selectedCalendarMonth = computed(() => visibleMonth.value.toISOString().slice(0, 7))
const selectedCalendarMonthLabel = computed(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(visibleMonth.value))
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
const receiptsLoadingVisible = ref(false)
watch(receiptsPending, (isPending, _previous, onCleanup) => {
  if (!isPending) {
    receiptsLoadingVisible.value = false
    return
  }
  const timer = setTimeout(() => { receiptsLoadingVisible.value = true }, 150)
  onCleanup(() => clearTimeout(timer))
}, { immediate: true })
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
  const date = queryValue(query.date)
  selectedDate.value = validDate(date) ? date : todayDate
  const month = queryValue(query.month)
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) visibleMonth.value = new Date(`${month}-01T00:00:00Z`)
}, { deep: true })

const receiptDateMap = computed(() => new Map((receiptDates.value?.dates || []).map(date => [date.date, date])))
const olderReceiptDate = computed(() => (receiptDates.value?.dates || []).find(date => date.date < selectedDate.value) || null)
const newerReceiptDate = computed(() => (receiptDates.value?.dates || []).findLast(date => date.date > selectedDate.value) || null)
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

function moveCalendarMonth(amount: number) {
  visibleMonth.value = new Date(Date.UTC(visibleMonth.value.getUTCFullYear(), visibleMonth.value.getUTCMonth() + amount, 1))
}

function selectReceiptDateValue(value: string) {
  selectedDate.value = value
  const date = new Date(`${value}T00:00:00Z`)
  visibleMonth.value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function selectReceiptDate(day: CalendarDay) {
  selectReceiptDateValue(day.date)
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
  requestAnimationFrame(() => document.getElementById('history-search')?.focus())
}

const receiptLinePreviewCount = 8

function previewEntries(receipt: Receipt) {
  return receipt.entries.slice(0, receiptLinePreviewCount)
}

function overflowEntries(receipt: Receipt) {
  return receipt.entries.slice(receiptLinePreviewCount)
}

function calendarDayClass(day: CalendarDay) {
  const selected = day.date === selectedDate.value
  if (selected) return `bg-accent-fill text-on-accent-fill ${day.receiptCount ? 'font-[750]' : ''}`
  if (day.receiptCount) return 'bg-accent-soft font-[750] text-accent-strong hover:bg-[color-mix(in_srgb,var(--accent-soft),var(--accent)_12%)]'
  return day.currentMonth ? 'bg-transparent text-ink' : 'bg-transparent text-muted/45'
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

function changeTitle(entry: Entry) {
  const basis = entry.comparisonBasis === 'normalized' ? 'normalized unit price' : 'package price'
  const date = entry.previousPurchasedOn ? dateLabel(entry.previousPurchasedOn) : 'the previous purchase'
  return `${formatSignedPercent(Number(entry.priceChangePercent))} versus the ${basis} on ${date}`
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

function focusHistoryRow(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, select, textarea')) return
  const row = event.currentTarget as HTMLElement
  row.focus()
}

function openReceipt(receipt: Receipt, event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button')) return
  void router.push(`/receipts/${receipt.id}`)
}

function editEntryFromRow(entry: Entry, event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button')) return
  startEdit(entry)
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
  <div class="mx-auto w-full max-w-300">
    <header class="page-heading my-[0.9375rem] mb-8 items-end flex items-start justify-between gap-5 max-[56.25rem]:grid max-[56.25rem]:items-start max-sm:grid max-sm:items-start">
      <div>
        <h1 class="leading-[1.04] text-display">Receipts</h1>
        <p>{{ view === 'receipts' ? 'Browse receipts by date.' : 'Browse individual purchase entries.' }}</p>
      </div>
      <nav class="m-0 flex w-max shrink-0 items-center gap-[0.3125rem] rounded-card p-1 bg-surface border border-line max-[56.25rem]:[&>*]:flex-1 max-[56.25rem]:[&>*]:justify-center max-[56.25rem]:mb-0 max-[56.25rem]:w-full" aria-label="Receipts view">
        <UButton to="/" label="Calendar" icon="i-lucide-calendar-days" :color="historyView === 'receipts-calendar' ? 'primary' : 'neutral'" :variant="historyView === 'receipts-calendar' ? 'soft' : 'ghost'" :aria-current="historyView === 'receipts-calendar' ? 'page' : undefined" />
        <UButton to="/history/receipts/list" label="Receipt list" icon="i-lucide-receipt-text" :color="historyView === 'receipts-list' ? 'primary' : 'neutral'" :variant="historyView === 'receipts-list' ? 'soft' : 'ghost'" :aria-current="historyView === 'receipts-list' ? 'page' : undefined" />
        <UButton to="/history/entries" label="Item entries" icon="i-lucide-list" :color="historyView === 'entries' ? 'primary' : 'neutral'" :variant="historyView === 'entries' ? 'soft' : 'ghost'" :aria-current="historyView === 'entries' ? 'page' : undefined" />
      </nav>
    </header>

    <div v-if="view === 'entries'" class="sticky top-[5.4375rem] z-15 mb-5 grid grid-cols-[minmax(0,1fr)_minmax(0,13.75rem)_minmax(0,13.75rem)] gap-3 rounded-card p-2.5 backdrop-blur-lg bg-bg/95 border border-line max-sm:top-[4.875rem] max-sm:grid-cols-1">
      <label class="relative">
        <span class="sr-only">Search items</span>
        <UInput id="history-search" v-model="search" class="w-full" :ui="{ base: 'ps-11' }" type="search" icon="i-lucide-search" placeholder="Search items or notes…" @keydown.esc="clearSearch">
          <template v-if="search" #trailing>
            <UButton type="button" icon="i-lucide-x" aria-label="Clear search" color="neutral" variant="ghost" size="md" @click="clearSearch" />
          </template>
        </UInput>
      </label>
      <label class="min-w-0">
        <span class="sr-only">Filter by store</span>
        <USelect v-model="location" class="w-full min-w-0" :ui="{ base: 'ps-3.5 pe-10.5' }" :items="[{ label: 'All stores', value: allLocationsValue }, ...(stores || []).map(store => ({ label: store.name, value: store.name }))]" :content="{ bodyLock: false }" />
      </label>
      <label class="min-w-0">
        <span class="sr-only">Filter by category</span>
        <USelect v-model="categorySelection" class="w-full min-w-0" :ui="{ base: 'ps-3.5 pe-10.5' }" :items="[{ label: 'All categories', value: 'all' }, ...(categories || []).map(name => ({ label: name, value: `category:${name}` }))]" aria-label="Filter by category" :content="{ bodyLock: false }" />
      </label>
      <div class="col-span-full flex flex-wrap gap-[0.3125rem] pt-[0.125rem] border-t border-line/65" aria-label="Quick history filters">
        <UButton
          v-for="filter in changeFilters"
          :key="filter.value"
          type="button"
          :label="filter.label"
          :icon="filter.icon"
          size="md"
          class="touch-target"
          :color="changeFilter === filter.value ? filter.activeColor : 'neutral'"
          :variant="changeFilter === filter.value ? 'soft' : 'ghost'"
          @click="changeFilter = filter.value"
        />
      </div>
    </div>

    <UAlert v-if="linkedEditError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="linkedEditError" class="notice m-[0.9375rem_0_0] rounded-input p-[0.6875rem_0.8125rem] text-sm" />

    <template v-if="view === 'receipts'">
      <div class="grid grid-cols-[20.625rem_minmax(0,1fr)] items-start gap-6 max-[56.25rem]:grid-cols-1 min-[47.5rem]:max-[56.25rem]:grid-cols-[17.5rem_minmax(0,_1fr)]">
        <template v-if="receiptMode === 'calendar'">
        <aside class="sticky top-24 rounded-card p-4.5 shadow-(--shadow) bg-surface border border-line max-[56.25rem]:static max-[56.25rem]:w-[min(20.625rem,_100%)] min-[47.5rem]:max-[56.25rem]:w-full max-sm:w-full max-sm:p-[0.875rem]" aria-label="Choose a receipt date">
          <div class="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-1.5">
            <UButton type="button" icon="i-lucide-chevron-left" aria-label="Previous month" color="neutral" variant="ghost" @click="moveCalendarMonth(-1)" />
            <h2 class="overflow-hidden text-center text-base text-ellipsis whitespace-nowrap" aria-live="polite">{{ selectedCalendarMonthLabel }}</h2>
            <UButton type="button" icon="i-lucide-chevron-right" aria-label="Next month" color="neutral" variant="ghost" @click="moveCalendarMonth(1)" />
          </div>
          <table class="mt-3 w-full table-fixed border-separate [border-spacing:0.1875rem]">
            <caption class="sr-only">Choose any calendar date</caption>
            <thead><tr><th v-for="weekday in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="weekday" class="h-7 text-center text-xs font-[750] text-muted" scope="col">{{ weekday.slice(0, 1) }}</th></tr></thead>
            <tbody>
              <tr v-for="(week, weekIndex) in calendarWeeks" :key="weekIndex">
                <td v-for="day in week" :key="day.date" class="p-0">
                  <button
                    type="button"
                    class="relative grid aspect-square min-h-10 w-full cursor-pointer place-items-center rounded-control border-0 p-0 text-sm disabled:opacity-100"
                    :class="calendarDayClass(day)"
                    :aria-label="day.receiptCount ? `${dateLabel(day.date)}, ${day.receiptCount} ${day.receiptCount === 1 ? 'receipt' : 'receipts'}, ${day.itemCount} ${day.itemCount === 1 ? 'item' : 'items'}` : dateLabel(day.date)"
                    :aria-pressed="day.date === selectedDate"
                    @click="selectReceiptDate(day)"
                  >
                    <span>{{ day.day }}</span><i v-if="day.receiptCount" class="absolute bottom-1.25 size-1 rounded-full bg-current" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="m-[0.8125rem_0_0] flex items-center justify-center gap-[0.4375rem] text-xs text-muted"><i class="size-[0.4375rem] rounded-full bg-accent" aria-hidden="true" /> Dates with receipts</p>
        </aside>

        <section class="min-w-0" :aria-labelledby="'selected-receipt-date'">
          <header class="m-[0_0_0.875rem] grid gap-3.5">
            <div><p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-accent uppercase">Selected date</p><h2 id="selected-receipt-date">{{ dateLabel(selectedDate) }}</h2></div>
            <div class="flex flex-wrap items-center justify-start gap-3.5">
              <span v-if="receiptData" class="flex-[0_0_7rem] text-sm whitespace-nowrap text-muted">{{ receiptData.total }} {{ receiptData.total === 1 ? 'receipt' : 'receipts' }}</span>
              <nav class="flex gap-1.5" aria-label="Receipt day navigation">
                <UButton
                  type="button"
                  label="Older"
                  icon="i-lucide-chevron-left"
                  color="neutral"
                  variant="outline"
                  size="md"
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
                  size="md"
                  :disabled="!newerReceiptDate"
                  :aria-label="newerReceiptDate ? `Newer receipt day, ${dateLabel(newerReceiptDate.date)}` : 'No newer receipt days'"
                  @click="newerReceiptDate && selectReceiptDateValue(newerReceiptDate.date)"
                />
              </nav>
              <UButton :to="{ path: '/receipts/new', query: { date: selectedDate } }" label="Add receipt" icon="i-lucide-plus" color="primary" />
            </div>
          </header>
          <div v-if="receiptsLoadingVisible" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Gathering receipts…</div>
          <div v-else-if="receiptsError" class="error-state grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Could not load receipts for this date.</div>
          <div v-else-if="!receiptData?.receipts.length" class="flex items-center gap-2 py-3 text-muted"><UIcon class="size-4.5 text-accent" name="i-lucide-receipt-text" aria-hidden="true" />No receipts for this date.</div>
          <div v-else class="[column-width:22.5rem] gap-6 max-[56.25rem]:[columns:1]">
          <article v-for="receipt in receiptData.receipts" :key="receipt.id" class="relative mb-6 break-inside-avoid overflow-hidden rounded-t-input rounded-b-card p-[1.625rem_1.625rem_1.375rem] shadow-(--shadow) bg-surface border border-line max-sm:p-[1.375rem_1rem_1.125rem]">
            <header class="flex items-center gap-[0.8125rem] pb-5 text-left max-sm:flex-wrap">
              <div class="grid size-[2.625rem] flex-[0_0_auto] place-items-center rounded-input text-title text-accent-strong bg-accent-soft" aria-hidden="true"><UIcon name="i-lucide-store" /></div>
              <div class="min-w-0 flex-1">
                <h2 class="text-title leading-[1.05]">{{ receipt.location }}</h2>
                <p class="[margin:0.25rem_0_0] text-muted text-xs">{{ dateLabel(receipt.purchasedOn) }}<span class="ml-2.5 font-[650] text-accent-strong">{{ receipt.itemCount }} {{ receipt.itemCount === 1 ? 'item' : 'items' }}</span></p>
              </div>
              <UButton class="self-start" :to="`/receipts/${receipt.id}`" label="Edit receipt" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" />
            </header>
            <div class="flex justify-between p-[0.5rem_0] text-xs font-[750] tracking-widest text-muted uppercase border-y border-dashed border-line"><span>Item</span><span>Price</span></div>
            <ul class="m-0 list-none p-0">
              <ReceiptEntryLine v-for="entry in previewEntries(receipt)" :key="entry.id" :entry="entry" :size="packageSize(entry.size, entry.unit)" />
            </ul>
            <UCollapsible v-if="receipt.entries.length > receiptLinePreviewCount" class="mt-1">
              <template #default="{ open }">
                <UButton class="touch-target" :label="open ? 'Show fewer items' : `Show ${receipt.entries.length - receiptLinePreviewCount} more ${receipt.entries.length - receiptLinePreviewCount === 1 ? 'item' : 'items'}`" color="neutral" variant="ghost" :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" size="sm" />
              </template>
              <template #content>
                <ul class="m-0 list-none p-0">
                  <ReceiptEntryLine v-for="entry in overflowEntries(receipt)" :key="entry.id" :entry="entry" :size="packageSize(entry.size, entry.unit)" />
                </ul>
              </template>
            </UCollapsible>
            <footer class="flex items-baseline justify-between gap-5 pt-4.5 font-display">
              <span class="text-title font-[600]">Total</span>
              <strong class="text-accent-strong text-heading tabular-nums">{{ formatCurrency(receipt.total) }}</strong>
            </footer>
          </article>
          </div>
        </section>
        </template>
        <section v-else class="col-span-full min-w-0 rounded-card p-6 shadow-(--shadow) bg-surface border border-line max-sm:p-[1.125rem_0.875rem]" aria-labelledby="receipt-list-heading">
          <header class="mb-4 flex items-end justify-between gap-4.5 max-sm:items-start">
            <div class="mt-1.25"><h2 id="receipt-list-heading">Shopping history</h2></div>
            <div class="flex items-center gap-3.5">
              <span v-if="receiptData" class="text-sm text-muted">{{ receiptData.total.toLocaleString() }} {{ receiptData.total === 1 ? 'receipt' : 'receipts' }}</span>
            </div>
          </header>
          <div v-if="receiptData && receiptData.total > 50" class="pagination m-[-0.25rem_0_1rem] mt-6 flex items-center justify-center gap-[1.125rem] text-sm text-muted max-sm:gap-[0.5rem]" aria-label="Receipt list pagination">
            <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="receiptListOffset === 0" @click="receiptListOffset = Math.max(0, receiptListOffset - 50)" />
            <span>{{ receiptListOffset + 1 }}–{{ Math.min(receiptListOffset + 50, receiptData.total) }} of {{ receiptData.total }}</span>
            <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="receiptListOffset + 50 >= receiptData.total" @click="receiptListOffset += 50" />
          </div>
          <div v-if="receiptsLoadingVisible" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Gathering receipts…</div>
          <div v-else-if="receiptsError" class="error-state grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Could not load the receipt list.</div>
          <div v-else-if="!receiptData?.receipts.length" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">No receipts recorded yet.</div>
          <template v-else>
            <div class="overflow-hidden rounded-card border border-line max-sm:overflow-visible max-sm:border-0">
              <table :class="[cardTable, 'w-full border-collapse text-base']">
                <caption class="sr-only">Receipt date, store, and total</caption>
                <thead>
                  <tr>
                    <th scope="col" :class="[tableHead, 'text-left']">Date</th>
                    <th scope="col" :class="[tableHead, 'text-left']">Store</th>
                    <th scope="col" :class="[tableHead, 'w-22.5 text-right']">Items</th>
                    <th scope="col" :class="[tableHead, 'text-right']">Total</th>
                    <th scope="col" :class="[tableHead, 'w-23 text-left']"><span class="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="receipt in receiptData.receipts" :key="receipt.id" tabindex="0" :class="[tableRow, cardRow, 'max-sm:grid-cols-[1fr_auto] max-sm:gap-y-2.5 max-sm:gap-x-3.5']" @click="focusHistoryRow" @dblclick="openReceipt(receipt, $event)">
                    <td data-label="Date" :class="[tableCell, cardCell, 'max-sm:col-span-full max-sm:text-base']"><strong>{{ dateLabel(receipt.purchasedOn) }}</strong></td>
                    <td data-label="Store" :class="[tableCell, cardCell, 'max-sm:col-span-full']"><span class="inline-flex items-center gap-2"><UIcon class="text-accent" name="i-lucide-store" aria-hidden="true" />{{ receipt.location }}</span></td>
                    <td data-label="Items" :class="[tableCell, cardCell, 'text-right text-muted tabular-nums max-sm:col-start-1 max-sm:row-start-3 max-sm:text-left']">{{ receipt.itemCount }}</td>
                    <td data-label="Total" :class="[tableCell, cardCell, 'text-right font-[750] text-accent-strong tabular-nums max-sm:col-start-2 max-sm:row-start-3 max-sm:justify-items-end']">{{ formatCurrency(receipt.total) }}</td>
                    <td :class="[tableCell, cardCellBare, 'text-right max-sm:col-span-full']"><NuxtLink class="inline-flex items-center gap-1.25 text-sm text-muted hover:text-accent-strong hover:underline hover:underline-offset-[3px] focus-visible:text-accent-strong focus-visible:underline focus-visible:underline-offset-[3px] max-sm:w-full max-sm:justify-end max-sm:border-t max-sm:border-line max-sm:pt-1.5" :to="`/receipts/${receipt.id}`" :aria-label="`Edit ${receipt.location} receipt from ${dateLabel(receipt.purchasedOn)}`">Edit <UIcon class="size-3.5" name="i-lucide-arrow-up-right" aria-hidden="true" /></NuxtLink></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="receiptData.total > 50" class="pagination mt-6 flex items-center justify-center gap-[1.125rem] text-sm text-muted max-sm:gap-[0.5rem]" aria-label="Receipt list pagination">
              <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="receiptListOffset === 0" @click="receiptListOffset = Math.max(0, receiptListOffset - 50)" />
              <span>{{ receiptListOffset + 1 }}–{{ Math.min(receiptListOffset + 50, receiptData.total) }} of {{ receiptData.total }}</span>
              <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="receiptListOffset + 50 >= receiptData.total" @click="receiptListOffset += 50" />
            </div>
          </template>
        </section>
      </div>
    </template>

    <template v-else>
      <div v-if="pending" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Loading price history…</div>
      <div v-else-if="error" class="error-state grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">Could not load the price history.</div>
      <div v-else-if="!data?.entries.length" class="grid min-h-55 place-items-center gap-1.5 rounded-card border border-dashed border-line p-9 text-center text-muted">No matching entries.</div>
      <template v-else>
      <div v-if="data && data.total > limit" class="pagination m-[-0.25rem_0_1rem] mt-6 flex items-center justify-center gap-[1.125rem] text-sm text-muted max-sm:gap-[0.5rem]" aria-label="Price history pagination">
        <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit)" />
        <span>{{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}</span>
        <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="offset + limit >= data.total" @click="offset += limit" />
      </div>
      <div class="overflow-hidden rounded-card shadow-(--shadow) bg-surface border border-line max-sm:overflow-visible max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
      <table :class="[cardTable, 'w-full table-fixed border-collapse text-base']">
        <caption class="sr-only">Purchase entries</caption>
        <thead>
          <tr>
            <th scope="col" :class="[tableHead, 'w-[12%] text-left']" :aria-sort="ariaSort('purchasedOn')"><UButton class="touch-target -mx-2.5 -my-2 px-2.5 text-muted uppercase tracking-[0.08em] font-bold hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" type="button" label="Date" :icon="sortBy === 'purchasedOn' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" :ui="{ leadingIcon: 'size-3.5' }" @click="toggleSort('purchasedOn')" /></th>
            <th scope="col" :class="[tableHead, 'w-[27%] text-left']" :aria-sort="ariaSort('item')"><UButton class="touch-target -mx-2.5 -my-2 px-2.5 text-muted uppercase tracking-[0.08em] font-bold hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" type="button" label="Item" :icon="sortBy === 'item' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" :ui="{ leadingIcon: 'size-3.5' }" @click="toggleSort('item')" /></th>
            <th scope="col" :class="[tableHead, 'w-[15%] text-left']" :aria-sort="ariaSort('location')"><UButton class="touch-target -mx-2.5 -my-2 px-2.5 text-muted uppercase tracking-[0.08em] font-bold hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" type="button" label="Store" :icon="sortBy === 'location' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" :ui="{ leadingIcon: 'size-3.5' }" @click="toggleSort('location')" /></th>
            <th scope="col" :class="[tableHead, 'w-[10%] text-left']" :aria-sort="ariaSort('size')"><UButton class="touch-target -mx-2.5 -my-2 px-2.5 text-muted uppercase tracking-[0.08em] font-bold hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" type="button" label="Size" :icon="sortBy === 'size' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" :ui="{ leadingIcon: 'size-3.5' }" @click="toggleSort('size')" /></th>
            <th scope="col" :class="[tableHead, 'w-[10%] text-right']" :aria-sort="ariaSort('price')"><UButton class="touch-target -mx-2.5 -my-2 px-2.5 text-muted uppercase tracking-[0.08em] font-bold hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" type="button" label="Price" :icon="sortBy === 'price' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" :ui="{ leadingIcon: 'size-3.5' }" @click="toggleSort('price')" /></th>
            <th scope="col" :class="[tableHead, 'w-[14%] text-right']" :aria-sort="ariaSort('costPerUnit')"><UButton class="touch-target -mx-2.5 -my-2 px-2.5 text-muted uppercase tracking-[0.08em] font-bold hover:bg-accent-soft hover:text-accent-strong focus-visible:bg-accent-soft focus-visible:text-accent-strong" type="button" label="Normalized" :icon="sortBy === 'costPerUnit' ? (sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'" color="neutral" variant="ghost" size="xs" :ui="{ leadingIcon: 'size-3.5' }" @click="toggleSort('costPerUnit')" /></th>
            <th scope="col" :class="[tableHead, 'w-[12%] text-right']"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in data.entries" :key="entry.id" tabindex="0" :class="[tableRow, cardRow, 'max-sm:grid-cols-2']" @click="focusHistoryRow" @dblclick="editEntryFromRow(entry, $event)">
            <td data-label="Date" :class="[tableCell, cardCell]">{{ dateLabel(entry.purchasedOn) }}</td>
            <td data-label="Item" :class="[tableCell, cardCell, 'max-sm:col-span-full max-sm:row-start-1 max-sm:text-base']">
              <NuxtLink :to="itemPath(entry.item)" class="item-history-link inline-flex max-w-full items-center gap-[0.4375rem] text-inherit no-underline" :aria-label="`View normalized price history for ${entry.item}`">
                <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
              </NuxtLink>
              <span v-if="entry.saleItem || entry.nonGrocery || Math.abs(Number(entry.priceChangePercent)) >= 10" class="mt-1.5 flex flex-wrap gap-[0.3125rem]">
                <UBadge v-if="entry.saleItem" label="Sale" icon="i-lucide-tag" color="warning" variant="soft" size="sm" />
                <PriceChange
                  v-if="Math.abs(Number(entry.priceChangePercent)) >= 10"
                  :value="Number(entry.priceChangePercent)"
                  unit="percent"
                  size="sm"
                  :title="changeTitle(entry)"
                />
                <UBadge v-if="entry.nonGrocery" label="Non-grocery" color="neutral" variant="soft" size="sm" />
              </span>
            </td>
            <td data-label="Store" :class="[tableCell, cardCell]">{{ entry.location }}</td>
            <td data-label="Size" :class="[tableCell, cardCell]">{{ packageSize(entry.size, entry.unit) }}</td>
            <td data-label="Price" :class="[tableCell, cardCell, 'text-right max-sm:text-left']"><strong>{{ formatCurrency(entry.price) }}</strong></td>
            <td data-label="Normalized" :class="[tableCell, cardCell, 'text-right max-sm:text-left']">{{ entry.costPerUnit === null ? '—' : formatCurrency(entry.costPerUnit) }}</td>
            <td :class="[tableCell, cardCellBare, 'text-right']"><UButton class="touch-target justify-end border-0 bg-transparent px-1 text-sm text-muted no-underline hover:bg-transparent hover:text-accent-strong hover:underline hover:underline-offset-[3px] focus-visible:text-accent-strong" type="button" label="Edit" icon="i-lucide-arrow-up-right" trailing color="neutral" variant="ghost" size="sm" @click="startEdit(entry)" /></td>
          </tr>
        </tbody>
      </table>
      </div>
      </template>

      <div v-if="data && data.total > limit" class="pagination mt-6 flex items-center justify-center gap-[1.125rem] text-sm text-muted max-sm:gap-[0.5rem]">
      <UButton class="touch-target" type="button" label="Newer" leading-icon="i-lucide-arrow-left" color="neutral" variant="outline" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit)" />
      <span>{{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}</span>
      <UButton class="touch-target" type="button" label="Older" trailing-icon="i-lucide-arrow-right" color="neutral" variant="outline" :disabled="offset + limit >= data.total" @click="offset += limit" />
      </div>
    </template>

    <UModal :open="Boolean(editing)" title="Edit purchase" :dismissible="!saving" :close="!saving" @update:open="!$event && closeEdit()">
      <template #body>
        <form v-if="editing" id="edit-purchase-form" class="edit-dialog grid gap-4 max-h-[calc(100dvh-2.5rem)] w-[min(40.625rem,100%)] overflow-auto p-7 border border-line rounded-card bg-surface shadow-(--shadow) max-sm:p-[1.375rem]" @submit.prevent="saveEdit">
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Date" name="edit-date" required class="field relative grid min-w-0 gap-[0.4375rem]">
              <UInput id="edit-date" v-model="editing.purchasedOn" type="date" required />
            </UFormField>
            <UFormField label="Store" name="edit-store" required class="field relative grid min-w-0 gap-[0.4375rem]">
              <UInputMenu id="edit-store" v-model="editing.location" :items="(stores || []).map(store => store.name)" create-item placeholder="Choose or add a store…" required />
            </UFormField>
          </div>
          <UFormField label="Item" name="edit-item" required class="field relative grid min-w-0 gap-[0.4375rem]">
            <UInput id="edit-item" v-model="editing.item" type="text" required />
          </UFormField>
          <div class="grid grid-cols-3 gap-4">
            <UFormField label="Size" name="edit-size" class="field relative grid min-w-0 gap-[0.4375rem]">
              <UInput id="edit-size" v-model="editingSize" type="number" step="any" inputmode="decimal" />
            </UFormField>
            <UFormField label="Unit" name="edit-unit" class="field relative grid min-w-0 gap-[0.4375rem]"><UnitInput id="edit-unit" v-model="editing.unit" /></UFormField>
            <UFormField label="Price" name="edit-price" required class="field relative grid min-w-0 gap-[0.4375rem]">
              <UInput id="edit-price" v-model="editing.price" type="number" min="0" step="0.01" inputmode="decimal" required />
            </UFormField>
          </div>
          <div class="flex flex-wrap gap-2.5">
            <UCheckbox v-model="editing.saleItem" label="Sale item" :ui="{ label: 'cursor-pointer' }" />
            <UCheckbox v-model="editing.nonGrocery" label="Non-grocery" :ui="{ label: 'cursor-pointer' }" />
          </div>
          <UFormField label="Notes" name="edit-notes" class="field relative grid min-w-0 gap-[0.4375rem]">
            <UTextarea id="edit-notes" v-model="editingNotes" :rows="3" :maxlength="maxEntryNotesLength" aria-describedby="edit-notes-character-count" :ui="{ trailing: 'pointer-events-none' }">
              <template #trailing>
                <span id="edit-notes-character-count" class="text-xs text-muted tabular-nums" aria-live="polite" role="status">{{ editingNotes.length }}/{{ maxEntryNotesLength }}</span>
              </template>
            </UTextarea>
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
