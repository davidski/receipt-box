<script setup lang="ts">
import { normalizeUnit } from '../../shared/utils/units'

type Suggestion = {
  value: string
  location?: string
  size?: string | null
  unit?: string | null
  price?: string | null
  costPerUnit?: string | null
  lastUsed?: string
}

const emit = defineEmits<{ saved: [] }>()
const { apiUrl } = useApi()
const saving = ref(false)
const errorMessage = ref('')
const savedMessage = ref('')
const itemSuggestions = ref<Suggestion[]>([])
const locationSuggestions = ref<Suggestion[]>([])
const selectedHistory = ref<Suggestion | null>(null)
const itemSearchTerm = ref('')
let suggestionTimer: ReturnType<typeof setTimeout> | undefined
let suggestionRequest = 0

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

const form = reactive({
  purchasedOn: initialPurchasedOn(),
  item: '',
  location: '',
  size: '',
  unit: '',
  price: '',
  saleItem: false,
  nonGrocery: false,
  notes: ''
})

watch(() => form.purchasedOn, (purchasedOn) => {
  if (!import.meta.client || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) return
  try {
    localStorage.setItem(purchasedOnStorageKey, purchasedOn)
  } catch {
    // Keep the in-memory date sticky even when browser storage is unavailable.
  }
})

const normalizedCost = computed(() => {
  const price = Number(form.price)
  const size = Number(form.size)
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return null
  return ['g', 'mL'].includes(normalizeUnit(form.unit) || '') ? (price / size) * 100 : price / size
})

const normalizedUnit = computed(() => normalizeUnit(form.unit))
const itemOptions = computed(() => itemSuggestions.value.map(suggestion => ({
  label: suggestion.value,
  value: suggestion.value,
  onSelect: () => chooseItem(suggestion),
  description: [
    suggestion.location,
    suggestion.size ? `${Number(suggestion.size).toLocaleString()} ${suggestion.unit || ''}`.trim() : suggestion.unit,
    suggestion.price ? `$${Number(suggestion.price).toFixed(2)}` : null
  ].filter(Boolean).join(' · ')
})))

async function loadLocations() {
  try {
    locationSuggestions.value = await $fetch(apiUrl('/suggestions'), { query: { field: 'location', limit: 20 } })
  } catch {
    locationSuggestions.value = []
  }
}

onMounted(() => {
  loadLocations()
})

function searchItems(term: string) {
  clearTimeout(suggestionTimer)
  const search = term.trim()
  const request = ++suggestionRequest
  if (!search) {
    itemSuggestions.value = []
    return
  }
  suggestionTimer = setTimeout(async () => {
    try {
      const suggestions = await $fetch<Suggestion[]>(apiUrl('/suggestions'), { query: { field: 'item', q: search, limit: 8 } })
      if (request === suggestionRequest) itemSuggestions.value = suggestions
    } catch {
      if (request === suggestionRequest) itemSuggestions.value = []
    }
  }, 160)
}

function chooseItem(suggestion: Suggestion) {
  form.item = suggestion.value
  form.location = suggestion.location ?? ''
  form.size = suggestion.size === null || suggestion.size === undefined || suggestion.size === ''
    ? ''
    : String(Number(suggestion.size))
  form.unit = suggestion.unit ?? ''
  form.price = suggestion.price ?? ''
  selectedHistory.value = suggestion
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#price')?.focus())
}

function createItem(value: string | { value: string }) {
  form.item = (typeof value === 'string' ? value : value.value).trim()
  selectedHistory.value = null
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#price')?.focus())
}

async function save() {
  saving.value = true
  errorMessage.value = ''
  savedMessage.value = ''
  try {
    await $fetch(apiUrl('/entries'), {
      method: 'POST',
      body: {
        ...form,
        unit: normalizedUnit.value,
        size: form.size || null,
        price: Number(form.price),
        costPerUnit: normalizedCost.value
      }
    })
    const savedItem = form.item
    form.item = ''
    form.size = ''
    form.unit = ''
    form.price = ''
    form.saleItem = false
    form.nonGrocery = false
    form.notes = ''
    selectedHistory.value = null
    savedMessage.value = `${savedItem} saved`
    emit('saved')
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-item-input] input')?.focus())
    setTimeout(() => { savedMessage.value = '' }, 3000)
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not save this entry'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UForm :state="form" class="entry-form" @submit="save">
    <div class="form-heading">
      <div>
        <p class="eyebrow">New price</p>
        <h1>Add a purchase</h1>
      </div>
      <UFormField label="Date" name="purchasedOn" required class="date-field">
        <UInput v-model="form.purchasedOn" type="date" required size="lg" />
      </UFormField>
    </div>

    <UFormField label="Item" name="item" required help="Choose a suggestion or press Enter to add a new item." class="field item-field">
      <UInputMenu
        id="item"
        data-item-input
        v-model="form.item"
        v-model:search-term="itemSearchTerm"
        :items="itemOptions"
        value-key="value"
        create-item
        ignore-filter
        autofocus
        icon="i-lucide-search"
        size="xl"
        placeholder="Start typing an item…"
        required
        @update:search-term="searchItems"
        @create="createItem"
      />
    </UFormField>

    <p v-if="selectedHistory" class="history-hint">
      Last paid <strong>${{ Number(selectedHistory.price).toFixed(2) }}</strong>
      <span v-if="selectedHistory.lastUsed"> on {{ String(selectedHistory.lastUsed).slice(0, 10) }}</span>.
    </p>

    <div class="form-grid two-up">
      <UFormField label="Store" name="location" required class="field">
        <UInputMenu id="location" v-model="form.location" :items="locationSuggestions.map(suggestion => suggestion.value)" create-item icon="i-lucide-store" placeholder="Choose or add a store…" required />
      </UFormField>
      <UFormField label="Price" name="price" required class="field price-field">
        <UInput id="price" v-model="form.price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" icon="i-lucide-dollar-sign" required />
      </UFormField>
    </div>

    <div class="form-grid size-grid">
      <UFormField label="Package size" name="size" class="field">
        <UInput id="size" v-model="form.size" type="number" min="0" step="any" inputmode="decimal" />
      </UFormField>
      <UFormField label="Unit" name="unit" class="field">
        <UnitInput id="unit" v-model="form.unit" />
      </UFormField>
      <div v-if="normalizedCost !== null" class="cost-preview" aria-live="polite">
        <span>{{ ['g', 'mL'].includes(normalizedUnit || '') ? `Per 100 ${normalizedUnit}` : normalizedUnit === 'ea' ? 'Each' : `Per ${normalizedUnit || 'unit'}` }}</span>
        <strong>${{ normalizedCost.toFixed(2) }}</strong>
      </div>
    </div>

    <div class="ui-switches">
      <USwitch v-model="form.saleItem" label="Sale item" />
      <USwitch v-model="form.nonGrocery" label="Non-grocery" />
    </div>

    <UCollapsible class="more-fields">
      <UButton class="touch-target" label="More details" color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" size="sm" />
      <template #content>
        <div class="form-grid details-grid">
          <UFormField label="Notes" name="notes" class="field">
            <UInput id="notes" v-model="form.notes" type="text" placeholder="Optional" />
          </UFormField>
        </div>
      </template>
    </UCollapsible>

    <UAlert v-if="errorMessage" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorMessage" class="notice" />
    <UAlert v-if="savedMessage" color="success" variant="soft" icon="i-lucide-circle-check" :description="savedMessage" class="notice" />

    <UButton class="save-button" type="submit" block size="xl" icon="i-lucide-plus" :loading="saving" label="Save & add another" />
  </UForm>
</template>
