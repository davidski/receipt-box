<script setup lang="ts">
import { normalizeUnit } from '../../shared/utils/units'

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

const props = defineProps<{ receipt?: EditableReceipt | null }>()
const emit = defineEmits<{ saved: [], deleted: [], cancel: [] }>()

const { apiUrl } = useApi()
const saving = ref(false)
const errorMessage = ref('')
const savedMessage = ref('')
const locationSuggestions = ref<Suggestion[]>([])
let nextKey = 1
const isEditing = computed(() => Boolean(props.receipt?.id))

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

watch(() => props.receipt, (receipt) => {
  form.lines.forEach(line => clearTimeout(line.timer))
  if (receipt) {
    form.purchasedOn = receipt.purchasedOn
    form.location = receipt.location
    form.lines = receipt.entries.map(lineFromEntry)
  } else {
    form.purchasedOn = initialPurchasedOn()
    form.location = ''
    form.lines = [blankLine()]
  }
  errorMessage.value = ''
  savedMessage.value = ''
}, { immediate: true })

function lineHasContent(line: ReceiptLine) {
  return Boolean(
    line.item.trim() || line.price !== '' || line.size !== '' || line.unit.trim()
    || line.saleItem || line.nonGrocery || line.notes.trim()
  )
}

watch(() => form.purchasedOn, (purchasedOn) => {
  if (isEditing.value || !import.meta.client || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) return
  try {
    localStorage.setItem(purchasedOnStorageKey, purchasedOn)
  } catch {
    // Keep the in-memory date sticky even when browser storage is unavailable.
  }
})

const enteredLines = computed(() => form.lines.filter(lineHasContent))
const hasBlankLine = computed(() => form.lines.some(line => !lineHasContent(line)))
const canSaveReceipt = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn) || !form.location.trim() || !form.lines.length) return false
  return form.lines.every((line) => {
    const price = Number(line.price)
    return lineHasContent(line) && Boolean(line.item.trim()) && line.price !== '' && Number.isFinite(price) && price >= 0
  })
})
const receiptTotal = computed(() => enteredLines.value.reduce((sum, line) => {
  const price = Number(line.price)
  return sum + (Number.isFinite(price) && price >= 0 ? price : 0)
}, 0))

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

onMounted(loadLocations)

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

function removeLine(line: ReceiptLine) {
  if (form.lines.length === 1) {
    Object.assign(line, blankLine(), { key: line.key })
    return
  }
  clearTimeout(line.timer)
  form.lines.splice(form.lines.indexOf(line), 1)
}

async function saveReceipt() {
  if (!canSaveReceipt.value) {
    errorMessage.value = 'Complete the date, store, item, and price for every receipt line'
    return
  }
  saving.value = true
  errorMessage.value = ''
  savedMessage.value = ''
  try {
    const lines = enteredLines.value.map(line => ({
      id: line.id,
      item: line.item,
      price: line.price,
      size: line.size || null,
      unit: normalizeUnit(line.unit),
      saleItem: line.saleItem,
      nonGrocery: line.nonGrocery,
      notes: line.notes
    }))
    const saved = await $fetch<{ itemCount: number, total: string }>(apiUrl(isEditing.value ? `/receipts/${props.receipt!.id}` : '/receipts'), {
      method: isEditing.value ? 'PUT' : 'POST',
      body: { purchasedOn: form.purchasedOn, location: form.location, entries: lines }
    })
    if (isEditing.value) {
      emit('saved')
      return
    }
    form.lines.forEach(line => clearTimeout(line.timer))
    form.lines = [blankLine()]
    savedMessage.value = `${saved.itemCount} ${saved.itemCount === 1 ? 'item' : 'items'} saved · $${Number(saved.total).toFixed(2)}`
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-line-item]')?.focus())
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not save this receipt'
  } finally {
    saving.value = false
  }
}

async function deleteReceipt() {
  if (!props.receipt || !confirm(`Delete the entire ${form.location} receipt from ${form.purchasedOn}? This cannot be undone.`)) return
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch(apiUrl(`/receipts/${props.receipt.id}`), { method: 'DELETE' })
    emit('deleted')
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not delete this receipt'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="receipt-entry-form" @submit.prevent="saveReceipt">
    <header class="receipt-entry-heading">
      <div>
        <p class="eyebrow">{{ isEditing ? 'Correct a shopping trip' : 'New shopping trip' }}</p>
        <component :is="isEditing ? 'h2' : 'h1'">{{ isEditing ? 'Edit receipt' : 'Add a receipt' }}</component>
        <p>{{ isEditing ? 'Update, add, or remove any line on this receipt.' : 'Enter every line, then save the receipt once.' }}</p>
      </div>
      <div class="receipt-meta-fields">
        <UFormField label="Date" name="purchasedOn" required class="date-field">
          <UInput v-model="form.purchasedOn" type="date" required size="lg" />
        </UFormField>
        <UFormField label="Store" name="location" required class="field receipt-store-field">
          <UInputMenu v-model="form.location" :items="locationSuggestions.map(suggestion => suggestion.value)" create-item icon="i-lucide-store" placeholder="Choose or add a store…" required size="lg" />
        </UFormField>
      </div>
    </header>

    <div class="receipt-line-labels" aria-hidden="true">
      <span>Item</span><span>Price</span><span>Size</span><span>Unit</span><span>Options</span><span />
    </div>

    <ol class="receipt-entry-lines">
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
          <UButton type="button" icon="i-lucide-tag" :aria-label="line.saleItem ? 'Remove sale flag' : 'Mark as sale item'" :color="line.saleItem ? 'warning' : 'neutral'" :variant="line.saleItem ? 'soft' : 'ghost'" @click="line.saleItem = !line.saleItem" />
          <UButton type="button" icon="i-lucide-ellipsis" :aria-label="line.expanded ? 'Hide details' : 'Show details'" color="neutral" :variant="line.expanded ? 'soft' : 'ghost'" :aria-expanded="line.expanded" @click="line.expanded = !line.expanded" />
        </div>
        <UButton class="receipt-line-remove" type="button" icon="i-lucide-x" :aria-label="`Remove line ${index + 1}`" color="neutral" variant="ghost" @click="removeLine(line)" />
        <div v-if="line.expanded" class="receipt-line-details">
          <UFormField label="Notes" :name="`notes-${line.key}`" class="field">
            <UInput v-model="line.notes" placeholder="Optional note" />
          </UFormField>
          <USwitch v-model="line.nonGrocery" label="Non-grocery" />
        </div>
      </li>
    </ol>

    <UButton type="button" label="Add another line" icon="i-lucide-plus" color="neutral" variant="outline" class="receipt-add-line" :disabled="hasBlankLine" @click="addLine()" />

    <UAlert v-if="errorMessage" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorMessage" class="notice" />
    <UAlert v-if="savedMessage" color="success" variant="soft" icon="i-lucide-circle-check" :description="savedMessage" class="notice" />

    <footer class="receipt-entry-footer">
      <UButton v-if="isEditing" type="button" label="Delete receipt" icon="i-lucide-trash-2" color="error" variant="outline" :disabled="saving" @click="deleteReceipt" />
      <span v-if="isEditing" class="spacer" />
      <div>
        <span>{{ enteredLines.length }} {{ enteredLines.length === 1 ? 'line' : 'lines' }}</span>
        <strong>${{ receiptTotal.toFixed(2) }}</strong>
      </div>
      <UButton v-if="isEditing" type="button" size="xl" label="Cancel" color="neutral" variant="outline" :disabled="saving" @click="emit('cancel')" />
      <UButton type="submit" size="xl" icon="i-lucide-receipt-text" :loading="saving" :disabled="!canSaveReceipt" :label="isEditing ? 'Save changes' : 'Save receipt'" />
    </footer>
  </form>
</template>
