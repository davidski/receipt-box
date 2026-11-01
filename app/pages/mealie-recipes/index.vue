<script setup lang="ts">
type MealieRecipe = { slug: string, name: string, servings: number | null }
type SortKey = 'name' | 'servings'

const PAGE_SIZE = 25

definePageMeta({ middleware: 'mealie' })

const { apiUrl } = useApi()
const { data, error, status, refresh } = await useFetch<{ recipes: MealieRecipe[] }>(apiUrl('/mealie/recipes'), { server: false })
const search = ref('')
const sortKey = ref<SortKey>('name')
const sortDesc = ref(false)
const page = ref(1)

const rows = computed(() => {
  const term = search.value.trim().toLowerCase()
  const direction = sortDesc.value ? -1 : 1
  return (data.value?.recipes ?? [])
    .filter(recipe => recipe.name.toLowerCase().includes(term))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      if (sortKey.value === 'name') return byName * direction
      // Missing servings sort last in either direction; ties fall back to name.
      if (a.servings === null || b.servings === null) return (a.servings === null ? 1 : 0) - (b.servings === null ? 1 : 0)
      return (a.servings - b.servings) * direction || byName
    })
})
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
watch([search, sortKey, sortDesc], () => { page.value = 1 })

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
const sortIcon = (key: SortKey) => sortKey.value === key ? (sortDesc.value ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : undefined
// Field spacing recipe from the design doc (Inputs, Field spacing).
const fieldSpacing = { container: 'mt-1.5 grid gap-2', help: 'mt-0', error: 'mt-0' }
const errorText = computed(() => (error.value as any)?.data?.statusMessage || error.value?.message || 'Could not load the Mealie recipes.')
</script>

<template>
  <div class="mx-auto w-full max-w-300">
    <UButton to="/recipes" icon="i-lucide-arrow-left" label="Recipes" color="neutral" variant="ghost" class="-ml-2.5 mb-2" />

    <header class="page-heading my-[0.9375rem] mb-8">
      <div>
        <h1 class="leading-[1.04] text-display">Mealie recipes</h1>
      </div>
    </header>

    <UAlert v-if="error" data-mealie-recipes-error role="alert" class="mb-4" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorText">
      <template #actions>
        <UButton label="Retry" color="neutral" variant="outline" size="sm" :loading="status === 'pending'" @click="() => refresh()" />
      </template>
    </UAlert>

    <p v-else-if="status === 'pending'" role="status" class="flex items-center gap-2 text-(--muted)">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" aria-hidden="true" />Loading recipes…
    </p>

    <p v-else-if="!data?.recipes.length" data-mealie-recipes-empty class="text-(--muted)">Mealie has no recipes yet.</p>

    <template v-else>
      <UFormField label="Search recipes" :ui="fieldSpacing" class="mb-4 w-full sm:max-w-sm">
        <UInput v-model="search" placeholder="Name of a recipe" icon="i-lucide-search" class="w-full" />
      </UFormField>
      <p v-if="!rows.length" data-mealie-recipes-no-match class="text-(--muted)">No recipes match “{{ search.trim() }}”.</p>
      <template v-else>
        <p data-mealie-recipes-count class="mb-2 text-sm text-(--muted)">{{ rows.length }} {{ rows.length === 1 ? 'recipe' : 'recipes' }}</p>
        <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-(--shadow) max-sm:overflow-visible max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
          <table :class="[cardTable, 'w-full border-collapse text-base max-sm:grid-cols-[minmax(0,1fr)]']">
            <caption class="sr-only">Mealie recipes and their servings</caption>
            <thead class="text-left text-xs font-[750] tracking-[.08em] text-(--muted) uppercase [background:var(--surface-muted)]">
              <tr>
                <th scope="col" :aria-sort="ariaSort('name')" class="px-4 py-2">
                  <UButton label="Recipe" color="neutral" variant="ghost" size="xs" :class="sortButtonClass" :trailing-icon="sortIcon('name')" @click="sortBy('name')" />
                </th>
                <th scope="col" :aria-sort="ariaSort('servings')" class="px-4 py-2 text-right">
                  <UButton label="Servings" color="neutral" variant="ghost" size="xs" :class="sortButtonClass" :leading-icon="sortIcon('servings')" @click="sortBy('servings')" />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="recipe in pageRows" :key="recipe.slug" data-mealie-recipe-row :class="cardRow">
                <td data-label="Recipe" :class="[tableCell, cardCell, 'font-semibold']">
                  <NuxtLink :to="`/mealie-recipes/${encodeURIComponent(recipe.slug)}`" class="text-(--accent-strong) no-underline hover:underline">{{ recipe.name }}</NuxtLink>
                </td>
                <td data-label="Servings" :class="[tableCell, cardCell, 'text-right tabular-nums max-sm:text-left']">{{ recipe.servings ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <UPagination v-if="rows.length > PAGE_SIZE" v-model:page="page" :items-per-page="PAGE_SIZE" :total="rows.length" class="mt-4 justify-center" />
      </template>
    </template>
  </div>
</template>
