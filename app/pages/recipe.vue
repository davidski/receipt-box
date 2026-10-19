<script setup lang="ts">
type Suggestion = { value: string, location?: string, size?: string | null, unit?: string | null, price?: string | null }
type Line = { key: number, item: string, quantity: number | string | undefined, unit: string, options: Suggestion[] }
type CostError = 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'INCOMPATIBLE_UNIT'
type CostResult = { item: string, cost: number | null, sale: boolean, error: CostError | null, purchaseUnit?: string | null }
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
const { dragIndex, handle, rowStyle } = useLineReorder(lines)
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

function costErrorText(result: CostResult) {
  if (result.error === 'INCOMPATIBLE_UNIT' && result.purchaseUnit) {
    return `This unit can't be converted to ${result.purchaseUnit}, the unit of the latest purchase.`
  }
  return result.error ? errorText[result.error] : ''
}

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

    <UCard :ui="{ body: 'p-0 sm:p-0' }" class="overflow-hidden rounded-[24px] shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
      <div data-recipe-headers aria-hidden="true" class="grid grid-cols-[minmax(230px,2fr)_120px_130px_minmax(180px,1fr)_40px] items-center gap-2.5 p-[12px_24px_10px_54px] text-[11px] font-[750] tracking-[.08em] text-(--muted) uppercase [background:var(--surface-muted)] max-[900.01px]:hidden">
        <span>Item</span><span>Quantity</span><span>Unit</span><span class="text-right">Cost</span><span />
      </div>
      <ul class="m-0 grid list-none p-0 max-[900.01px]:gap-3 max-[900.01px]:p-3">
        <li v-for="(line, index) in lines" :key="line.key" data-recipe-line :style="rowStyle(index)" :class="dragIndex === index ? 'z-10 bg-(--accent-soft) shadow-lg' : 'transition-transform duration-150 motion-reduce:transition-none'" class="relative grid grid-cols-[minmax(230px,2fr)_120px_130px_minmax(180px,1fr)_40px] items-start gap-2.5 p-[12px_24px_12px_54px] [border-top:1px_solid_var(--line)] max-[900.01px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] max-[900.01px]:rounded-[16px] max-[900.01px]:p-[42px_14px_14px] max-[900.01px]:[border:1px_solid_var(--line)] max-[640.01px]:grid-cols-2">
          <UButton v-bind="handle(index, line.item)" color="neutral" variant="ghost" :class="dragIndex === index ? 'cursor-grabbing' : 'cursor-grab'" class="group absolute left-4 top-5 size-6 touch-none select-none justify-center rounded-lg bg-(--surface-muted) p-0 text-xs font-bold text-(--muted) max-[900.01px]:left-3 max-[900.01px]:top-3">
            <span :class="dragIndex === index ? 'hidden' : 'group-hover:hidden group-focus-visible:hidden'">{{ index + 1 }}</span>
            <UIcon name="i-lucide-grip-vertical" :class="dragIndex === index ? 'block' : 'hidden group-hover:block group-focus-visible:block'" class="size-4" aria-hidden="true" />
          </UButton>
          <UFormField label="Item" :ui="{ label: 'sr-only max-[900.01px]:not-sr-only' }" class="min-w-0 max-[900.01px]:col-span-3 max-[640.01px]:col-span-2" :error="isDuplicate(line, index) ? `${line.item} is already in this recipe` : undefined">
            <UInputMenu
              v-model="line.item"
              :items="itemOptions(line)"
              value-key="value"
              ignore-filter
              class="w-full"
              :ui="{ base: 'min-h-11 px-2.5 py-2' }"
              placeholder="Start typing an item…"
              @update:search-term="searchItems(line, $event)"
            />
          </UFormField>
          <UFormField label="Quantity" :ui="{ label: 'sr-only max-[900.01px]:not-sr-only' }" class="min-w-0">
            <UInput v-model.number="line.quantity" type="number" min="0" step="any" inputmode="decimal" placeholder="0" class="w-full" :ui="{ base: 'min-h-11 px-2.5 py-2' }" />
          </UFormField>
          <UFormField label="Unit" :ui="{ label: 'sr-only max-[900.01px]:not-sr-only' }" class="min-w-0">
            <UnitInput v-model="line.unit" ignore-filter class="w-full" :ui="{ base: 'min-h-11 px-2.5 py-2' }" />
          </UFormField>
          <div data-recipe-cost class="flex min-h-11 min-w-0 items-center justify-end gap-2 text-right max-[900.01px]:flex-wrap max-[900.01px]:justify-start max-[900.01px]:text-left max-[640.01px]:col-span-2">
            <span class="hidden text-[11px] font-[750] tracking-[.08em] text-(--muted) uppercase max-[900.01px]:block">Cost</span>
            <p v-if="resultFor(line, index)?.error" class="m-0 text-xs text-(--muted)">{{ costErrorText(resultFor(line, index)!) }}</p>
            <template v-else-if="resultFor(line, index)">
              <strong class="text-(--accent-strong)">{{ currency(resultFor(line, index)!.cost!) }}</strong>
              <UBadge v-if="resultFor(line, index)!.sale" label="Sale" color="warning" variant="soft" />
            </template>
          </div>
          <div class="flex min-h-11 items-center justify-end max-[900.01px]:absolute max-[900.01px]:right-2 max-[900.01px]:top-2">
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" :aria-label="`Remove line ${index + 1}`" @click="lines.splice(index, 1)" />
          </div>
        </li>
      </ul>

      <UButton class="mx-6 my-4 max-[640.01px]:mx-3" icon="i-lucide-plus" label="Add another line" color="neutral" variant="outline" @click="lines.push(blankLine())" />

      <div v-if="requestError" class="px-6 pb-4">
        <UAlert color="error" variant="soft" icon="i-lucide-circle-alert" :description="requestError" />
      </div>

      <div v-if="response" data-recipe-total class="flex items-center justify-between gap-4 px-6 py-5 text-(--accent-strong) [border-top:1px_solid_var(--line)]" aria-live="polite">
        <span class="text-xs font-bold uppercase">Total<template v-if="response.excluded"> (partial, {{ response.excluded }} excluded)</template></span>
        <div class="text-right">
          <span class="block text-xs text-(--muted)">{{ response.lines.length }} {{ response.lines.length === 1 ? 'line' : 'lines' }}</span>
          <strong class="text-[28px]">{{ currency(response.total) }}</strong>
        </div>
      </div>
    </UCard>
  </div>
</template>
