<script setup lang="ts">
import { normalizeUnit } from '../../shared/utils/units'
import { maxEntryNotesLength } from '../../shared/utils/entry-notes'

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

const purchasedOnStorageKey = 'receipt-box:purchased-on'

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
        price: Number(form.price)
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
  <UForm :state="form" class="entry-form p-[clamp(22px,3vw,36px)]" @submit="save">
    <div class="form-heading">
      <div>
        <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">New price</p>
        <h1 class="leading-1.04 text-[clamp(34px,3.5vw,42px)]">Add a purchase</h1>
      </div>
      <UFormField label="Date" name="purchasedOn" required class="date-field grid gap-[5px] text-xs font-bold text-(--muted)">
        <UInput v-model="form.purchasedOn" type="date" required size="lg" />
      </UFormField>
    </div>

    <UFormField label="Item" name="item" required help="Choose a suggestion or press Enter to add a new item." class="field item-field relative mt-[30px] grid min-w-0 gap-[7px]">
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

    <p v-if="selectedHistory" class="history-hint m-[10px_0_-7px] text-[13px] text-(--muted)">
      Last paid <strong>${{ Number(selectedHistory.price).toFixed(2) }}</strong>
      <span v-if="selectedHistory.lastUsed"> on {{ String(selectedHistory.lastUsed).slice(0, 10) }}</span>.
    </p>

    <div class="form-grid mt-5 grid grid-cols-2 gap-4">
      <UFormField label="Store" name="location" required class="field relative grid min-w-0 gap-[7px]">
        <UInputMenu id="location" v-model="form.location" :items="locationSuggestions.map(suggestion => suggestion.value)" create-item icon="i-lucide-store" placeholder="Choose or add a store…" required />
      </UFormField>
      <UFormField label="Price" name="price" required class="field price-field relative grid min-w-0 gap-[7px]">
        <UInput id="price" v-model="form.price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" icon="i-lucide-dollar-sign" required />
      </UFormField>
    </div>

    <div class="form-grid size-grid mt-5 grid grid-cols-[1fr_.75fr_1fr] items-end gap-4">
      <UFormField label="Package size" name="size" class="field relative grid min-w-0 gap-[7px]">
        <UInput id="size" v-model="form.size" type="number" min="0" step="any" inputmode="decimal" />
      </UFormField>
      <UFormField label="Unit" name="unit" class="field relative grid min-w-0 gap-[7px]">
        <UnitInput id="unit" v-model="form.unit" />
      </UFormField>
      <div v-if="normalizedCost !== null" class="cost-preview flex min-h-13 items-center justify-between rounded-xl px-3.5 py-2 text-(--accent-strong) [background:var(--accent-soft)]" aria-live="polite">
        <span>{{ ['g', 'mL'].includes(normalizedUnit || '') ? `Per 100 ${normalizedUnit}` : normalizedUnit === 'ea' ? 'Each' : `Per ${normalizedUnit || 'unit'}` }}</span>
        <strong>${{ normalizedCost.toFixed(2) }}</strong>
      </div>
    </div>

    <div class="ui-switches mt-[22px] flex flex-wrap gap-x-6 gap-y-4">
      <USwitch v-model="form.saleItem" label="Sale item" />
      <USwitch v-model="form.nonGrocery" label="Non-grocery" />
    </div>

    <UCollapsible class="more-fields mt-5 [border-top:1px_solid_var(--line)]">
      <UButton class="touch-target" label="More details" color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" size="sm" />
      <template #content>
        <div class="form-grid details-grid mt-3.5 grid w-full gap-4">
          <UFormField label="Notes" name="notes" class="field relative grid min-w-0 gap-[7px]">
            <UInput id="notes" v-model="form.notes" type="text" placeholder="Optional" :maxlength="maxEntryNotesLength" aria-describedby="notes-character-count" :ui="{ trailing: 'pointer-events-none' }">
              <template #trailing>
                <span id="notes-character-count" class="text-xs text-muted tabular-nums" aria-live="polite" role="status">{{ form.notes.length }}/{{ maxEntryNotesLength }}</span>
              </template>
            </UInput>
          </UFormField>
        </div>
      </template>
    </UCollapsible>

    <UAlert v-if="errorMessage" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorMessage" class="notice m-[15px_0_0] rounded-[10px] p-[11px_13px] text-sm" />
    <UAlert v-if="savedMessage" color="success" variant="soft" icon="i-lucide-circle-check" :description="savedMessage" class="notice m-[15px_0_0] rounded-[10px] p-[11px_13px] text-sm" />

    <UButton class="save-button mt-[22px] min-h-[57px] w-full text-base" type="submit" block size="xl" icon="i-lucide-plus" :loading="saving" label="Save & add another" />
  </UForm>
</template>
