<script setup lang="ts">
type Suggestion = { value: string, location?: string, size?: string | null, unit?: string | null, price?: string | null }
type Line = { key: number, item: string, quantity: number | string | undefined, unit: string, options: Suggestion[] }
type CostError = 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'INCOMPATIBLE_UNIT'
type CostResult = { item: string, cost: number | null, sale: boolean, error: CostError | null }
type CostResponse = { lines: CostResult[], total: number, excluded: number }

const errorText: Record<CostError, string> = {
  NO_PRICE: 'No purchases recorded for this item.',
  NO_PACKAGE_SIZE: 'The latest purchase has no package size.',
  INCOMPATIBLE_UNIT: 'This unit can\'t be converted to the unit it was bought in.'
}

const route = useRoute()
const router = useRouter()
const { apiUrl } = useApi()
let nextKey = 0

function blankLine(): Line {
  return { key: nextKey++, item: '', quantity: undefined, unit: 'ea', options: [] }
}

// Query format: l=item|quantity|unit, repeated. The item may itself contain "|".
function parseLine(value: string): Line {
  const parts = value.split('|')
  const unit = parts.pop() || 'ea'
  const quantity = Number(parts.pop())
  const item = parts.join('|')
  return { key: nextKey++, item, quantity: quantity > 0 ? quantity : undefined, unit, options: item ? [{ value: item }] : [] }
}

const queryLines = [route.query.l].flat().filter((value): value is string => typeof value === 'string' && value.includes('|'))
const lines = ref<Line[]>(queryLines.length ? queryLines.map(parseLine) : [blankLine()])
const response = ref<CostResponse | null>(null)
const requestError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let costTimer: ReturnType<typeof setTimeout> | undefined
let searchRequest = 0
let costRequest = 0

const itemKey = (item: string) => item.trim().toLowerCase()
const isDuplicate = (line: Line, index: number) => !!line.item && lines.value.findIndex(other => itemKey(other.item) === itemKey(line.item)) < index
const sendable = computed(() => lines.value
  .filter((line, index) => line.item && !isDuplicate(line, index) && Number(line.quantity) > 0 && line.unit)
  .map(line => ({ item: line.item, quantity: Number(line.quantity), unit: line.unit })))
const results = computed(() => new Map((response.value?.lines ?? []).map(result => [itemKey(result.item), result])))

const resultFor = (line: Line, index: number) => isDuplicate(line, index) ? undefined : results.value.get(itemKey(line.item))

function currency(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)
}

function itemOptions(line: Line) {
  return line.options.map(suggestion => ({
    label: suggestion.value,
    value: suggestion.value,
    onSelect: () => { line.unit = suggestion.unit || 'ea' },
    description: [suggestion.location, suggestion.price ? `$${Number(suggestion.price).toFixed(2)}` : null].filter(Boolean).join(' · ')
  }))
}

function searchItems(line: Line, term: string) {
  clearTimeout(searchTimer)
  const search = term.trim()
  const request = ++searchRequest
  if (!search) return
  searchTimer = setTimeout(async () => {
    try {
      const suggestions = await $fetch<Suggestion[]>(apiUrl('/suggestions'), { query: { field: 'item', q: search, limit: 8 } })
      if (request === searchRequest) line.options = suggestions
    } catch {
      if (request === searchRequest) line.options = []
    }
  }, 160)
}

watch(lines, (current) => {
  const l = current.filter(line => line.item).map(line => `${line.item}|${line.quantity ?? ''}|${line.unit}`)
  router.replace({ query: l.length ? { l } : {} })
}, { deep: true })

async function loadCosts() {
  const request = ++costRequest
  try {
    const result = await $fetch<CostResponse>(apiUrl('/recipe-cost'), { method: 'POST', body: { lines: sendable.value } })
    if (request !== costRequest) return
    response.value = result
    requestError.value = ''
  } catch (error: any) {
    if (request !== costRequest) return
    response.value = null
    requestError.value = error?.data?.statusMessage || error?.message || 'Could not calculate the recipe cost.'
  }
}

watch(sendable, (current) => {
  clearTimeout(costTimer)
  if (!current.length) {
    costRequest++
    response.value = null
    requestError.value = ''
    return
  }
  costTimer = setTimeout(loadCosts, 300)
}, { deep: true, immediate: true })

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  clearTimeout(costTimer)
})
</script>

<template>
  <div class="mx-auto w-full max-w-300">
    <header class="page-heading my-[15px] mb-8">
      <h1 class="leading-[1.04] text-[clamp(34px,3.5vw,42px)]">Recipe cost</h1>
      <p>Add ingredients to price them at what you last paid.</p>
    </header>

    <UCard class="rounded-[22px] shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
      <ul class="m-0 grid list-none gap-4 p-0">
        <li v-for="(line, index) in lines" :key="line.key" data-recipe-line class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-3 max-[640.01px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <UFormField label="Item" class="max-[640.01px]:col-span-3" :error="isDuplicate(line, index) ? `${line.item} is already in this recipe` : undefined">
            <UInputMenu
              v-model="line.item"
              :items="itemOptions(line)"
              value-key="value"
              ignore-filter
              class="w-full"
              icon="i-lucide-search"
              placeholder="Start typing an item…"
              @update:search-term="searchItems(line, $event)"
            />
          </UFormField>
          <UFormField label="Quantity">
            <UInput v-model.number="line.quantity" type="number" min="0" step="any" inputmode="decimal" placeholder="0" class="w-full" />
          </UFormField>
          <UFormField label="Unit">
            <UnitInput v-model="line.unit" class="w-full" />
          </UFormField>
          <div data-recipe-cost class="flex min-h-[52px] min-w-0 items-center justify-end gap-2 self-start mt-6 text-right max-[640.01px]:col-span-2 max-[640.01px]:justify-start max-[640.01px]:text-left">
            <p v-if="resultFor(line, index)?.error" class="m-0 text-xs text-(--muted)">{{ errorText[resultFor(line, index)!.error!] }}</p>
            <template v-else-if="resultFor(line, index)">
              <strong class="text-(--accent-strong)">{{ currency(resultFor(line, index)!.cost!) }}</strong>
              <UBadge v-if="resultFor(line, index)!.sale" label="Sale" color="warning" variant="soft" />
            </template>
          </div>
          <div class="mt-6 flex min-h-[52px] items-center self-start">
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" :aria-label="`Remove ${line.item || 'line'}`" @click="lines.splice(index, 1)" />
          </div>
        </li>
      </ul>

      <UButton class="mt-4" icon="i-lucide-plus" label="Add item" color="neutral" variant="outline" @click="lines.push(blankLine())" />

      <UAlert v-if="requestError" class="mt-4" color="error" variant="soft" icon="i-lucide-circle-alert" :description="requestError" />

      <div v-if="response" data-recipe-total class="mt-6 flex items-center justify-between rounded-xl px-4 py-3 text-(--accent-strong) [background:var(--accent-soft)]" aria-live="polite">
        <span class="text-xs font-bold uppercase">Total<template v-if="response.excluded"> (partial, {{ response.excluded }} excluded)</template></span>
        <strong class="text-[22px]">{{ currency(response.total) }}</strong>
      </div>
    </UCard>
  </div>
</template>
