<script setup lang="ts">
import { normalizeUnit } from '../../shared/utils/units'
import {
  receiptLineIsComplete,
  receiptLineSaveSnapshot,
  shouldLoadMatchingReceipt,
  type ReceiptSaveSummary
} from '../utils/receipt-merge'

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
  searchTerm: string
  suggestions: Suggestion[]
  request: number
  timer?: ReturnType<typeof setTimeout>
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
    nonGrocery: false, notes: '', expanded: false, searchTerm: '', suggestions: [], request: 0
  }
}

function lineFromEntry(entry: EditableReceipt['entries'][number]): ReceiptLine {
  return {
    id: entry.id,
    key: nextKey++,
    item: entry.item,
    price: Number(entry.price).toFixed(2),
    size: compactNumber(entry.size),
    unit: entry.unit ?? '',
    saleItem: entry.saleItem,
    nonGrocery: entry.nonGrocery,
    notes: entry.notes ?? '',
    expanded: Boolean(entry.notes || entry.nonGrocery),
    searchTerm: '',
    suggestions: [],
    request: 0
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
    if (result.receipt && shouldLoadMatchingReceipt(currentReceiptId.value, enteredLines.value.length)) {
      loadReceipt(result.receipt)
      matchingReceipt.value = null
    } else {
      matchingReceipt.value = result.receipt
    }
  } catch {
    if (request === matchRequest) matchingReceipt.value = null
  } finally {
    if (request === matchRequest) checkingReceiptMatch.value = false
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
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
}

function createItem(line: ReceiptLine, value: string | { value: string }) {
  line.item = (typeof value === 'string' ? value : value.value).trim()
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
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
  const index = form.lines.indexOf(line)
  if (index === form.lines.length - 1) addLine()
  else requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${form.lines[index + 1]!.key}"]`)?.focus())
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
  if (saving.value) return
  const validHeader = /^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn) && Boolean(form.location.trim())
  const dirtyCompleteLines = completeLines.value.filter(line => savedLineSnapshots.get(line.key) !== lineSnapshot(line))
  if (!validHeader || !dirtyCompleteLines.length) return
  autosaveTimer = setTimeout(() => saveCompletedRows(), 600)
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
    }

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

    <div v-if="canEnterLines" class="receipt-line-labels" aria-hidden="true">
      <span>Item</span><span>Price</span><span>Size</span><span>Unit</span><span>Options</span><span />
    </div>

    <ol v-if="canEnterLines" class="receipt-entry-lines">
      <li v-for="(line, index) in form.lines" :key="line.key" class="receipt-entry-line">
        <span class="receipt-line-number" :aria-label="`Line ${index + 1}`">{{ index + 1 }}</span>
        <UFormField :name="`item-${line.key}`" class="field receipt-line-item">
          <span class="mobile-field-label">Item</span>
          <UInputMenu
            v-model="line.item"
            :data-line-item="line.key"
            :items="itemOptions(line)"
            value-key="value"
            create-item
            ignore-filter
            placeholder="Start typing an item…"
            @update:search-term="searchItems(line, $event)"
            @create="createItem(line, $event)"
          />
        </UFormField>
        <UFormField :name="`price-${line.key}`" class="field receipt-line-price-input">
          <span class="mobile-field-label">Price</span>
          <UInput :data-line-price="line.key" v-model="line.price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" icon="i-lucide-dollar-sign" @blur="formatPrice(line)" @keydown.enter.prevent="finishLine(line)" />
        </UFormField>
        <UFormField :name="`size-${line.key}`" class="field receipt-line-size">
          <span class="mobile-field-label">Size</span>
          <UInput v-model="line.size" type="number" min="0" step="any" inputmode="decimal" placeholder="—" />
        </UFormField>
        <UFormField :name="`unit-${line.key}`" class="field receipt-line-unit">
          <span class="mobile-field-label">Unit</span>
          <UnitInput v-model="line.unit" />
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
</template>
