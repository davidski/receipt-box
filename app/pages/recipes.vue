<script setup lang="ts">
type RecipeRow = { id: string, name: string, lineCount: number, savedTotal: number | string | null, savedAt: string, currentTotal: number | null }
type SortKey = 'name' | 'now' | 'change'

const { apiUrl } = useApi()
const recipes = ref<RecipeRow[]>([])
const loading = ref(true)
const loadError = ref('')
const search = ref('')
const sortKey = ref<SortKey>('change')
const sortDesc = ref(true)

const cents = (value: number | string | null) => value === null ? null : Math.round(Number(value) * 100)
const currency = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)
const dateText = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })

// Change in cents (now minus saved); null when either total is missing.
function changeOf(recipe: RecipeRow) {
  const now = cents(recipe.currentTotal)
  const saved = cents(recipe.savedTotal)
  return now === null || saved === null ? null : now - saved
}

const sortValue: Record<SortKey, (recipe: RecipeRow) => string | number | null> = {
  name: recipe => recipe.name.toLowerCase(),
  now: recipe => cents(recipe.currentTotal),
  change: changeOf
}

const rows = computed(() => {
  const term = search.value.trim().toLowerCase()
  const value = sortValue[sortKey.value]
  const direction = sortDesc.value ? -1 : 1
  return recipes.value
    .filter(recipe => recipe.name.toLowerCase().includes(term))
    .sort((a, b) => {
      const left = value(a)
      const right = value(b)
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
      return left === right ? 0 : (left < right ? -1 : 1) * direction
    })
})

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else {
    sortKey.value = key
    sortDesc.value = key !== 'name'
  }
}

// -mx-2 cancels the ghost button's padding so header labels line up with the cell text below.
const sortButtonClass = '-mx-2 text-xs font-[750] tracking-[.08em] uppercase'
const ariaSort = (key: SortKey) => sortKey.value === key ? (sortDesc.value ? 'descending' : 'ascending') : 'none'

async function load() {
  loading.value = true
  try {
    recipes.value = await $fetch<RecipeRow[]>(apiUrl('/recipes'))
    loadError.value = ''
  } catch (error: any) {
    loadError.value = error?.data?.statusMessage || error?.message || 'Could not load recipes.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto w-full max-w-300">
    <header class="page-heading my-[0.9375rem] mb-8">
      <div>
        <h1 class="leading-[1.04] text-display">Recipes</h1>
        <p>Saved recipes, priced at what you last paid.</p>
      </div>
    </header>

    <UAlert v-if="loadError" data-recipes-error role="alert" class="mb-4" color="error" variant="soft" icon="i-lucide-circle-alert" :description="loadError">
      <template #actions>
        <UButton label="Retry" color="neutral" variant="outline" size="sm" :loading="loading" @click="load" />
      </template>
    </UAlert>

    <p v-else-if="loading" data-recipes-loading role="status" class="flex items-center gap-2 text-(--muted)">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" aria-hidden="true" />Loading recipes…
    </p>

    <div v-else-if="!recipes.length" data-recipes-empty class="grid place-items-center gap-3 rounded-card border border-dashed border-line p-9 text-center">
      <p class="m-0 font-semibold">No saved recipes yet</p>
      <UButton to="/recipe" label="Create your first recipe" icon="i-lucide-chef-hat" />
    </div>

    <template v-else-if="recipes.length">
      <div data-recipes-toolbar class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <UInput v-model="search" aria-label="Search recipes" placeholder="Search recipes…" icon="i-lucide-search" class="w-full sm:max-w-sm" />
        <UButton to="/recipe" icon="i-lucide-plus" label="New recipe" />
      </div>

      <p v-if="!rows.length" data-recipes-no-match class="text-(--muted)">No recipes match “{{ search.trim() }}”.</p>

      <div v-else class="overflow-x-auto rounded-[1.5rem] shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
        <table data-recipes-table class="w-full border-collapse text-base">
          <thead class="text-left text-xs font-[750] tracking-[.08em] text-(--muted) uppercase [background:var(--surface-muted)]">
            <tr>
              <th scope="col" :aria-sort="ariaSort('name')" class="px-4 py-2">
                <UButton label="Recipe" color="neutral" variant="ghost" size="xs" :class="sortButtonClass" :trailing-icon="sortKey === 'name' ? (sortDesc ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : undefined" @click="sortBy('name')" />
              </th>
              <th scope="col" class="px-4 py-2 text-right">Items</th>
              <th scope="col" :aria-sort="ariaSort('now')" class="px-4 py-2 text-right">
                <UButton label="Now" color="neutral" variant="ghost" size="xs" :class="sortButtonClass" :leading-icon="sortKey === 'now' ? (sortDesc ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : undefined" @click="sortBy('now')" />
              </th>
              <th scope="col" class="px-4 py-2 text-right">Saved</th>
              <th scope="col" :aria-sort="ariaSort('change')" class="px-4 py-2 text-right">
                <UButton label="Change" color="neutral" variant="ghost" size="xs" :class="sortButtonClass" :leading-icon="sortKey === 'change' ? (sortDesc ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : undefined" @click="sortBy('change')" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="recipe in rows" :key="recipe.id" data-recipes-row class="[border-top:1px_solid_var(--line)]">
              <td class="px-4 py-3 font-semibold">
                <NuxtLink :to="`/recipe?recipe=${recipe.id}`" class="text-(--accent-strong) no-underline hover:underline">{{ recipe.name }}</NuxtLink>
              </td>
              <td class="px-4 py-3 text-right">{{ recipe.lineCount }}</td>
              <td data-col="now" class="px-4 py-3 text-right">{{ recipe.currentTotal === null ? '—' : currency(recipe.currentTotal) }}</td>
              <td data-col="saved" class="px-4 py-3 text-right">
                <template v-if="recipe.savedTotal === null">—</template>
                <template v-else>{{ currency(Number(recipe.savedTotal)) }}</template>
                <span class="block text-sm text-(--muted)">{{ dateText(recipe.savedAt) }}</span>
              </td>
              <td data-col="change" class="px-4 py-3 text-right">
                <PriceChange v-if="changeOf(recipe) !== null" :value="changeOf(recipe)! / 100" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
