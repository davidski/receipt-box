<script setup lang="ts">
import { normalizeUnit } from '../../shared/utils/units'
import {
  receiptLineIsComplete,
  receiptLineSaveSnapshot,
  shouldLoadMatchingReceipt,
  type ReceiptSaveSummary
} from '../utils/receipt-merge'
import { entryCsv } from '../utils/csv-export'

type Suggestion = {
  value: string
  size?: string | null
  unit?: string | null
  price?: string | null
  lastUsed?: string
}

type ReceiptLine = {
  id?: string
  key: number
  item: string
  price: string
  size: string
  unit: string
  saleItem: boolean
  nonGrocery: boolean
  notes: string
  expanded: boolean
  itemMenuOpen: boolean
  searchTerm: string
  suggestions: Suggestion[]
  request: number
  backfillKey: string
  backfillChecking: boolean
  timer?: ReturnType<typeof setTimeout>
}

type PendingBackfill = {
  lineKey: number
  entryId: string
  item: string
  size: string
  unit: string | null
  counts: { size: number, unit: number, either: number }
}

type EditableReceipt = {
  id: string
  purchasedOn: string
  location: string
  itemCount: number
  total: string
  entries: Array<{
    id: string
    item: string
    price: string
    size: string | null
    unit: string | null
    saleItem: boolean
    nonGrocery: boolean
    notes: string | null
  }>
}

type MatchingReceipt = EditableReceipt
type SavedEntry = EditableReceipt['entries'][number] & {
  receiptId: string
  purchasedOn: string
  location: string
}

const props = defineProps<{
  initialDate?: string
  initialLocation?: string
}>()
const emit = defineEmits<{
  dirtyChange: [dirty: boolean]
}>()

const { apiUrl } = useApi()
const saving = ref(false)
const confirmingDelete = ref(false)
const errorMessage = ref('')
const locationSuggestions = ref<Suggestion[]>([])
const matchingReceipt = ref<MatchingReceipt | null>(null)
const checkingReceiptMatch = ref(false)
const currentReceiptId = ref<string | null>(null)
const lastSavedSummary = ref<ReceiptSaveSummary | null>(null)
const confirmedReceiptKey = ref<{ purchasedOn: string, location: string } | null>(null)
const pendingBackfill = ref<PendingBackfill | null>(null)
const backfillBusy = ref(false)
const backfillSizeSelected = ref(false)
const backfillUnitSelected = ref(false)
const savedLineSnapshots = reactive(new Map<number, string>())
let nextKey = 1
let matchRequest = 0
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
const hasReceipt = computed(() => Boolean(currentReceiptId.value))

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const purchasedOnStorageKey = 'pantry-pricebook:purchased-on'

function initialPurchasedOn() {
  if (import.meta.client) {
    try {
      const storedDate = localStorage.getItem(purchasedOnStorageKey)
      if (storedDate && /^\d{4}-\d{2}-\d{2}$/.test(storedDate)) return storedDate
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }
  return localDate()
}

function blankLine(): ReceiptLine {
  return {
    key: nextKey++, item: '', price: '', size: '', unit: '', saleItem: false,
    nonGrocery: false, notes: '', expanded: false, itemMenuOpen: false, searchTerm: '', suggestions: [], request: 0, backfillKey: '', backfillChecking: false
  }
}

function dimensionBackfillKey(item: string, size: string, unit: string | null) {
  return size || unit ? `${item.trim()}\u001f${size}\u001f${unit ?? ''}` : ''
}

function lineFromEntry(entry: EditableReceipt['entries'][number]): ReceiptLine {
  const size = compactNumber(entry.size)
  const unit = entry.unit ?? ''
  return {
    id: entry.id,
    key: nextKey++,
    item: entry.item,
    price: Number(entry.price).toFixed(2),
    size,
    unit,
    saleItem: entry.saleItem,
    nonGrocery: entry.nonGrocery,
    notes: entry.notes ?? '',
    expanded: Boolean(entry.notes || entry.nonGrocery),
    itemMenuOpen: false,
    searchTerm: '',
    suggestions: [],
    request: 0,
    backfillKey: '',
    backfillChecking: false
  }
}

const form = reactive({
  purchasedOn: initialPurchasedOn(),
  location: '',
  lines: [blankLine()]
})

function lineHasContent(line: ReceiptLine) {
  return Boolean(
    line.id || line.item.trim() || line.price !== '' || line.size !== '' || line.unit.trim()
    || line.saleItem || line.nonGrocery || line.notes.trim()
  )
}

function lineSnapshot(line: ReceiptLine) {
  return receiptLineSaveSnapshot(form.purchasedOn, form.location, line)
}

function exportReceiptCsv() {
  const rows = completeLines.value.map(line => [
    form.purchasedOn,
    line.item.trim(),
    form.location.trim(),
    line.size === '' ? null : Number(line.size),
    normalizeUnit(line.unit),
    Number(line.price),
    null,
    null,
    line.saleItem,
    line.nonGrocery,
    line.notes.trim() || null
  ])
  if (!rows.length || !import.meta.client) return

  const blob = new Blob([entryCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const store = form.location.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'receipt'
  anchor.href = url
  anchor.download = `receipt-box-${form.purchasedOn}-${store}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

const enteredLines = computed(() => form.lines.filter(lineHasContent))
const completeLines = computed(() => enteredLines.value.filter(receiptLineIsComplete))
const incompleteLines = computed(() => enteredLines.value.filter(line => !receiptLineIsComplete(line)))
const hasBlankLine = computed(() => form.lines.some(line => !lineHasContent(line)))
const hasUnsavedChanges = computed(() => enteredLines.value.some(line => (
  !receiptLineIsComplete(line) || savedLineSnapshots.get(line.key) !== lineSnapshot(line)
)))
const canEnterLines = computed(() => Boolean(form.location.trim()) && (
  !checkingReceiptMatch.value || hasReceipt.value || enteredLines.value.length > 0
))
const storeError = computed(() => !form.location.trim() && enteredLines.value.length > 0
  ? 'Select a store to save this receipt'
  : undefined)
const receiptTotal = computed(() => completeLines.value.reduce((sum, line) => sum + Number(line.price), 0))
const autosaveStatus = computed(() => {
  if (saving.value) return 'Saving changes…'
  if (incompleteLines.value.length) {
    return `${incompleteLines.value.length} unsaved ${incompleteLines.value.length === 1 ? 'row' : 'rows'} in progress`
  }
  if (hasUnsavedChanges.value) return 'Changes waiting to save…'
  if (currentReceiptId.value) return 'All changes saved'
  return 'Complete a row to save it'
})

function loadReceipt(receipt: EditableReceipt) {
  form.purchasedOn = receipt.purchasedOn
  form.location = receipt.location
  form.lines = receipt.entries.map(lineFromEntry)
  if (!form.lines.length) form.lines = [blankLine()]
  currentReceiptId.value = receipt.id
  lastSavedSummary.value = {
    id: receipt.id,
    purchasedOn: receipt.purchasedOn,
    location: receipt.location,
    itemCount: receipt.itemCount,
    total: receipt.total
  }
  confirmedReceiptKey.value = { purchasedOn: receipt.purchasedOn, location: receipt.location }
  savedLineSnapshots.clear()
  for (const line of form.lines) {
    if (line.id) savedLineSnapshots.set(line.key, lineSnapshot(line))
  }
}

watch(() => [props.initialDate, props.initialLocation] as const, ([initialDate, initialLocation]) => {
  clearTimeout(autosaveTimer)
  form.lines.forEach(line => clearTimeout(line.timer))
  savedLineSnapshots.clear()
  form.purchasedOn = /^\d{4}-\d{2}-\d{2}$/.test(initialDate || '') ? initialDate! : initialPurchasedOn()
  form.location = initialLocation?.trim() || ''
  form.lines = [blankLine()]
  currentReceiptId.value = null
  lastSavedSummary.value = null
  confirmedReceiptKey.value = null
  errorMessage.value = ''
  confirmingDelete.value = false
}, { immediate: true })

watch(hasUnsavedChanges, dirty => emit('dirtyChange', dirty), { immediate: true })

watch(() => form.purchasedOn, (purchasedOn) => {
  if (!import.meta.client || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) return
  try {
    localStorage.setItem(purchasedOnStorageKey, purchasedOn)
  } catch {
    // Keep the in-memory date sticky even when browser storage is unavailable.
  }
})

const matchingReceiptMessage = computed(() => {
  if (!matchingReceipt.value) return ''
  const existingItems = `${matchingReceipt.value.itemCount} ${matchingReceipt.value.itemCount === 1 ? 'item' : 'items'}`
  return `A receipt already exists for this store and date with ${existingItems}. Changes will combine both receipts and keep every line.`
})

watch([
  () => form.purchasedOn,
  () => form.location,
  () => currentReceiptId.value
], async ([purchasedOn, location, receiptId]) => {
  const request = ++matchRequest
  clearTimeout(autosaveTimer)
  matchingReceipt.value = null
  const normalizedLocation = String(location ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(purchasedOn)) || !normalizedLocation) {
    checkingReceiptMatch.value = false
    return
  }
  checkingReceiptMatch.value = true
  try {
    const result = await $fetch<{ receipt: MatchingReceipt | null }>(apiUrl('/receipts/match'), {
      query: { date: purchasedOn, location: normalizedLocation, excludeId: receiptId || undefined }
    })
    if (request !== matchRequest) return
    if (result.receipt && receiptId) {
      const existingItems = `${result.receipt.itemCount} ${result.receipt.itemCount === 1 ? 'item' : 'items'}`
      const mergeConfirmed = window.confirm(
        `A receipt already exists for ${normalizedLocation} on ${purchasedOn} with ${existingItems}. Merge this receipt into it?`
      )
      if (!mergeConfirmed) {
        const confirmedKey = confirmedReceiptKey.value
        if (confirmedKey) {
          form.purchasedOn = confirmedKey.purchasedOn
          form.location = confirmedKey.location
        }
        return
      }
      matchingReceipt.value = result.receipt
    } else if (result.receipt && shouldLoadMatchingReceipt(currentReceiptId.value, enteredLines.value.length)) {
      loadReceipt(result.receipt)
      matchingReceipt.value = null
    } else {
      matchingReceipt.value = result.receipt
    }
  } catch {
    if (request === matchRequest) {
      matchingReceipt.value = null
      if (receiptId && confirmedReceiptKey.value) {
        form.purchasedOn = confirmedReceiptKey.value.purchasedOn
        form.location = confirmedReceiptKey.value.location
        errorMessage.value = 'Could not check for an existing receipt. The date and store were restored.'
      }
    }
  } finally {
    if (request === matchRequest) {
      checkingReceiptMatch.value = false
      scheduleAutosave()
    }
  }
}, { immediate: true })

watch(() => JSON.stringify({
  purchasedOn: form.purchasedOn,
  location: form.location,
  lines: form.lines.map(line => ({ key: line.key, id: line.id, value: lineSnapshot(line) }))
}), () => scheduleAutosave())

watch(() => form.location, (location, previousLocation) => {
  if (previousLocation.trim() || !location.trim() || enteredLines.value.length) return
  nextTick(() => document.querySelector<HTMLInputElement>('[data-line-item]')?.focus())
})

function itemOptions(line: ReceiptLine) {
  return line.suggestions.map(suggestion => ({
    label: suggestion.value,
    value: suggestion.value,
    onSelect: () => chooseItem(line, suggestion),
    description: [
      suggestion.size ? `${Number(suggestion.size).toLocaleString()} ${suggestion.unit || ''}`.trim() : suggestion.unit,
      suggestion.price ? `last $${Number(suggestion.price).toFixed(2)}` : null
    ].filter(Boolean).join(' · ')
  }))
}

function compactNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : value
}

async function loadLocations() {
  try {
    locationSuggestions.value = await $fetch(apiUrl('/suggestions'), { query: { field: 'location', limit: 20 } })
  } catch {
    locationSuggestions.value = []
  }
}

function createLocation(value: string | { value: string }) {
  form.location = (typeof value === 'string' ? value : value.value).trim()
}

function confirmDiscardChanges() {
  return !hasUnsavedChanges.value || window.confirm('Discard this unsaved receipt? Your changes will be lost.')
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => confirmDiscardChanges())

onMounted(() => {
  loadLocations()
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  clearTimeout(autosaveTimer)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  form.lines.forEach(line => clearTimeout(line.timer))
})

function searchItems(line: ReceiptLine, value: string) {
  line.searchTerm = value
  clearTimeout(line.timer)
  const search = value.trim()
  const request = ++line.request
  if (!search) {
    line.suggestions = []
    return
  }
  line.timer = setTimeout(async () => {
    try {
      const suggestions = await $fetch<Suggestion[]>(apiUrl('/suggestions'), {
        query: { field: 'item', q: search, limit: 8 }
      })
      if (request === line.request) line.suggestions = suggestions
    } catch {
      if (request === line.request) line.suggestions = []
    }
  }, 160)
}

function chooseItem(line: ReceiptLine, suggestion: Suggestion) {
  line.item = suggestion.value
  line.size = compactNumber(suggestion.size)
  line.unit = suggestion.unit ?? ''
  line.itemMenuOpen = false
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
}

function createItem(line: ReceiptLine, value: string | { value: string }) {
  line.item = (typeof value === 'string' ? value : value.value).trim()
  line.itemMenuOpen = false
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
}

function closeItemMenu(line: ReceiptLine) {
  line.itemMenuOpen = false
}

function formatPrice(line: ReceiptLine) {
  if (line.price === '') return
  const price = Number(line.price)
  if (Number.isFinite(price) && price >= 0) line.price = price.toFixed(2)
}

function addLine(focus = true) {
  const existingBlank = form.lines.find(line => !lineHasContent(line))
  if (existingBlank) {
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${existingBlank.key}"]`)?.focus())
    return
  }
  const line = blankLine()
  form.lines.push(line)
  if (focus) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${line.key}"]`)?.focus())
}

function finishLine(line: ReceiptLine) {
  formatPrice(line)
  if (!line.item.trim()) {
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${line.key}"]`)?.focus())
    return
  }
  if (!receiptLineIsComplete(line)) {
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
    return
  }
  const index = form.lines.indexOf(line)
  if (index === form.lines.length - 1) addLine()
  else requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${form.lines[index + 1]!.key}"]`)?.focus())
}

function focusLineSize(line: ReceiptLine) {
  formatPrice(line)
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-size="${line.key}"]`)?.focus())
}

function focusLineUnit(line: ReceiptLine) {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-unit="${line.key}"]`)?.focus())
}

function entryBody(line: ReceiptLine) {
  return {
    purchasedOn: form.purchasedOn,
    location: form.location,
    item: line.item,
    price: line.price,
    size: line.size || null,
    unit: normalizeUnit(line.unit),
    saleItem: line.saleItem,
    nonGrocery: line.nonGrocery,
    notes: line.notes
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer)
  if (saving.value || checkingReceiptMatch.value || pendingBackfill.value) return
  const validHeader = /^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn) && Boolean(form.location.trim())
  const dirtyCompleteLines = completeLines.value.filter(line => savedLineSnapshots.get(line.key) !== lineSnapshot(line))
  if (!validHeader || !dirtyCompleteLines.length) return
  autosaveTimer = setTimeout(() => saveCompletedRows(), 600)
}

async function offerItemBackfill(line: ReceiptLine) {
  const size = String(line.size ?? '').trim()
  const unit = normalizeUnit(line.unit)
  if (!line.id || (!size && !unit)) return false
  const key = dimensionBackfillKey(line.item, size, unit)
  if (line.backfillKey === key || line.backfillChecking || pendingBackfill.value) return false
  line.backfillChecking = true
  try {
    const counts = await $fetch<{ size: number, unit: number, either: number }>(apiUrl('/items/backfill'), {
      query: { item: line.item.trim(), excludeId: line.id }
    })
    line.backfillKey = key
    const hasEligibleEntries = (Boolean(size) && counts.size > 0) || (Boolean(unit) && counts.unit > 0)
    if (!hasEligibleEntries) return false
    backfillSizeSelected.value = Boolean(size) && counts.size > 0
    backfillUnitSelected.value = Boolean(unit) && counts.unit > 0
    pendingBackfill.value = {
      lineKey: line.key,
      entryId: line.id,
      item: line.item.trim(),
      size,
      unit,
      counts
    }
    return true
  } finally {
    line.backfillChecking = false
  }
}

function backfillDescription(pending: PendingBackfill) {
  return `Choose which new values to add to earlier purchases of ${pending.item}.`
}

const selectedBackfillFields = computed<Array<'size' | 'unit'>>(() => [
  ...(backfillSizeSelected.value ? ['size' as const] : []),
  ...(backfillUnitSelected.value ? ['unit' as const] : [])
])

const selectedBackfillCount = computed(() => {
  const pending = pendingBackfill.value
  if (!pending) return 0
  if (backfillSizeSelected.value && backfillUnitSelected.value) return pending.counts.either
  if (backfillSizeSelected.value) return pending.counts.size
  if (backfillUnitSelected.value) return pending.counts.unit
  return 0
})

function unitFieldIsFocused(line: ReceiptLine) {
  return import.meta.client && document.activeElement?.matches(`[data-line-unit="${line.key}"]`)
}

async function checkItemBackfillOnUnitExit(line: ReceiptLine) {
  if (saving.value) return
  try {
    await offerItemBackfill(line)
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not check previous entries'
  }
}

async function resolveItemBackfill(fields: Array<'size' | 'unit'>) {
  const pending = pendingBackfill.value
  if (!pending) return
  if (fields.length) {
    backfillBusy.value = true
    errorMessage.value = ''
    try {
      await $fetch(apiUrl('/items/backfill'), {
        method: 'PATCH',
        body: {
          item: pending.item,
          excludeId: pending.entryId,
          size: pending.size,
          unit: pending.unit,
          fields
        }
      })
    } catch (error: any) {
      errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not update previous entries'
      backfillBusy.value = false
      return
    }
    backfillBusy.value = false
  }
  pendingBackfill.value = null
  scheduleAutosave()
}

async function loadCurrentReceiptSummary() {
  if (!currentReceiptId.value) return null
  const result = await $fetch<{ receipt: MatchingReceipt | null }>(apiUrl('/receipts/match'), {
    query: { date: form.purchasedOn, location: form.location }
  })
  if (!result.receipt || result.receipt.id !== currentReceiptId.value) return null
  const summary: ReceiptSaveSummary = {
    ...result.receipt,
    purchasedOn: form.purchasedOn,
    location: form.location
  }
  lastSavedSummary.value = summary
  return summary
}

async function saveCompletedRows() {
  if (saving.value) return
  const rows = completeLines.value.filter(line => savedLineSnapshots.get(line.key) !== lineSnapshot(line))
  if (!rows.length || !/^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn) || !form.location.trim()) return

  saving.value = true
  errorMessage.value = ''
  try {
    for (const line of rows) {
      const snapshot = lineSnapshot(line)
      const saved = await $fetch<SavedEntry>(apiUrl(line.id ? `/entries/${line.id}` : '/entries'), {
        method: line.id ? 'PUT' : 'POST',
        body: entryBody(line)
      })
      line.id = saved.id
      currentReceiptId.value = saved.receiptId
      savedLineSnapshots.set(line.key, snapshot)
      if (!unitFieldIsFocused(line) && await offerItemBackfill(line)) break
    }

    confirmedReceiptKey.value = { purchasedOn: form.purchasedOn, location: form.location }
    await loadCurrentReceiptSummary()
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not save these changes'
  } finally {
    saving.value = false
    scheduleAutosave()
  }
}

async function removeLine(line: ReceiptLine) {
  if (saving.value) return
  clearTimeout(line.timer)
  if (line.id) {
    saving.value = true
    errorMessage.value = ''
    try {
      await $fetch(apiUrl(`/entries/${line.id}`), { method: 'DELETE' })
      savedLineSnapshots.delete(line.key)
    } catch (error: any) {
      errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not delete this row'
      saving.value = false
      return
    }
    saving.value = false
  }

  const index = form.lines.indexOf(line)
  if (form.lines.length === 1) Object.assign(line, blankLine(), { key: line.key })
  else form.lines.splice(index, 1)

  const remainingSavedRows = form.lines.filter(candidate => candidate.id)
  if (!remainingSavedRows.length) {
    currentReceiptId.value = null
    lastSavedSummary.value = null
    confirmedReceiptKey.value = null
  } else {
    await loadCurrentReceiptSummary()
  }
  scheduleAutosave()
}

async function deleteReceipt() {
  if (!currentReceiptId.value || !confirmingDelete.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch(apiUrl(`/receipts/${currentReceiptId.value}`), { method: 'DELETE' })
    savedLineSnapshots.clear()
    currentReceiptId.value = null
    lastSavedSummary.value = null
    form.lines = [blankLine()]
    confirmingDelete.value = false
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not delete this receipt'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="receipt-entry-form" @submit.prevent>
    <header class="receipt-entry-heading">
      <div>
        <p class="eyebrow">Shopping trip editor</p>
        <h1>Add or edit a receipt</h1>
        <p>Select an existing date and store to edit.</p>
      </div>
      <div class="receipt-meta-fields">
        <UFormField label="Date" name="purchasedOn" required class="field date-field">
          <UInput v-model="form.purchasedOn" type="date" required size="lg" />
        </UFormField>
        <UFormField label="Store" name="location" required class="field receipt-store-field" :error="storeError">
          <UInputMenu v-model="form.location" :items="locationSuggestions.map(suggestion => suggestion.value)" create-item icon="i-lucide-store" placeholder="Choose or add a store…" required size="lg" @create="createLocation" />
        </UFormField>
      </div>
    </header>

    <div v-if="canEnterLines" class="receipt-line-labels">
      <span>Item</span><span>Price</span><span>Size</span><span>Unit</span><span>Options</span>
      <UPopover>
        <UButton type="button" icon="i-lucide-circle-help" color="neutral" variant="ghost" aria-label="Keyboard entry help" title="Keyboard entry help" />
        <template #content>
          <div class="receipt-keyboard-help">
            <strong>Keyboard entry</strong>
            <p><kbd>Enter</kbd> accepts an item, then moves through Price, Size, and Unit. From Unit, it starts the next row.</p>
            <p><kbd>⌘ Enter</kbd> on Mac or <kbd>Ctrl Enter</kbd> elsewhere finishes the row from any field.</p>
            <p>Item and Price are required. Size and Unit are optional.</p>
          </div>
        </template>
      </UPopover>
    </div>

    <ol v-if="canEnterLines" class="receipt-entry-lines">
      <li v-for="(line, index) in form.lines" :key="line.key" class="receipt-entry-line">
        <span class="receipt-line-number" :aria-label="`Line ${index + 1}`">{{ index + 1 }}</span>
        <UFormField :name="`item-${line.key}`" class="field receipt-line-item">
          <span class="mobile-field-label">Item</span>
          <UInputMenu
            v-model="line.item"
            v-model:open="line.itemMenuOpen"
            v-model:search-term="line.searchTerm"
            :data-line-item="line.key"
            :items="itemOptions(line)"
            value-key="value"
            :create-item="{ when: 'always', position: 'top' }"
            ignore-filter
            placeholder="Start typing an item…"
            @update:search-term="searchItems(line, $event)"
            @create="createItem(line, $event)"
            @keydown.meta.enter.prevent="finishLine(line)"
            @keydown.ctrl.enter.prevent="finishLine(line)"
          />
        </UFormField>
        <UFormField :name="`price-${line.key}`" class="field receipt-line-price-input">
          <span class="mobile-field-label">Price</span>
          <UInput :data-line-price="line.key" v-model="line.price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" icon="i-lucide-dollar-sign" @focus="closeItemMenu(line)" @blur="formatPrice(line)" @keydown.enter.exact.prevent="focusLineSize(line)" @keydown.meta.enter.prevent="finishLine(line)" @keydown.ctrl.enter.prevent="finishLine(line)" />
        </UFormField>
        <UFormField :name="`size-${line.key}`" class="field receipt-line-size">
          <span class="mobile-field-label">Size</span>
          <UInput :data-line-size="line.key" v-model="line.size" type="number" min="0" step="any" inputmode="decimal" placeholder="—" @keydown.enter.exact.prevent="focusLineUnit(line)" @keydown.meta.enter.prevent="finishLine(line)" @keydown.ctrl.enter.prevent="finishLine(line)" />
        </UFormField>
        <UFormField :name="`unit-${line.key}`" class="field receipt-line-unit">
          <span class="mobile-field-label">Unit</span>
          <UnitInput :data-line-unit="line.key" v-model="line.unit" @blur="checkItemBackfillOnUnitExit(line)" @commit="finishLine(line)" @keydown.meta.enter.prevent="finishLine(line)" @keydown.ctrl.enter.prevent="finishLine(line)" />
        </UFormField>
        <div class="receipt-line-options">
          <UButton
            type="button"
            icon="i-lucide-tag"
            :aria-label="line.saleItem ? 'Remove sale-price flag' : 'Mark as purchased at a sale price'"
            :title="line.saleItem ? 'Purchased at a sale price. Click to remove.' : 'Mark as purchased at a sale price.'"
            :color="line.saleItem ? 'warning' : 'neutral'"
            :variant="line.saleItem ? 'soft' : 'ghost'"
            @click="line.saleItem = !line.saleItem"
          />
          <UButton type="button" icon="i-lucide-ellipsis" :aria-label="line.expanded ? 'Hide details' : 'Show details'" color="neutral" :variant="line.expanded ? 'soft' : 'ghost'" :aria-expanded="line.expanded" @click="line.expanded = !line.expanded" />
        </div>
        <UButton class="receipt-line-remove" type="button" icon="i-lucide-x" :aria-label="`Remove line ${index + 1}`" color="neutral" variant="ghost" :disabled="saving" @click="removeLine(line)" />
        <div v-if="line.expanded" class="receipt-line-details">
          <UFormField label="Notes" :name="`notes-${line.key}`" class="field">
            <UInput v-model="line.notes" placeholder="Optional note" />
          </UFormField>
          <USwitch v-model="line.nonGrocery" label="Non-grocery" />
        </div>
      </li>
    </ol>

    <UButton v-if="canEnterLines" type="button" label="Add another line" icon="i-lucide-plus" color="neutral" variant="outline" class="receipt-add-line" :disabled="hasBlankLine" @click="addLine()" />

    <div v-else class="receipt-store-prompt">
      <UIcon name="i-lucide-store" class="receipt-store-prompt-icon" aria-hidden="true" />
      <p v-if="checkingReceiptMatch"><strong>Checking for a receipt</strong><span>Looking for existing lines for this date and store.</span></p>
      <p v-else><strong>Choose or add a store</strong><span>Select a store to add or edit a receipt.</span></p>
    </div>

    <footer v-if="canEnterLines" class="receipt-entry-footer">
      <div v-if="hasReceipt && confirmingDelete" class="receipt-delete-confirmation" role="alert">
        <div class="receipt-delete-copy">
          <strong>Delete this receipt?</strong>
          <span>All {{ enteredLines.length }} {{ enteredLines.length === 1 ? 'entry' : 'entries' }} will be permanently deleted.</span>
        </div>
        <UButton type="button" size="xl" label="Keep receipt" color="neutral" variant="outline" :disabled="saving" @click="confirmingDelete = false" />
        <UButton type="button" size="xl" label="Delete permanently" icon="i-lucide-trash-2" color="error" :loading="saving" @click="deleteReceipt" />
      </div>
      <template v-else>
        <UButton v-if="hasReceipt" type="button" label="Delete receipt" icon="i-lucide-trash-2" color="error" variant="outline" :disabled="saving" @click="confirmingDelete = true" />
        <UButton v-if="hasReceipt" type="button" label="Export receipt" icon="i-lucide-download" color="neutral" variant="outline" :disabled="saving || !completeLines.length" @click="exportReceiptCsv" />
        <span v-if="hasReceipt" class="spacer" />
        <div class="receipt-autosave-status" role="status" aria-live="polite">
          <UIcon :name="saving || checkingReceiptMatch ? 'i-lucide-loader-circle' : hasUnsavedChanges ? 'i-lucide-pencil-line' : 'i-lucide-cloud-check'" :class="{ spinning: saving || checkingReceiptMatch }" aria-hidden="true" />
          <span>{{ autosaveStatus }}</span>
        </div>
        <div>
          <span>{{ enteredLines.length }} {{ enteredLines.length === 1 ? 'line' : 'lines' }}</span>
          <strong>${{ receiptTotal.toFixed(2) }}</strong>
        </div>
      </template>
    </footer>

    <UAlert v-if="errorMessage" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorMessage" class="notice" />
    <UAlert v-if="matchingReceiptMessage" color="warning" variant="soft" icon="i-lucide-git-merge" :description="matchingReceiptMessage" class="notice" />
  </form>

  <UModal
    :open="Boolean(pendingBackfill)"
    :dismissible="false"
    :close="false"
    title="Update previous entries?"
    :description="pendingBackfill ? backfillDescription(pendingBackfill) : ''"
  >
    <template #body>
      <div v-if="pendingBackfill" class="item-backfill-summary">
        <p class="item-backfill-proposed-label">Proposed values</p>
        <div class="item-backfill-proposed">
          <div v-if="pendingBackfill.size">
            <span>Size</span>
            <strong>{{ pendingBackfill.size }}</strong>
          </div>
          <div v-if="pendingBackfill.unit">
            <span>Unit</span>
            <strong>{{ pendingBackfill.unit }}</strong>
          </div>
        </div>
        <div class="item-backfill-choices">
          <UCheckbox
            v-if="pendingBackfill.size"
            v-model="backfillSizeSelected"
            label="Update missing sizes"
            :description="`${pendingBackfill.counts.size} previous ${pendingBackfill.counts.size === 1 ? 'entry' : 'entries'}`"
            :disabled="backfillBusy || !pendingBackfill.counts.size"
          />
          <UCheckbox
            v-if="pendingBackfill.unit"
            v-model="backfillUnitSelected"
            label="Update missing units"
            :description="`${pendingBackfill.counts.unit} previous ${pendingBackfill.counts.unit === 1 ? 'entry' : 'entries'}`"
            :disabled="backfillBusy || !pendingBackfill.counts.unit"
          />
        </div>
        <p class="item-backfill-note">Existing values will not be overwritten.</p>
      </div>
    </template>
    <template #footer>
      <div v-if="pendingBackfill" class="item-backfill-actions">
        <UButton type="button" color="neutral" variant="ghost" label="Keep unchanged" :disabled="backfillBusy" @click="resolveItemBackfill([])" />
        <UButton type="button" :label="`Update ${selectedBackfillCount} ${selectedBackfillCount === 1 ? 'entry' : 'entries'}`" :loading="backfillBusy" :disabled="!selectedBackfillFields.length" @click="resolveItemBackfill(selectedBackfillFields)" />
      </div>
    </template>
  </UModal>
</template>
