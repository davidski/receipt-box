<script setup lang="ts">
type Suggestion = { value: string, location?: string, size?: string | null, unit?: string | null, price?: string | null }
type Food = { id: string, name: string }
type Line = { key: number, item: string, food: Food | null, foodMode: boolean, foodOptions: Food[], quantity: number | string | undefined, unit: string, options: Suggestion[] }
type CostError = 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'NO_UNIT' | 'UNSTANDARDIZED_UNIT' | 'DIMENSION_MISMATCH' | 'UNKNOWN_FOOD' | 'INACTIVE_MEALIE_FOOD' | 'NO_PRODUCT_MAPPING' | 'MEALIE_NOT_CONFIGURED'
type Base = { base: string, amount: number }
type Purchase = { item: string, price: string | number, size: string | number | null, unit: string | null, purchasedOn: string, usedSalePrice: boolean }
type CostResult = ({ item: string } | { foodId: string }) & {
  cost: number | null, sale: boolean, error: CostError | null, purchaseUnit?: string | null
  purchase?: Purchase | null, normalizedQuantity?: Base | null, normalizedPackageQuantity?: Base | null, status?: 'exact' | 'unit_converted' | 'uncosted'
}
type CostResponse = { lines: CostResult[], total: number, excluded: number }
type RecipeLine = { item: string, quantity: number, unit: string } | { foodId: string, foodName: string, quantity: number, unit: string }
type RecipeSummary = { id: string, name: string, lineCount: number }
type Recipe = { id: string, name: string, lines: RecipeLine[], savedTotal: number | string | null, savedAt: string }

const errorText: Record<CostError, string> = {
  NO_PRICE: 'No purchases recorded for this item.',
  NO_PACKAGE_SIZE: 'Couldn\'t find a purchase with a usable package size.',
  NO_UNIT: 'Choose a unit for this line.',
  UNSTANDARDIZED_UNIT: 'This unit isn\'t a standard measure, so it can\'t be priced.',
  DIMENSION_MISMATCH: 'This unit can\'t be converted to the unit it was bought in.',
  UNKNOWN_FOOD: 'This food hasn\'t reached Receipt Box yet. Sync Mealie or choose another food.',
  INACTIVE_MEALIE_FOOD: 'This food is no longer active in Mealie. Choose another food.',
  NO_PRODUCT_MAPPING: 'No grocery item is mapped to this food yet. Map one under Manage, Mealie.',
  MEALIE_NOT_CONFIGURED: 'Mealie isn\'t configured, so this food can\'t be priced.'
}
// A food line prices the items mapped to it, so these two reasons read differently from an item line.
const foodErrorText: Partial<Record<CostError, string>> = {
  NO_PRICE: 'No purchases recorded for the items mapped to this food.',
  NO_PACKAGE_SIZE: 'Couldn\'t find a purchase of a mapped item with a usable package size.'
}

const route = useRoute()
const router = useRouter()
const { apiUrl } = useApi()
let nextKey = 0

function blankLine(): Line {
  return { key: nextKey++, item: '', food: null, foodMode: false, foodOptions: [], quantity: undefined, unit: 'ea', options: [] }
}

// A food line goes into the query as an item named "food:<id>:<name>".
const foodParam = /^food:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.*)$/i

// Query format: l=item|quantity|unit, repeated. The item may itself contain "|".
function parseLine(value: string): Line {
  const parts = value.split('|')
  const unit = parts.pop() || 'ea'
  const quantity = Number(parts.pop())
  const item = parts.join('|')
  const [, id, foodName] = foodParam.exec(item) ?? []
  if (id) return { ...blankLine(), food: { id, name: foodName || id }, foodMode: true, foodOptions: [{ id, name: foodName || id }], quantity: quantity > 0 ? quantity : undefined, unit }
  return { ...blankLine(), item, quantity: quantity > 0 ? quantity : undefined, unit, options: item ? [{ value: item }] : [] }
}

// A valid ?recipe=<id> wins over ?l= lines.
const recipeParam = String([route.query.recipe].flat()[0] ?? '')
const queryRecipeId = /^[1-9]\d*$/.test(recipeParam) ? recipeParam : null
const queryLines = queryRecipeId ? [] : [route.query.l].flat().filter((value): value is string => typeof value === 'string' && value.includes('|'))
const lines = ref<Line[]>(queryLines.length ? queryLines.map(parseLine) : [blankLine()])
const { dragIndex, handle, rowStyle } = useLineReorder(lines)
const response = ref<CostResponse | null>(null)
const requestError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let costTimer: ReturnType<typeof setTimeout> | undefined
let searchRequest = 0
let costRequest = 0

const itemKey = (item: string) => item.trim().toLowerCase()
const lineKey = (line: Line) => line.foodMode ? (line.food ? `food:${line.food.id}` : '') : itemKey(line.item)
const isDuplicate = (line: Line, index: number) => !!lineKey(line) && lines.value.findIndex(other => lineKey(other) === lineKey(line)) < index
const sendable = computed<RecipeLine[]>(() => lines.value
  .filter((line, index) => lineKey(line) && !isDuplicate(line, index) && Number(line.quantity) > 0 && line.unit)
  .map(line => ({
    ...(line.foodMode ? { foodId: line.food!.id, foodName: line.food!.name } : { item: line.item }),
    quantity: Number(line.quantity),
    unit: line.unit
  })))
const results = computed(() => new Map((response.value?.lines ?? []).map(result => [('foodId' in result ? `food:${result.foodId}` : itemKey(result.item)), result])))
// Hidden until Mealie is known to be configured; a saved food line still shows and saves without it.
const { data: mealieStatus } = useFetch<{ configured: boolean }>(apiUrl('/mealie/status'))

const resultFor = (line: Line, index: number) => isDuplicate(line, index) ? undefined : results.value.get(lineKey(line))
// One calculation per priced line, in editor order; a removed line drops out at once, an edited one updates with the next response.
const priced = computed(() => lines.value.flatMap((line, index) => {
  const result = resultFor(line, index)
  return result?.purchase ? [{ name: line.foodMode ? line.food?.name ?? '' : line.item, purchase: result.purchase, normalizedQuantity: result.normalizedQuantity ?? null, normalizedPackageQuantity: result.normalizedPackageQuantity ?? null, cost: result.cost, status: result.status ?? 'uncosted' }] : []
}))

const recipes = ref<RecipeSummary[]>([])
const loaded = ref<Recipe | null>(null)
const loadedId = ref<string | null>(null)
const name = ref('')
const saving = ref(false)
const deleteConfirmOpen = ref(false)
const recipeError = ref('')
const listError = ref('')

const NEW_RECIPE = 'new'
const recipeItems = computed(() => [
  { label: 'New recipe', value: NEW_RECIPE },
  ...recipes.value.map(recipe => ({ label: recipe.name, value: recipe.id, description: `${recipe.lineCount} ${recipe.lineCount === 1 ? 'line' : 'lines'}` }))
])
const signature = (value: string, recipeLines: RecipeLine[]) => JSON.stringify([value.trim(), recipeLines.map(line => ['foodId' in line ? `food:${line.foodId}` : line.item.trim(), Number(line.quantity), line.unit])])
const dirty = computed(() => !!loaded.value && signature(name.value, sendable.value) !== signature(loaded.value.name, loaded.value.lines))
const canSave = computed(() => !saving.value && !!name.value.trim() && sendable.value.length > 0 && (!loaded.value || dirty.value))

const cents = (value: number | string) => Math.round(Number(value) * 100)
const savedTotal = computed(() => loaded.value?.savedTotal == null ? null : Number(loaded.value.savedTotal))
// The cost API reports a total of 0 when every line is excluded; treat that as "no live total", like the server snapshot and the list page.
const liveTotal = computed(() => response.value && response.value.excluded < response.value.lines.length ? response.value.total : null)
const change = computed(() => savedTotal.value === null || liveTotal.value === null ? null : (cents(liveTotal.value) - cents(savedTotal.value)) / 100)
// Updating the snapshot also saves the page's lines, so only offer it for the lines as saved.
const canUpdateSavedPrice = computed(() => !dirty.value && liveTotal.value !== null && (savedTotal.value === null || cents(liveTotal.value) !== cents(savedTotal.value)))
const savedDate = computed(() => loaded.value ? new Date(loaded.value.savedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

function recipeErrorText(error: any, fallback: string) {
  const status = error?.statusCode ?? error?.status
  if (status === 409) return `A recipe named “${name.value.trim()}” already exists. Choose a different name.`
  if (status === 404) return 'This recipe no longer exists. It may have been deleted by someone else.'
  return error?.data?.statusMessage || error?.message || fallback
}

function resetRecipe() {
  loaded.value = null
  loadedId.value = null
  name.value = ''
  lines.value = [blankLine()]
}

function adopt(recipe: Recipe) {
  loaded.value = recipe
  loadedId.value = recipe.id
  name.value = recipe.name
}

async function refreshRecipes() {
  try {
    recipes.value = await $fetch<RecipeSummary[]>(apiUrl('/recipes'))
    listError.value = ''
  } catch {
    listError.value = 'Could not load the saved recipes. Reload the page to try again.'
  }
}

async function loadRecipe(id: string) {
  recipeError.value = ''
  try {
    const recipe = await $fetch<Recipe>(apiUrl(`/recipes/${id}`))
    lines.value = recipe.lines.length
      ? recipe.lines.map((line) => {
          const food = 'foodId' in line ? { id: line.foodId, name: line.foodName || line.foodId } : null
          const item = 'item' in line ? line.item : ''
          return { ...blankLine(), item, food, foodMode: !!food, foodOptions: food ? [food] : [], quantity: line.quantity, unit: line.unit, options: item ? [{ value: item }] : [] }
        })
      : [blankLine()]
    adopt(recipe)
  } catch (error: any) {
    recipeError.value = recipeErrorText(error, 'Could not load the recipe.')
    resetRecipe()
    router.replace({ query: {} })
  }
}

function pickRecipe(value: string) {
  recipeError.value = ''
  if (value === NEW_RECIPE) resetRecipe()
  else loadRecipe(value)
}

async function saveRecipe(updateSavedPrice = false) {
  const id = loadedId.value
  saving.value = true
  recipeError.value = ''
  try {
    const saved = await $fetch<Recipe>(apiUrl(id ? `/recipes/${id}` : '/recipes'), {
      method: id ? 'PUT' : 'POST',
      body: { name: name.value.trim(), lines: sendable.value, ...(updateSavedPrice ? { updateSavedPrice: true } : {}) }
    })
    adopt(saved)
    await refreshRecipes()
  } catch (error: any) {
    recipeError.value = recipeErrorText(error, 'Could not save the recipe.')
    if (id && (error?.statusCode ?? error?.status) === 404) {
      loaded.value = null
      loadedId.value = null
      refreshRecipes()
    }
  } finally {
    saving.value = false
  }
}

async function deleteRecipe() {
  saving.value = true
  recipeError.value = ''
  try {
    await $fetch(apiUrl(`/recipes/${loadedId.value}`), { method: 'DELETE' })
    resetRecipe()
  } catch (error: any) {
    recipeError.value = recipeErrorText(error, 'Could not delete the recipe.')
    if ((error?.statusCode ?? error?.status) === 404) resetRecipe()
  } finally {
    saving.value = false
    deleteConfirmOpen.value = false
    refreshRecipes()
  }
}

function costErrorText(result: CostResult) {
  if ('foodId' in result && result.error && foodErrorText[result.error]) return foodErrorText[result.error]
  if ((result.error === 'DIMENSION_MISMATCH' || result.error === 'UNSTANDARDIZED_UNIT') && result.purchaseUnit) {
    return `This unit can't be converted to ${result.purchaseUnit}, the unit of the latest usable purchase.`
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

let foodRequest = 0
async function searchFoods(line: Line, term: string) {
  const request = ++foodRequest
  try {
    const { foods } = await $fetch<{ foods: Food[] }>(apiUrl('/mealie/foods'), { query: { search: term.trim() } })
    if (request === foodRequest) line.foodOptions = foods
  } catch {
    if (request === foodRequest) line.foodOptions = []
  }
}

function toggleFoodMode(line: Line) {
  line.foodMode = !line.foodMode
  if (line.foodMode && !line.foodOptions.length) searchFoods(line, '')
}

function pickFood(line: Line, id: string) {
  const food = line.foodOptions.find(option => option.id === id)
  if (food) line.food = food
}

watch([lines, loadedId], ([current, id]) => {
  if (id) return router.replace({ query: { recipe: String(id) } })
  const l = current.filter(line => lineKey(line)).map(line => `${line.foodMode ? `food:${line.food!.id}:${line.food!.name}` : line.item}|${line.quantity ?? ''}|${line.unit}`)
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

onMounted(() => {
  refreshRecipes()
  if (queryRecipeId) loadRecipe(queryRecipeId)
})

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  clearTimeout(costTimer)
})
</script>

<template>
  <div class="mx-auto w-full max-w-300">
    <header class="page-heading my-[0.9375rem] mb-8">
      <h1 class="leading-[1.04] text-display">Recipe cost</h1>
      <p>Add ingredients to price them at what you last paid.</p>
      <p v-if="mealieStatus?.configured" data-recipe-food-help class="mt-1 text-sm text-(--muted)">
        Each line prices one grocery item. Select <UIcon name="i-lucide-carrot" class="align-[-0.125em]" aria-label="the carrot button" /> on a line to price a Mealie food instead, using the items mapped to it, and <UIcon name="i-lucide-shopping-basket" class="align-[-0.125em]" aria-label="the basket button" /> to switch back.
      </p>
    </header>

    <div data-recipe-toolbar class="mb-4 flex flex-wrap items-center gap-2.5">
      <USelectMenu
        :model-value="loadedId ?? NEW_RECIPE"
        :items="recipeItems"
        value-key="value"
        :aria-label="`Saved recipe: ${loaded?.name ?? 'New recipe'}`"
        icon="i-lucide-book-open"
        class="w-full sm:w-64"
       
        @update:model-value="pickRecipe"
      />
      <UInput v-model="name" aria-label="Recipe name" placeholder="Recipe name" maxlength="120" class="min-w-0 flex-1 sm:min-w-48" :ui="{ base: 'px-2.5 py-2' }" />
      <UButton icon="i-lucide-save" :label="loadedId ? 'Save changes' : 'Save recipe'" :disabled="!canSave" :loading="saving" @click="saveRecipe()" />
      <UButton to="/recipes" icon="i-lucide-list" label="All recipes" color="neutral" variant="ghost" />
      <UButton v-if="loadedId" icon="i-lucide-trash-2" label="Delete" color="error" variant="outline" :disabled="saving" @click="deleteConfirmOpen = true" />
    </div>

    <UAlert v-if="listError" data-recipe-list-error role="alert" class="mb-4" color="error" variant="soft" icon="i-lucide-circle-alert" :description="listError" />
    <UAlert v-if="recipeError" data-recipe-error role="alert" class="mb-4" color="error" variant="soft" icon="i-lucide-circle-alert" :description="recipeError" />

    <div data-recipe-editor class="border-y border-line">
      <div data-recipe-headers aria-hidden="true" class="grid grid-cols-[minmax(14.375rem,2fr)_7.5rem_8.125rem_minmax(11.25rem,1fr)_2.5rem] items-center gap-2.5 p-[0.75rem_1.5rem_0.625rem_3.375rem] text-xs font-[750] tracking-[.08em] text-(--muted) uppercase [background:var(--surface-muted)] max-[900.01px]:hidden">
        <span>Item</span><span>Quantity</span><span>Unit</span><span class="text-right">Cost</span><span />
      </div>
      <ul class="m-0 grid list-none p-0 max-[900.01px]:gap-3 max-[900.01px]:p-3">
        <li v-for="(line, index) in lines" :key="line.key" data-recipe-line :style="rowStyle(index)" :class="dragIndex === index ? 'z-10 bg-(--accent-soft) shadow-lg' : 'transition-transform duration-150 motion-reduce:transition-none'" class="relative grid grid-cols-[minmax(14.375rem,2fr)_7.5rem_8.125rem_minmax(11.25rem,1fr)_2.5rem] items-start gap-2.5 p-[0.75rem_1.5rem_0.75rem_3.375rem] [border-top:1px_solid_var(--line)] max-[900.01px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] max-[900.01px]:rounded-[1rem] max-[900.01px]:p-[2.625rem_0.875rem_0.875rem] max-[900.01px]:[border:1px_solid_var(--line)] max-[640.01px]:grid-cols-2">
          <UButton v-bind="handle(index, line.item)" color="neutral" variant="ghost" :class="dragIndex === index ? 'cursor-grabbing' : 'cursor-grab'" class="group absolute top-[1.375rem] left-5 size-6 touch-none select-none justify-center rounded-lg bg-(--surface-muted) p-0 text-xs font-[750] text-(--muted) max-[900.01px]:top-[0.625rem] max-[900.01px]:left-[0.875rem]">
            <span :class="dragIndex === index ? 'hidden' : 'group-hover:hidden group-focus-visible:hidden'">{{ index + 1 }}</span>
            <UIcon name="i-lucide-grip-vertical" :class="dragIndex === index ? 'block' : 'hidden group-hover:block group-focus-visible:block'" class="size-4" aria-hidden="true" />
          </UButton>
          <UFormField label="Item" :ui="{ label: 'sr-only max-[900.01px]:not-sr-only', container: 'mt-0 max-[900.01px]:mt-1' }" class="min-w-0 max-[900.01px]:col-span-3 max-[640.01px]:col-span-2" :error="isDuplicate(line, index) ? `${line.foodMode ? line.food?.name : line.item} is already in this recipe` : undefined">
            <div class="flex items-center gap-1.5">
              <UInputMenu
                v-if="line.foodMode && mealieStatus?.configured"
                :model-value="line.food?.id"
                :items="line.foodOptions.map(food => ({ label: food.name, value: food.id }))"
                value-key="value"
                ignore-filter
                class="w-full"
                :ui="{ base: 'px-2.5 py-2' }"
                placeholder="Search Mealie foods…"
                @update:model-value="pickFood(line, $event)"
                @update:search-term="searchFoods(line, $event)"
              />
              <p v-else-if="line.foodMode" data-recipe-food-name class="m-0 w-full py-2 text-sm">{{ line.food?.name }}</p>
              <UInputMenu
                v-else
                v-model="line.item"
                :items="itemOptions(line)"
                value-key="value"
                ignore-filter
                class="w-full"
                :ui="{ base: 'px-2.5 py-2' }"
                placeholder="Start typing an item…"
                @update:search-term="searchItems(line, $event)"
              />
              <UTooltip v-if="mealieStatus?.configured" :text="line.foodMode ? 'Use a grocery item: price this line from one item\'s purchases' : 'Use a Mealie food: price this line from the items mapped to the food'">
                <UButton
                  :icon="line.foodMode ? 'i-lucide-shopping-basket' : 'i-lucide-carrot'"
                  color="neutral"
                  variant="ghost"
                  :aria-label="line.foodMode ? `Use a grocery item for line ${index + 1}` : `Use a Mealie food for line ${index + 1}`"
                  @click="toggleFoodMode(line)"
                />
              </UTooltip>
            </div>
          </UFormField>
          <UFormField label="Quantity" :ui="{ label: 'sr-only max-[900.01px]:not-sr-only', container: 'mt-0 max-[900.01px]:mt-1' }" class="min-w-0">
            <UInput v-model.number="line.quantity" type="number" min="0" step="any" inputmode="decimal" placeholder="0" class="w-full" :ui="{ base: 'px-2.5 py-2' }" />
          </UFormField>
          <UFormField label="Unit" :ui="{ label: 'sr-only max-[900.01px]:not-sr-only', container: 'mt-0 max-[900.01px]:mt-1' }" class="min-w-0">
            <UnitInput v-model="line.unit" ignore-filter class="w-full" :ui="{ base: 'px-2.5 py-2' }" />
          </UFormField>
          <div data-recipe-cost class="flex min-h-11 min-w-0 items-center justify-end gap-2 text-right max-[900.01px]:flex-wrap max-[900.01px]:justify-start max-[900.01px]:text-left max-[640.01px]:col-span-2">
            <span class="hidden text-xs font-[750] tracking-[.08em] text-(--muted) uppercase max-[900.01px]:block">Cost</span>
            <p v-if="resultFor(line, index)?.error" class="m-0 text-xs text-(--muted)">{{ costErrorText(resultFor(line, index)!) }}</p>
            <template v-else-if="resultFor(line, index)">
              <strong class="text-(--accent-strong)">{{ currency(resultFor(line, index)!.cost!) }}</strong>
              <SaleMark v-if="resultFor(line, index)!.sale" />
            </template>
          </div>
          <div class="flex min-h-11 items-center justify-end max-[900.01px]:absolute max-[900.01px]:right-2 max-[900.01px]:top-2">
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" :aria-label="`Remove line ${index + 1}`" @click="lines.splice(index, 1)" />
          </div>
        </li>
      </ul>

      <UButton class="mx-6 my-4 max-[640.01px]:mx-3" icon="i-lucide-plus" label="Add another line" color="neutral" variant="outline" @click="lines.push(blankLine())" />

      <div v-if="requestError" class="px-6 pb-4">
        <UAlert role="alert" color="error" variant="soft" icon="i-lucide-circle-alert" :description="requestError" />
      </div>

      <div v-if="response" data-recipe-total class="flex items-center justify-between gap-4 px-6 py-5 text-(--accent-strong) [border-top:1px_solid_var(--line)]" aria-live="polite">
        <span class="text-xs font-bold uppercase">Total<template v-if="response.excluded"> (partial, {{ response.excluded }} excluded)</template></span>
        <div class="text-right">
          <span class="block text-xs text-(--muted)">{{ response.lines.length }} {{ response.lines.length === 1 ? 'line' : 'lines' }}</span>
          <strong class="text-heading"><MoneyAmount :value="response.total" /></strong>
        </div>
      </div>

      <div v-if="loaded" data-recipe-snapshot class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm [border-top:1px_solid_var(--line)]">
        <p class="m-0 text-(--muted)">
          <template v-if="savedTotal === null">Saved on {{ savedDate }} with no priced lines</template>
          <template v-else>Saved at {{ currency(savedTotal) }} on {{ savedDate }}</template>
          <template v-if="liveTotal !== null"> · now {{ currency(liveTotal) }}</template>
          <PriceChange v-if="change" data-recipe-change class="ml-1.5" :value="change" />
        </p>
        <UButton v-if="canUpdateSavedPrice" label="Update saved price" icon="i-lucide-refresh-cw" color="neutral" variant="outline" :disabled="saving" @click="saveRecipe(true)" />
      </div>
    </div>

    <RecipeCostDetails :lines="priced" />

    <ConfirmModal
      v-model:open="deleteConfirmOpen"
      title="Delete recipe?"
      :description="`Delete “${loaded?.name ?? ''}”? This cannot be undone.`"
      confirm-label="Delete recipe"
      confirm-color="error"
      :loading="saving"
      @confirm="deleteRecipe"
    />
  </div>
</template>
