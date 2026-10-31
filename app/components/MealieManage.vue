<script setup lang="ts">
type MealieStatus = {
  configured: boolean
  lastSyncedAt: string | null
  lastError: string | null
  counts: { activeFoods: number, inactiveFoods: number, aliases: number, activeUnits: number, inactiveUnits: number } | null
}
type Mapping = { item: string, mealieFoodId: string, foodName: string | null, broken: boolean, hasEntries: boolean }
type ItemCount = { item: string, entries: number }
type Problems = { brokenMappings: Mapping[], orphanedMappings: Mapping[], unmappedItems: ItemCount[], itemsWithoutPackageSize: ItemCount[] }
type SyncResult = { status: 'skipped' } | { status: 'synced', foods: number, aliases: number, units: number, deactivatedFoods: number, deactivatedUnits: number }
type Filter = 'all' | 'mapped' | 'unmapped' | 'broken'
type Row = { item: string, entries?: number, mapping?: Mapping }
type Suggestion = { mealieFoodId: string, foodName: string, matchType: 'exact_name' | 'plural_name' | 'exact_alias' | 'normalized_name' | 'fuzzy', matchedText: string, similarity: number | null }

const { apiUrl } = useApi()
const { data: status, error: statusError, refresh: refreshStatus } = await useFetch<MealieStatus>(apiUrl('/mealie/status'))
const { data: mappings, status: mappingsStatus, error: mappingsError, refresh: refreshMappings } = await useFetch<{ mappings: Mapping[] }>(apiUrl('/food-mappings'))
const { data: unmapped, status: unmappedStatus, error: unmappedError, refresh: refreshUnmapped } = await useFetch<{ items: ItemCount[] }>(apiUrl('/food-mappings/unmapped'))
const { data: problems, status: problemsStatus, error: problemsError, refresh: refreshProblems } = await useFetch<Problems>(apiUrl('/food-mappings/problems'))

const syncing = ref(false)
const syncError = ref('')
const syncNotice = ref('')
const forceConfirmation = ref('')
const filter = ref<Filter>('all')
const visibleRows = ref(30)
const editingItem = ref<string | null>(null)
const foodSearch = ref('')
const pickedFood = ref<string>()
const foodResults = ref<{ id: string, name: string }[]>([])
const foodsLoading = ref(false)
const foodsError = ref('')
const mappingBusy = ref<string | null>(null)
const mappingError = ref('')
const clearing = ref<Mapping | null>(null)
const clearBusy = ref(false)
// By item name: null while loading, 'failed' after an error. A Map because item names are free text.
const suggestions = reactive(new Map<string, Suggestion[] | null | 'failed'>())

const counts = computed(() => status.value?.counts)
const allMappings = computed(() => mappings.value?.mappings ?? [])
const mappedRows = computed<Row[]>(() => allMappings.value.filter(mapping => !mapping.broken).map(mapping => ({ item: mapping.item, mapping })))
const brokenRows = computed<Row[]>(() => allMappings.value.filter(mapping => mapping.broken).map(mapping => ({ item: mapping.item, mapping })))
const unmappedRows = computed<Row[]>(() => (unmapped.value?.items ?? []).map(({ item, entries }) => ({ item, entries })))
const allRows = computed(() => [...brokenRows.value, ...unmappedRows.value, ...mappedRows.value])
const filterTabs = computed(() => [
  { label: `All (${allRows.value.length})`, value: 'all' },
  { label: `Mapped (${mappedRows.value.length})`, value: 'mapped' },
  { label: `Unmapped (${unmappedRows.value.length})`, value: 'unmapped' },
  { label: `Broken (${brokenRows.value.length})`, value: 'broken' }
])
const filteredRows = computed(() => ({ all: allRows.value, mapped: mappedRows.value, unmapped: unmappedRows.value, broken: brokenRows.value })[filter.value])
const visibleList = computed(() => filteredRows.value.slice(0, visibleRows.value))
const unloadedSuggestions = computed(() => visibleList.value.filter(row => needsFood(row) && !suggestions.has(row.item)).map(row => row.item))
// An empty search lists the suggestions, with their reasons, ahead of the catalog.
const foodOptions = computed(() => {
  const loaded = foodSearch.value.trim() ? null : suggestions.get(editingItem.value ?? '')
  const suggested = Array.isArray(loaded) ? loaded : []
  return [
    ...suggested.map(suggestion => ({ label: suggestion.foodName, value: suggestion.mealieFoodId, description: matchReason(suggestion) })),
    ...foodResults.value.filter(food => !suggested.some(suggestion => suggestion.mealieFoodId === food.id)).map(food => ({ label: food.name, value: food.id }))
  ]
})
const mappingsLoading = computed(() => [mappingsStatus.value, unmappedStatus.value].includes('pending') && !mappings.value)
const problemGroups = computed(() => [
  { title: 'Mapped to an inactive or missing food', rows: (problems.value?.brokenMappings ?? []).map(({ item, foodName }) => ({ item, detail: foodName ?? 'Food missing from the catalog' })) },
  { title: 'Mapped, but the item has no entries', rows: (problems.value?.orphanedMappings ?? []).map(({ item, foodName }) => ({ item, detail: foodName ?? 'Food missing from the catalog' })) },
  { title: 'Unmapped items', rows: (problems.value?.unmappedItems ?? []).map(entryRow) },
  { title: 'No usable package size', rows: (problems.value?.itemsWithoutPackageSize ?? []).map(entryRow) }
])

function entryRow({ item, entries }: ItemCount) {
  return { item, detail: entryLabel(entries) }
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
      : `Synced ${result.foods.toLocaleString()} foods, ${result.aliases.toLocaleString()} aliases and ${result.units.toLocaleString()} units. Deactivated ${result.deactivatedFoods.toLocaleString()} foods and ${result.deactivatedUnits.toLocaleString()} units.`
  } catch (error: any) {
    syncError.value = errorMessage(error, 'Could not sync Mealie')
    if (error?.data?.data?.forceable === true) forceConfirmation.value = syncError.value
  } finally {
    syncing.value = false
  }
  suggestionRun++
  suggestions.clear()
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
watch(filter, () => { visibleRows.value = 30 })
watch(unloadedSuggestions, items => items.forEach(item => loadSuggestions(item)))
onMounted(() => unloadedSuggestions.value.forEach(item => loadSuggestions(item)))
onBeforeUnmount(() => clearTimeout(searchTimer))

async function saveFood(item: string, mealieFoodId: string) {
  mappingBusy.value = item
  mappingError.value = ''
  try {
    await $fetch(apiUrl('/items/food'), { method: 'PUT', body: { item, mealieFoodId } })
    if (editingItem.value === item) editingItem.value = null
  } catch (error: any) {
    mappingError.value = errorMessage(error, `Could not map ${item}`)
    void loadSuggestions(item)
    // The catalog may have changed, so offer fresh results and let the same food be picked again.
    pickedFood.value = undefined
    void searchFoods()
  } finally {
    mappingBusy.value = null
  }
  await refreshLists()
}

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
        <h2 class="text-heading">Integration</h2>
        <p class="max-w-[38.75rem] text-muted leading-[1.55]">Receipt Box keeps a read-only copy of the Mealie foods and units. Syncing never changes anything in Mealie.</p>
        <UAlert v-if="statusError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not load the Mealie status." class="mt-4 rounded-card px-3 py-2.5 text-sm">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="refreshStatus()" /></template>
        </UAlert>
        <dl v-if="status" data-testid="mealie-status" class="mt-4.5 grid grid-cols-3 gap-3 max-sm:grid-cols-2">
          <div class="col-span-full"><dt class="text-xs text-muted">Last synced</dt><dd class="font-bold">{{ status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never' }}</dd></div>
          <template v-if="counts">
            <div><dt class="text-xs text-muted">Active foods</dt><dd class="font-bold">{{ counts.activeFoods.toLocaleString() }}</dd></div>
            <div><dt class="text-xs text-muted">Inactive foods</dt><dd class="font-bold">{{ counts.inactiveFoods.toLocaleString() }}</dd></div>
            <div><dt class="text-xs text-muted">Aliases</dt><dd class="font-bold">{{ counts.aliases.toLocaleString() }}</dd></div>
            <div><dt class="text-xs text-muted">Active units</dt><dd class="font-bold">{{ counts.activeUnits.toLocaleString() }}</dd></div>
            <div><dt class="text-xs text-muted">Inactive units</dt><dd class="font-bold">{{ counts.inactiveUnits.toLocaleString() }}</dd></div>
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
        <UTabs v-model="filter" :items="filterTabs" :content="false" size="sm" aria-label="Filter food mappings" class="mt-4.5" :ui="{ list: 'max-sm:grid max-sm:grid-cols-2', indicator: 'max-sm:hidden', trigger: 'touch-target max-sm:data-[state=active]:rounded-md max-sm:data-[state=active]:bg-primary' }" />
        <UAlert v-if="mappingError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="mappingError" class="mt-4 rounded-card px-3 py-2.5 text-sm" />
        <UAlert v-if="mappingsError || unmappedError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not load the food mappings." class="mt-4 rounded-card px-3 py-2.5 text-sm">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="refreshLists()" /></template>
        </UAlert>
        <p v-if="mappingsLoading" class="mt-4 text-muted">Loading food mappings…</p>
        <p v-else-if="!mappingsError && !unmappedError && !filteredRows.length" class="mt-4 text-sm text-muted">Nothing here.</p>
        <ul v-else-if="!mappingsError && !unmappedError" data-testid="food-mapping-list" class="m-[1.125rem_0_0] list-none rounded-card p-0 border border-line">
          <li v-for="row in visibleList" :key="row.item" class="flex items-center justify-between gap-[0.875rem] min-h-[3.875rem] p-[0.625rem_0.75rem_0.625rem_1rem] border-t border-line first:border-t-0 max-sm:flex-col max-sm:items-stretch">
            <div class="min-w-0 break-words">
              <strong class="block">{{ row.item }}</strong>
              <span class="mt-[0.1875rem] flex flex-wrap items-center gap-1.5 text-muted text-xs">
                <template v-if="row.mapping">
                  <span>{{ row.mapping.foodName ?? 'Food missing from the catalog' }}</span>
                  <UBadge v-if="row.mapping.broken" label="Broken" color="error" variant="soft" size="sm" />
                  <UBadge v-if="!row.mapping.hasEntries" label="No entries" color="warning" variant="soft" size="sm" />
                </template>
                <span v-else>Unmapped · {{ entryLabel(row.entries ?? 0) }}</span>
              </span>
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
            <div v-if="editingItem === row.item" class="flex flex-wrap items-center gap-1 sm:justify-end">
              <USelectMenu
                v-model="pickedFood"
                v-model:search-term="foodSearch"
                :items="foodOptions"
                value-key="value"
                label-key="label"
                ignore-filter
                default-open
                :loading="foodsLoading || mappingBusy === row.item"
                :aria-label="`Mealie food for ${row.item}`"
                placeholder="Search foods…"
                :search-input="{ placeholder: 'Search foods…' }"
                class="w-60 max-sm:w-full"
                :ui="{ itemDescription: 'whitespace-normal' }"
                @update:model-value="(food: string) => saveFood(row.item, food)"
              />
              <UButton class="touch-target" type="button" label="Cancel" color="neutral" variant="ghost" @click="editingItem = null" />
              <p v-if="foodsError" role="alert" class="w-full text-xs text-danger">{{ foodsError }}</p>
            </div>
            <div v-else class="flex flex-wrap gap-1">
              <UButton v-if="topSuggestion(row)" class="touch-target" type="button" label="Accept" :aria-label="`Accept ${topSuggestion(row)!.foodName} for ${row.item}`" icon="i-lucide-check" :loading="mappingBusy === row.item" :disabled="Boolean(mappingBusy)" @click="saveFood(row.item, topSuggestion(row)!.mealieFoodId)" />
              <!-- A mapping can only be set on an item with entries, so one without can only be cleared. -->
              <UButton v-if="!row.mapping || row.mapping.hasEntries" class="touch-target" type="button" :label="chooseLabel(row)" :aria-label="`${chooseLabel(row)} for ${row.item}`" icon="i-lucide-search" color="neutral" variant="ghost" @click="chooseFood(row.item)" />
              <UButton v-if="row.mapping" class="touch-target" type="button" label="Clear" :aria-label="`Clear mapping for ${row.item}`" icon="i-lucide-unlink" color="error" variant="ghost" @click="clearing = row.mapping" />
            </div>
          </li>
        </ul>
        <UButton v-if="filteredRows.length > visibleRows" class="mt-4 w-full justify-center" type="button" label="Show 30 more" icon="i-lucide-chevron-down" color="neutral" variant="outline" @click="visibleRows += 30" />
      </div>
    </UCard>

    <UCard class="mt-4.5 grid grid-cols-[3.375rem_1fr] gap-5 p-[clamp(1.375rem,4vw,2.125rem)] border border-line rounded-card bg-surface shadow-(--shadow) max-sm:grid-cols-1" :ui="{ body: 'contents' }">
      <div class="grid size-[3.125rem] place-items-center rounded-card text-heading text-accent-strong bg-accent-soft" aria-hidden="true"><UIcon name="i-lucide-triangle-alert" /></div>
      <div class="min-w-0">
        <h2 class="text-heading">Problems</h2>
        <p class="max-w-[38.75rem] text-muted leading-[1.55]">Worked out from cached data only, without contacting Mealie.</p>
        <UAlert v-if="problemsError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not load the problems." class="mt-4 rounded-card px-3 py-2.5 text-sm">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="refreshProblems()" /></template>
        </UAlert>
        <p v-else-if="problemsStatus === 'pending' && !problems" class="mt-4 text-muted">Loading problems…</p>
        <div v-else data-testid="mealie-problems" class="mt-4.5 grid gap-4">
          <section v-for="group in problemGroups" :key="group.title" :aria-label="group.title">
            <h3 class="flex items-center gap-2 font-bold">{{ group.title }} <UBadge :label="String(group.rows.length)" :color="group.rows.length ? 'warning' : 'neutral'" variant="soft" size="sm" /></h3>
            <ul v-if="group.rows.length" tabindex="0" :aria-label="group.title" class="mt-1.5 max-h-64 list-none overflow-y-auto rounded-card p-0 border border-line">
              <li v-for="row in group.rows" :key="row.item" class="flex flex-wrap justify-between gap-x-3 p-[0.5rem_0.75rem] border-t border-line first:border-t-0 text-sm"><span class="min-w-0 break-words">{{ row.item }}</span><span class="text-xs text-muted">{{ row.detail }}</span></li>
            </ul>
            <p v-else class="mt-1 text-sm text-muted">None.</p>
          </section>
        </div>
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
