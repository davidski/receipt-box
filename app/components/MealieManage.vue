<script setup lang="ts">
type MealieStatus = {
  configured: boolean
  lastSyncedAt: string | null
  lastError: string | null
  counts: { activeFoods: number, inactiveFoods: number, aliases: number, activeUnits: number, inactiveUnits: number } | null
}
type Mapping = { item: string, mealieFoodId: string, foodName: string | null, broken: boolean, hasEntries: boolean }
type ItemCount = { item: string, entries: number }
type Problems = { itemsWithoutPackageSize: ItemCount[] }
type SyncResult = { status: 'skipped' } | { status: 'synced', foods: number, aliases: number, units: number, deactivatedFoods: number, deactivatedUnits: number }
type Filter = 'all' | 'mapped' | 'unmapped' | 'attention'
type Row = { item: string, entries?: number, mapping?: Mapping }
type CachedFood = { id: string, name: string, active: boolean }
type FoodOption = { label: string, value: string, description?: string }
type Suggestion = { mealieFoodId: string, foodName: string, matchType: 'exact_name' | 'plural_name' | 'exact_alias' | 'normalized_name' | 'fuzzy', matchedText: string, similarity: number | null }

const { apiUrl } = useApi()
const { data: status, error: statusError, refresh: refreshStatus } = await useFetch<MealieStatus>(apiUrl('/mealie/status'))
const { data: mappings, status: mappingsStatus, error: mappingsError, refresh: refreshMappings } = await useFetch<{ mappings: Mapping[] }>(apiUrl('/food-mappings'))
const { data: unmapped, status: unmappedStatus, error: unmappedError, refresh: refreshUnmapped } = await useFetch<{ items: ItemCount[] }>(apiUrl('/food-mappings/unmapped'))
const { data: problems, error: problemsError, refresh: refreshProblems } = await useFetch<Problems>(apiUrl('/food-mappings/problems'))

// A link from a recipe cost page names the Mealie food to fix; the lookup also tells an inactive or unsynced food apart.
const route = useRoute()
const router = useRouter()
const focusId = computed(() => typeof route.query.food === 'string' ? route.query.food : '')
const backSlug = computed(() => typeof route.query.recipe === 'string' ? route.query.recipe : '')
const { data: focusFood, status: focusStatus, error: focusError, execute: loadFocusFood } = useFetch<CachedFood>(() => apiUrl(`/mealie/foods/${encodeURIComponent(focusId.value)}`), { key: 'mealie-focus-food', immediate: false, watch: false, server: false })
const backName = computed(() => typeof route.query.name === 'string' ? route.query.name : '')
const listSearch = ref('')
const focusSearch = ref('')
const focusFoodResults = ref<{ id: string, name: string }[]>([])
const focusSearchError = ref('')
const focusSearching = ref(false)
const focusPanel = ref<HTMLElement>()
const focusPick = ref<FoodOption>()
const focusMessage = ref<{ ok: boolean, text: string } | null>(null)

const syncing = ref(false)
const syncError = ref('')
const syncNotice = ref('')
const forceConfirmation = ref('')
const filter = ref<Filter>('all')
const visibleRows = ref(30)
const editingItem = ref<string | null>(null)
const foodSearch = ref('')
const pickedFood = ref<FoodOption>()
const foodResults = ref<{ id: string, name: string }[]>([])
const foodsLoading = ref(false)
const foodsError = ref('')
const mappingBusy = ref<string | null>(null)
const mappingError = ref('')
const clearing = ref<Mapping | null>(null)
const clearBusy = ref(false)
// By item name: null while loading, 'failed' after an error. A Map because item names are free text.
const suggestions = reactive(new Map<string, Suggestion[] | null | 'failed'>())

const fieldUi = { container: 'mt-1.5 grid gap-2', help: 'mt-0', error: 'mt-0', label: 'font-bold text-muted' }

const counts = computed(() => status.value?.counts)
const allMappings = computed(() => mappings.value?.mappings ?? [])
const mappedRows = computed<Row[]>(() => allMappings.value.filter(mapping => !mapping.broken).map(mapping => ({ item: mapping.item, mapping })))
const brokenRows = computed<Row[]>(() => allMappings.value.filter(mapping => mapping.broken).map(mapping => ({ item: mapping.item, mapping })))
const noPackageSize = computed(() => new Set((problems.value?.itemsWithoutPackageSize ?? []).map(({ item }) => item)))
// A mapping that needs fixing. An item missing a package size is still validly mapped, so it also stays under Mapped.
const attentionRows = computed<Row[]>(() => [...allMappings.value].filter(mapping => mapping.broken || !mapping.hasEntries || noPackageSize.value.has(mapping.item)).sort((a, b) => Number(b.broken) - Number(a.broken)).map(mapping => ({ item: mapping.item, mapping })))
const unmappedRows = computed<Row[]>(() => (unmapped.value?.items ?? []).map(({ item, entries }) => ({ item, entries })))
const allRows = computed(() => [...brokenRows.value, ...unmappedRows.value, ...mappedRows.value])
// The search and an inactive food's focus narrow every tab alike, so the counts always match what the tab lists.
const tabRows = computed(() => {
  const term = listSearch.value.trim().toLowerCase()
  const keep = (row: Row) => (!focusInactive.value || row.mapping?.mealieFoodId === focusFood.value?.id)
    && (!term || row.item.toLowerCase().includes(term) || Boolean(row.mapping?.foodName?.toLowerCase().includes(term)))
  return { all: allRows.value.filter(keep), mapped: mappedRows.value.filter(keep), unmapped: unmappedRows.value.filter(keep), attention: attentionRows.value.filter(keep) }
})
const filterTabs = computed(() => [
  { label: `All (${tabRows.value.all.length})`, value: 'all' },
  { label: `Mapped (${tabRows.value.mapped.length})`, value: 'mapped' },
  { label: `Unmapped (${tabRows.value.unmapped.length})`, value: 'unmapped' },
  { label: `Needs attention (${tabRows.value.attention.length})`, value: 'attention' }
])
const filteredRows = computed(() => tabRows.value[filter.value])
const visibleList = computed(() => filteredRows.value.slice(0, visibleRows.value))
const unloadedSuggestions = computed(() => visibleList.value.filter(row => needsFood(row) && !suggestions.has(row.item)).map(row => row.item))
// An empty search lists the suggestions, with their reasons, ahead of the catalog.
const foodOptions = computed<FoodOption[]>(() => {
  const loaded = foodSearch.value.trim() ? null : suggestions.get(editingItem.value ?? '')
  const suggested = Array.isArray(loaded) ? loaded : []
  return [
    ...suggested.map(suggestion => ({ label: suggestion.foodName, value: suggestion.mealieFoodId, description: matchReason(suggestion) })),
    ...foodResults.value.filter(food => !suggested.some(suggestion => suggestion.mealieFoodId === food.id)).map(food => ({ label: food.name, value: food.id }))
  ]
})
const focusMapped = computed(() => allMappings.value.filter(mapping => mapping.mealieFoodId === focusFood.value?.id))
const focusInactive = computed(() => Boolean(focusId.value) && focusStatus.value === 'success' && focusFood.value?.active === false)
const focusTitle = computed(() => {
  if (focusError.value) return 'Food not available'
  if (!focusFood.value || focusStatus.value === 'pending') return 'Loading the food…'
  return focusFood.value.active ? `Map a grocery item to ${focusFood.value.name}` : `Fix the mappings to ${focusFood.value.name}`
})
const focusErrorText = computed(() => {
  switch (focusError.value?.statusCode) {
    case 400: return 'This link has an invalid food id.'
    case 404: return 'This food hasn\'t reached Receipt Box yet. Use Sync now above to refresh it, then come back.'
    default: return errorMessage(focusError.value, 'Could not load this food')
  }
})
// Announced politely; results shown while a newer query loads could be chosen under the wrong text, so they wait for it.
const focusSearchStatus = computed(() => {
  const term = focusSearch.value.trim()
  if (!term || focusSearchError.value) return ''
  if (focusSearching.value) return 'Searching Mealie foods…'
  return focusFoodResults.value.length ? '' : `No Mealie foods match “${term}”.`
})
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g)?.map(word => word.replace(/s$/, '')) ?? []
// Items sharing the most words with the food come first, then alphabetically. ponytail: word overlap, not the server's trigram score; upgrade if it ranks badly.
const focusItemOptions = computed<FoodOption[]>(() => {
  const wanted = new Set(words(focusFood.value?.name ?? ''))
  const overlap = (item: string) => words(item).filter(word => wanted.has(word)).length
  return unmappedRows.value
    .map(({ item, entries }) => ({ label: item, description: entryLabel(entries ?? 0), value: item, overlap: overlap(item) }))
    .sort((a, b) => b.overlap - a.overlap || a.label.localeCompare(b.label))
})
const mappingsLoading = computed(() => [mappingsStatus.value, unmappedStatus.value].includes('pending') && !mappings.value)
function goneLabel(count: number, noun: string) {
  return count > 0 ? `${count.toLocaleString()} ${noun}${count === 1 ? ' is' : 's are'} no longer in Mealie.` : ''
}

function entryLabel(entries: number) {
  return `${entries.toLocaleString()} ${entries === 1 ? 'entry' : 'entries'}`
}

function errorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || fallback
}

// A mapping without entries can only be cleared, and a healthy one needs no replacement.
function needsFood(row: Row) {
  return !row.mapping || (row.mapping.broken && row.mapping.hasEntries)
}

function topSuggestion(row: Row) {
  const loaded = needsFood(row) ? suggestions.get(row.item) : null
  return Array.isArray(loaded) ? loaded[0] : undefined
}

function chooseLabel(row: Row) {
  return topSuggestion(row) ? 'Choose another' : row.mapping ? 'Change food' : 'Choose food'
}

function matchReason({ matchType, matchedText, similarity }: Suggestion) {
  switch (matchType) {
    case 'exact_name': return `Matched Mealie food name “${matchedText}”`
    case 'plural_name': return `Matched Mealie plural name “${matchedText}”`
    case 'exact_alias': return `Matched Mealie alias “${matchedText}”`
    case 'normalized_name': return `Matched “${matchedText}”, ignoring punctuation and plurals`
    case 'fuzzy': return `Similar to “${matchedText}” (${Math.round((similarity ?? 0) * 100)}%)`
  }
}

// A sync replaces the catalog, so an answer that started before it must not fill the emptied cache.
let suggestionRun = 0
async function loadSuggestions(item: string) {
  const run = suggestionRun
  suggestions.set(item, null)
  try {
    const { suggestions: loaded } = await $fetch<{ suggestions: Suggestion[] }>(apiUrl('/food-mappings/suggestions'), { query: { item } })
    if (run === suggestionRun) suggestions.set(item, loaded)
  } catch {
    if (run === suggestionRun) suggestions.set(item, 'failed')
  }
}

function refreshLists() {
  return Promise.all([refreshMappings(), refreshUnmapped(), refreshProblems()])
}

// A narrowed Mealie listing is refused by the server, so force is only ever sent from the explicit confirmation.
async function sync(force = false) {
  syncing.value = true
  syncError.value = ''
  syncNotice.value = ''
  forceConfirmation.value = ''
  try {
    const result = await $fetch<SyncResult>(apiUrl('/mealie/sync'), { method: 'POST', body: { force } })
    syncNotice.value = result.status === 'skipped'
      ? 'Another sync is already running, so this one was skipped.'
      : [`Synced ${result.foods.toLocaleString()} foods and ${result.units.toLocaleString()} units.`, goneLabel(result.deactivatedFoods, 'food'), goneLabel(result.deactivatedUnits, 'unit')].filter(Boolean).join(' ')
  } catch (error: any) {
    syncError.value = errorMessage(error, 'Could not sync Mealie')
    if (error?.data?.data?.forceable === true) forceConfirmation.value = syncError.value
  } finally {
    syncing.value = false
  }
  suggestionRun++
  suggestions.clear()
  if (focusId.value) void loadFocusFood()
  await Promise.all([refreshStatus(), refreshLists()])
}

function chooseFood(item: string) {
  editingItem.value = item
  pickedFood.value = undefined
  foodSearch.value = ''
  mappingError.value = ''
  if (!suggestions.has(item)) void loadSuggestions(item)
  void searchFoods()
}

// Only the newest search may fill the list, however the responses are ordered.
let latestSearch = 0
async function searchFoods() {
  const search = ++latestSearch
  foodsLoading.value = true
  foodsError.value = ''
  try {
    const { foods } = await $fetch<{ foods: { id: string, name: string }[] }>(apiUrl('/mealie/foods'), { query: { search: foodSearch.value } })
    if (search === latestSearch) foodResults.value = foods
  } catch (error: any) {
    if (search === latestSearch) foodsError.value = errorMessage(error, 'Could not search the Mealie foods')
  } finally {
    if (search === latestSearch) foodsLoading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(foodSearch, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(searchFoods, 200)
})
watch([filter, listSearch], () => { visibleRows.value = 30 })
watch(unloadedSuggestions, items => items.forEach(item => loadSuggestions(item)))
onMounted(() => unloadedSuggestions.value.forEach(item => loadSuggestions(item)))
onBeforeUnmount(() => clearTimeout(searchTimer))

async function saveFood(item: string, mealieFoodId: string) {
  mappingBusy.value = item
  mappingError.value = ''
  let saved = false
  try {
    await $fetch(apiUrl('/items/food'), { method: 'PUT', body: { item, mealieFoodId } })
    if (editingItem.value === item) editingItem.value = null
    saved = true
  } catch (error: any) {
    mappingError.value = errorMessage(error, `Could not map ${item}`)
    void loadSuggestions(item)
    // The catalog may have changed, so offer fresh results. The choice stays in the box for a retry.
    void searchFoods()
  } finally {
    mappingBusy.value = null
  }
  await refreshLists()
  return saved
}

// The panel reports its own result, so the failure is moved out of the alert below the tabs.
async function mapFocusItem(item: string) {
  focusMessage.value = null
  const food = focusFood.value!
  const saved = await saveFood(item, food.id)
  focusMessage.value = saved ? { ok: true, text: `Mapped “${item}” to ${food.name}.` } : { ok: false, text: mappingError.value }
  mappingError.value = ''
  if (saved) focusPick.value = undefined
}

// A failed choice stays in the box. The kept copy is a different object from the list's, so choosing the same option again still counts as a change and retries.
function pickFocusItem(option?: FoodOption | null) {
  if (!option || mappingBusy.value !== null) return
  focusPick.value = { ...option }
  void mapFocusItem(option.value)
}

function pickFood(item: string, option?: FoodOption | null) {
  if (!option || mappingBusy.value !== null) return
  pickedFood.value = { ...option }
  void saveFood(item, option.value)
}

// The linked food may be the wrong one, so any cached food can take its place.
let latestFocusSearch = 0
watch(focusSearch, async (term) => {
  const search = ++latestFocusSearch
  focusSearchError.value = ''
  if (!term.trim()) { focusFoodResults.value = []; focusSearching.value = false; return }
  focusSearching.value = true
  try {
    const { foods } = await $fetch<{ foods: { id: string, name: string }[] }>(apiUrl('/mealie/foods'), { query: { search: term.trim() } })
    if (search === latestFocusSearch) focusFoodResults.value = foods
  } catch (error: any) {
    if (search === latestFocusSearch) {
      focusFoodResults.value = []
      focusSearchError.value = errorMessage(error, 'Could not search the Mealie foods')
    }
  } finally {
    if (search === latestFocusSearch) focusSearching.value = false
  }
})

function focusOtherFood(food: string) {
  focusSearch.value = ''
  void router.replace({ query: { ...route.query, food } })
}

function dismissFocus() {
  focusMessage.value = null
  void router.replace({ query: { ...route.query, food: undefined, recipe: undefined, name: undefined } })
}

watch(focusId, (id) => {
  focusMessage.value = null
  if (id) void loadFocusFood()
}, { immediate: true })
watch(focusError, (error) => {
  if (error && backName.value) focusSearch.value = backName.value
})
// The data page keeps the router from scrolling to the top when a food is linked, so the panel can take the view.
watch(focusPanel, (panel) => {
  panel?.scrollIntoView?.({ block: 'start' })
  panel?.focus({ preventScroll: true })
})

async function confirmClear() {
  if (!clearing.value) return
  const { item } = clearing.value
  clearBusy.value = true
  mappingError.value = ''
  try {
    await $fetch(apiUrl('/items/food'), { method: 'DELETE', query: { item } })
  } catch (error: any) {
    mappingError.value = errorMessage(error, `Could not clear the mapping for ${item}`)
  } finally {
    clearBusy.value = false
    clearing.value = null
  }
  await refreshLists()
}
</script>

<template>
  <section class="mt-0" aria-label="Mealie">
    <UCard class="mt-4.5 grid grid-cols-[3.375rem_1fr] gap-5 p-[clamp(1.375rem,4vw,2.125rem)] border border-line rounded-card bg-surface shadow-(--shadow) max-sm:grid-cols-1" :ui="{ body: 'contents' }">
      <div class="grid size-[3.125rem] place-items-center rounded-card text-heading text-accent-strong bg-accent-soft" aria-hidden="true"><UIcon name="i-lucide-refresh-cw" /></div>
      <div class="min-w-0">
        <h2 class="text-heading">Sync</h2>
        <p class="max-w-[38.75rem] text-muted leading-[1.55]">Brings in foods and units from Mealie. Runs when Receipt Box starts, or whenever you choose Sync now.</p>
        <UAlert v-if="statusError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not load the Mealie status." class="mt-4 rounded-card px-3 py-2.5 text-sm">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="refreshStatus()" /></template>
        </UAlert>
        <dl v-if="status" data-testid="mealie-status" class="mt-4.5 grid grid-cols-3 gap-3 max-sm:grid-cols-2">
          <div class="col-span-full"><dt class="text-xs text-muted">Last synced</dt><dd class="font-bold">{{ status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never' }}</dd></div>
          <template v-if="counts">
            <div><dt class="text-xs text-muted">Foods</dt><dd class="font-bold">{{ counts.activeFoods.toLocaleString() }}</dd></div>
            <div><dt class="text-xs text-muted">Units</dt><dd class="font-bold">{{ counts.activeUnits.toLocaleString() }}</dd></div>
          </template>
        </dl>
        <UAlert v-if="syncError || status?.lastError" data-testid="mealie-last-error" color="error" variant="soft" icon="i-lucide-circle-alert" title="Last sync error" :description="syncError || status?.lastError || ''" class="mt-4 rounded-card px-3 py-2.5 text-sm" />
        <UAlert v-if="syncNotice" color="success" variant="soft" icon="i-lucide-circle-check" :description="syncNotice" class="mt-4 rounded-card px-3 py-2.5 text-sm" />
        <UButton class="touch-target mt-4.5" type="button" label="Sync now" icon="i-lucide-refresh-cw" :loading="syncing" @click="sync()" />
      </div>
    </UCard>

    <UCard class="mt-4.5 grid grid-cols-[3.375rem_1fr] gap-5 p-[clamp(1.375rem,4vw,2.125rem)] border border-line rounded-card bg-surface shadow-(--shadow) max-sm:grid-cols-1" :ui="{ body: 'contents' }">
      <div class="grid size-[3.125rem] place-items-center rounded-card text-heading text-accent-strong bg-accent-soft" aria-hidden="true"><UIcon name="i-lucide-link" /></div>
      <div class="min-w-0">
        <h2 class="text-heading">Food mappings</h2>
        <p class="max-w-[38.75rem] text-muted leading-[1.55]">Link each grocery item to the Mealie food it stands for. Several items can share one food.</p>
        <section v-if="focusId" ref="focusPanel" tabindex="-1" data-testid="food-focus" aria-label="Food from the recipe" class="mt-4.5 scroll-mt-24 grid gap-3 rounded-card border border-line bg-surface-muted p-4 outline-none">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h3 class="font-bold">{{ focusTitle }}</h3>
            <div class="flex flex-wrap gap-1">
              <UButton v-if="backSlug" :to="`/mealie-recipes/${encodeURIComponent(backSlug)}`" label="Back to recipe" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" />
              <UButton type="button" label="Dismiss" aria-label="Dismiss food focus" icon="i-lucide-x" color="neutral" variant="ghost" size="sm" @click="dismissFocus" />
            </div>
          </div>
          <p v-if="focusStatus === 'pending'" role="status" class="text-sm text-muted">Looking up the food…</p>
          <UAlert v-else-if="focusError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="focusErrorText" class="rounded-card px-3 py-2.5 text-sm">
            <template v-if="![400, 404].includes(focusError.statusCode ?? 0)" #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="loadFocusFood()" /></template>
          </UAlert>
          <template v-else-if="focusFood">
            <template v-if="focusFood.active">
              <p class="text-sm text-muted">Choose the grocery item that is {{ focusFood.name }}. Its purchases will then price this ingredient.</p>
              <UFormField label="Grocery item" :ui="fieldUi" class="w-72 max-sm:w-full">
                <UInputMenu
                  :model-value="focusPick"
                  :items="focusItemOptions"
                  virtualize
                  by="value"
                  label-key="label"
                  description-key="description"
                  open-on-focus
                  open-on-click
                  :loading="mappingBusy !== null"
                  :disabled="mappingBusy !== null"
                  placeholder="Search grocery items…"
                  class="w-full"
                  @update:model-value="pickFocusItem"
                />
              </UFormField>
            </template>
            <p v-else class="text-sm text-muted">
              {{ focusMapped.length ? `${focusMapped.length === 1 ? 'This grocery item maps' : `These ${focusMapped.length} grocery items map`} to a food that is inactive in Mealie. Choose a replacement for ${focusMapped.length === 1 ? 'it' : 'each'} below.` : 'No grocery item maps to this food any more.' }}
            </p>
            <UAlert v-if="focusMessage" :color="focusMessage.ok ? 'success' : 'error'" variant="soft" :icon="focusMessage.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" :description="focusMessage.text" class="rounded-card px-3 py-2.5 text-sm" />
            <p v-if="focusFood.active" data-testid="food-focus-mapped" class="text-sm">
              <span class="text-muted">Mapped to this food:</span> {{ focusMapped.length ? focusMapped.map(mapping => mapping.item).join(', ') : 'no grocery items yet' }}
            </p>
          </template>
          <div class="grid gap-1.5">
            <UFormField label="Find another Mealie food" :ui="fieldUi" class="w-72 max-sm:w-full">
              <UInput v-model="focusSearch" type="search" placeholder="Wrong food? Search others…" icon="i-lucide-search" class="w-full" />
            </UFormField>
            <p v-if="focusSearchError" role="alert" class="text-xs text-danger">{{ focusSearchError }}</p>
            <p role="status" class="text-sm text-muted empty:hidden">{{ focusSearchStatus }}</p>
            <ul v-if="focusSearch.trim() && !focusSearching && focusFoodResults.length" data-testid="food-focus-results" class="m-0 flex list-none flex-wrap gap-1 p-0">
              <li v-for="food in focusFoodResults" :key="food.id"><UButton class="touch-target" type="button" :label="food.name" color="neutral" variant="ghost" @click="focusOtherFood(food.id)" /></li>
            </ul>
          </div>
        </section>
        <UFormField label="Search items and foods" :ui="fieldUi" class="mt-4.5 w-full max-w-md">
          <UInput v-model="listSearch" type="search" placeholder="Search items and foods…" icon="i-lucide-search" class="w-full" :ui="{ trailing: 'pe-1' }">
            <template v-if="listSearch" #trailing>
              <UButton type="button" aria-label="Clear search" icon="i-lucide-x" color="neutral" variant="link" size="sm" @click="listSearch = ''" />
            </template>
          </UInput>
        </UFormField>
        <UTabs v-model="filter" :items="filterTabs" :content="false" size="sm" aria-label="Filter food mappings" class="mt-3" :ui="{ list: 'max-sm:grid max-sm:grid-cols-2', indicator: 'max-sm:hidden', trigger: 'touch-target max-sm:data-[state=active]:rounded-md max-sm:data-[state=active]:bg-primary' }" />
        <UAlert v-if="mappingError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="mappingError" class="mt-4 rounded-card px-3 py-2.5 text-sm" />
        <UAlert v-if="mappingsError || unmappedError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not load the food mappings." class="mt-4 rounded-card px-3 py-2.5 text-sm">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="refreshLists()" /></template>
        </UAlert>
        <UAlert v-if="problemsError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not check for missing package sizes." class="mt-4 rounded-card px-3 py-2.5 text-sm">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="refreshProblems()" /></template>
        </UAlert>
        <p v-if="filter === 'attention'" class="mt-3 max-w-[38.75rem] text-sm text-muted">Mappings to fix before recipes can be fully costed. An item with no package size needs a size and unit on at least one purchase.</p>
        <p v-if="mappingsLoading" class="mt-4 text-muted">Loading food mappings…</p>
        <p v-else-if="!mappingsError && !unmappedError && !filteredRows.length" class="mt-4 text-sm text-muted">Nothing here.</p>
        <ul v-else-if="!mappingsError && !unmappedError" data-testid="food-mapping-list" class="m-[1.125rem_0_0] list-none rounded-card p-0 border border-line">
          <li v-for="row in visibleList" :key="row.item" class="flex items-center justify-between gap-[0.875rem] min-h-[3.875rem] p-[0.625rem_0.75rem_0.625rem_1rem] border-t border-line first:border-t-0 max-sm:flex-col max-sm:items-stretch">
            <div class="min-w-0 break-words">
              <strong class="block">{{ row.item }}</strong>
              <span class="mt-[0.1875rem] flex flex-wrap items-center gap-1.5 text-muted text-xs">
                <template v-if="row.mapping">
                  <span>{{ row.mapping.foodName ?? 'Food no longer in Mealie' }}</span>
                  <UBadge v-if="row.mapping.broken" label="Broken" color="error" variant="soft" size="sm" />
                  <UBadge v-if="!row.mapping.hasEntries" label="No entries" color="neutral" variant="soft" size="sm" />
                  <UBadge v-if="noPackageSize.has(row.item)" label="No package size" color="neutral" variant="soft" size="sm" />
                </template>
                <span v-else>Unmapped · {{ entryLabel(row.entries ?? 0) }}</span>
              </span>
              <UButton v-if="row.mapping && noPackageSize.has(row.item)" :to="`${itemPath(row.item)}?from=mealie`" label="Add package size" :aria-label="`Add a package size for ${row.item}`" trailing-icon="i-lucide-arrow-right" color="neutral" variant="ghost" size="sm" class="mt-1 -ml-2.5" />
              <template v-if="needsFood(row)">
                <p v-if="suggestions.get(row.item) === null" class="mt-1.5 text-xs text-muted">Looking for a suggestion…</p>
                <p v-else-if="suggestions.get(row.item) === 'failed'" role="alert" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-danger">
                  Could not load suggestions.
                  <UButton type="button" label="Try again" :aria-label="`Try the suggestions for ${row.item} again`" color="neutral" variant="link" size="xs" @click="loadSuggestions(row.item)" />
                </p>
                <p v-else-if="topSuggestion(row)" data-testid="food-suggestion" class="mt-1.5 text-sm">
                  {{ row.mapping ? 'Suggested replacement' : 'Suggested food' }}: <strong class="font-bold">{{ topSuggestion(row)!.foodName }}</strong>
                  <span class="block text-xs text-muted">{{ matchReason(topSuggestion(row)!) }}</span>
                </p>
              </template>
            </div>
            <div v-if="editingItem === row.item" class="flex flex-wrap items-end gap-1 sm:justify-end">
              <UFormField label="Mealie food" :ui="fieldUi" class="w-60 max-sm:w-full">
                <UInputMenu
                  :model-value="pickedFood"
                  v-model:search-term="foodSearch"
                  :items="foodOptions"
                  by="value"
                  label-key="label"
                  ignore-filter
                  default-open
                  autofocus
                  open-on-focus
                  open-on-click
                  :loading="foodsLoading || mappingBusy === row.item"
                  placeholder="Search foods…"
                  class="w-full"
                  :ui="{ itemDescription: 'whitespace-normal' }"
                  @update:model-value="(food?: FoodOption | null) => pickFood(row.item, food)"
                />
              </UFormField>
              <UButton class="touch-target" type="button" label="Cancel" color="neutral" variant="ghost" @click="editingItem = null" />
              <p v-if="foodsError" role="alert" class="w-full text-xs text-danger">{{ foodsError }}</p>
            </div>
            <div v-else class="flex flex-wrap gap-1">
              <UButton v-if="topSuggestion(row)" class="touch-target" type="button" label="Accept" :aria-label="`Accept ${topSuggestion(row)!.foodName} for ${row.item}`" icon="i-lucide-check" color="neutral" variant="ghost" :loading="mappingBusy === row.item" :disabled="Boolean(mappingBusy)" @click="saveFood(row.item, topSuggestion(row)!.mealieFoodId)" />
              <!-- A mapping can only be set on an item with entries, so one without can only be cleared. -->
              <UButton v-if="!row.mapping || row.mapping.hasEntries" class="touch-target" type="button" :label="chooseLabel(row)" :aria-label="`${chooseLabel(row)} for ${row.item}`" icon="i-lucide-search" color="neutral" variant="ghost" @click="chooseFood(row.item)" />
              <UButton v-if="row.mapping" class="touch-target" type="button" label="Clear" :aria-label="`Clear mapping for ${row.item}`" icon="i-lucide-unlink" color="error" variant="ghost" @click="clearing = row.mapping" />
            </div>
          </li>
        </ul>
        <UButton v-if="filteredRows.length > visibleRows" class="mt-4 w-full justify-center" type="button" label="Show 30 more" icon="i-lucide-chevron-down" color="neutral" variant="ghost" @click="visibleRows += 30" />
      </div>
    </UCard>


    <ConfirmModal
      :open="Boolean(forceConfirmation)"
      title="Deactivate these foods?"
      :description="`${forceConfirmation}. Mealie may have returned a partial list. Only force the sync if these foods really were removed: mappings to them will be flagged as broken.`"
      confirm-label="Force sync"
      confirm-color="error"
      :loading="syncing"
      @update:open="!$event && (forceConfirmation = '')"
      @confirm="sync(true)"
    />
    <ConfirmModal
      :open="Boolean(clearing)"
      title="Clear this mapping?"
      :description="`Remove the Mealie food from “${clearing?.item}”? You can map it again later.`"
      confirm-label="Clear mapping"
      confirm-color="error"
      :loading="clearBusy"
      @update:open="!$event && (clearing = null)"
      @confirm="confirmClear"
    />
  </section>
</template>
