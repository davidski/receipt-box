<script setup lang="ts">
import { costPerServingLowerBound } from '../../../shared/utils/recipe-cost'

type Failure = 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'NO_QUANTITY' | 'NO_UNIT' | 'UNSTANDARDIZED_UNIT' | 'DIMENSION_MISMATCH'
  | 'SUBRECIPE_UNSUPPORTED' | 'NO_FOOD' | 'UNKNOWN_FOOD' | 'INACTIVE_MEALIE_FOOD' | 'NO_PRODUCT_MAPPING'
type Base = { base: string, amount: number }
type Purchase = { item: string, price: string | number, size: string | number | null, unit: string | null, purchasedOn: string, usedSalePrice: boolean }
type Ingredient = {
  food: { id: string, name: string | null } | null
  note: string | null
  recipe: string | null
  quantity: number | null
  unit: { id: string | null, name: string | null } | null
  normalizedQuantity: Base | null
  purchase: Purchase | null
  normalizedPackageQuantity: Base | null
  cost: number | null
  status: 'exact' | 'unit_converted' | 'uncosted'
  error: Failure | null
}
type RecipeCost = {
  slug: string
  url: string | null
  name: string
  servings: number | null
  ingredients: Ingredient[]
  summary: { cost: number, costPerServing: number | null, costedIngredients: number, totalIngredients: number, uncosted: { error: Failure }[] }
}

definePageMeta({ middleware: 'mealie' })

const failureText: Record<Failure, string> = {
  NO_PRICE: 'No purchase recorded',
  NO_PACKAGE_SIZE: 'No purchase with a package size',
  NO_QUANTITY: 'No quantity in the recipe',
  NO_UNIT: 'Unit isn\'t linked to a Mealie unit',
  UNSTANDARDIZED_UNIT: 'Unit isn\'t a standard measure',
  DIMENSION_MISMATCH: 'Unit can\'t be converted to the unit it was bought in',
  SUBRECIPE_UNSUPPORTED: 'Sub-recipes aren\'t costed',
  NO_FOOD: 'No Mealie food on this line',
  UNKNOWN_FOOD: 'Food hasn\'t reached Receipt Box yet',
  INACTIVE_MEALIE_FOOD: 'Mealie food is inactive',
  NO_PRODUCT_MAPPING: 'Not mapped to a grocery item'
}
// Failures a mapping change in Manage → Mealie can fix, with the action the button names.
const fixLabel: Partial<Record<Failure, string>> = {
  NO_PRODUCT_MAPPING: 'Map to a grocery item',
  INACTIVE_MEALIE_FOOD: 'Replace the inactive food',
  UNKNOWN_FOOD: 'Sync Mealie foods'
}

const route = useRoute()
const { apiUrl } = useApi()
const slug = computed(() => String(route.params.slug))
const { data: recipe, error, status, refresh } = await useFetch<RecipeCost>(() => apiUrl(`/mealie/recipes/${encodeURIComponent(slug.value)}/cost`), { server: false })

const summary = computed(() => recipe.value?.summary)
// Compared as line counts: the API's coverage percent rounds down and is 0 for a recipe with no ingredients.
const partial = computed(() => !!summary.value && summary.value.costedIngredients < summary.value.totalIngredients)
// A lower bound rounds down; a complete figure keeps the API's nearest-cent value.
const perServing = computed(() => {
  if (!recipe.value?.servings || !summary.value) return null
  return partial.value ? costPerServingLowerBound(summary.value.cost, recipe.value.servings) : summary.value.costPerServing
})
const missing = computed(() => {
  const counts = new Map<Failure, number>()
  for (const { error } of summary.value?.uncosted ?? []) counts.set(error, (counts.get(error) ?? 0) + 1)
  return [...counts].map(([code, count]) => `${failureText[code]} (${count})`)
})
// Only a priced ingredient has a breakdown; a failed one shows its reason instead. Ingredients have no key, so the open state follows the row index and resets with each fetch.
const breakdownFor = (line: Ingredient) => line.error || line.cost === null || !line.purchase ? null : { purchase: line.purchase, normalizedQuantity: line.normalizedQuantity, normalizedPackageQuantity: line.normalizedPackageQuantity, status: line.status }
const openBreakdowns = ref(new Set<number>())
function toggleBreakdown(index: number) {
  if (openBreakdowns.value.has(index)) openBreakdowns.value.delete(index)
  else openBreakdowns.value.add(index)
}
watch(recipe, () => openBreakdowns.value.clear())
const errorText = computed(() => {
  const code = (error.value as any)?.statusCode
  if (code === 404) return 'This recipe was not found in Mealie. It may have been renamed or deleted.'
  const reason = (error.value as any)?.data?.statusMessage || error.value?.message
  return code === 502 ? `Mealie couldn't be reached or returned an error. ${reason}` : reason || 'Could not cost this recipe.'
})

const name = (line: Ingredient) => line.food?.name ?? line.recipe ?? line.note ?? 'Unnamed ingredient'
// Mealie stores 0 for an unparsed quantity, so it is hidden like a missing one.
const quantity = (line: Ingredient) => [line.quantity || null, line.unit?.name].filter(part => part !== null && part !== undefined && part !== '').join(' ')
// Manage lists grocery items, so the link carries the Mealie food and opens the mapping page focused on it.
const fixLink = (line: Ingredient) => ({ path: '/data/mealie', query: { food: line.food!.id, recipe: slug.value, name: name(line) } })
</script>

<template>
  <div class="mx-auto w-full max-w-300">
    <UButton to="/mealie-recipes" icon="i-lucide-arrow-left" label="Mealie recipes" color="neutral" variant="ghost" class="-ml-2.5 mb-2" />

    <UAlert v-if="error" data-mealie-cost-error role="alert" class="mb-4" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorText">
      <template #actions>
        <UButton v-if="(error as any).statusCode !== 404" label="Retry" color="neutral" variant="outline" size="sm" :loading="status === 'pending'" @click="() => refresh()" />
      </template>
    </UAlert>

    <p v-else-if="!recipe" role="status" class="flex items-center gap-2 text-(--muted)">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" aria-hidden="true" />Costing recipe…
    </p>

    <template v-else-if="summary">
      <header class="page-heading my-[0.9375rem] mb-8 flex flex-wrap items-end justify-between gap-3">
        <h1 class="leading-[1.04] text-display">{{ recipe.name }}</h1>
        <UButton v-if="recipe.url" :to="recipe.url" target="_blank" rel="noopener" label="Open in Mealie" :aria-label="`Open ${recipe.name} in Mealie, in a new window`" icon="i-brand-mealie" trailing-icon="i-lucide-external-link" color="neutral" variant="ghost" size="md" />
      </header>

      <dl data-mealie-cost-summary class="mb-8 grid grid-cols-[auto_1fr] items-baseline gap-x-8 gap-y-2 rounded-card p-6 [background:var(--surface)] [border:1px_solid_var(--line)]">
        <dt class="text-(--muted)">Estimated cost</dt>
        <dd data-summary="cost" class="m-0 text-heading font-bold text-(--accent-strong)">
          <template v-if="!summary.totalIngredients">—</template>
          <template v-else><template v-if="partial">≥ </template><MoneyAmount :value="summary.cost" /></template>
        </dd>
        <dt class="text-(--muted)">{{ recipe.servings ? `${recipe.servings} ${recipe.servings === 1 ? 'serving' : 'servings'}` : 'Servings' }}</dt>
        <dd data-summary="per-serving" class="m-0 font-bold">
          <template v-if="perServing === null || !summary.totalIngredients"><span class="font-normal text-(--muted)">{{ recipe.servings ? '—' : 'Not set in Mealie' }}</span></template>
          <template v-else><template v-if="partial">≥ </template><MoneyAmount :value="perServing" /> / serving</template>
        </dd>
        <dt class="text-(--muted)">Coverage</dt>
        <dd data-summary="coverage" class="m-0 font-bold">{{ summary.costedIngredients }} / {{ summary.totalIngredients }} ingredients</dd>
        <template v-if="missing.length">
          <dt class="text-(--muted)">Missing</dt>
          <dd data-summary="missing" class="m-0 text-sm">
            <ul class="m-0 grid list-none gap-1 p-0">
              <li v-for="reason in missing" :key="reason">{{ reason }}</li>
            </ul>
          </dd>
        </template>
      </dl>

      <p v-if="!recipe.ingredients.length" data-mealie-cost-empty class="text-(--muted)">This recipe has no ingredients to cost.</p>

      <template v-else>
        <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-(--shadow) max-sm:overflow-visible max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
          <table data-mealie-cost-table :class="[cardTable, 'w-full border-collapse text-base max-sm:grid-cols-[minmax(0,1fr)]']">
            <caption class="sr-only">Ingredients and what each costs</caption>
            <thead class="text-left text-xs font-[750] tracking-[.08em] text-(--muted) uppercase [background:var(--surface-muted)]">
              <tr>
                <th scope="col" class="px-4 py-2">Ingredient</th>
                <th scope="col" class="px-4 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <!-- One tbody per ingredient: on a phone it is the card, so an open breakdown sits inside it. -->
            <tbody v-for="(line, index) in recipe.ingredients" :key="index" data-mealie-cost-group class="max-sm:gap-0! max-sm:rounded-card max-sm:border max-sm:border-line max-sm:bg-surface max-sm:shadow-(--shadow)">
              <tr data-mealie-cost-row class="max-sm:grid max-sm:gap-2.5 max-sm:p-4">
                <td data-label="Ingredient" :class="[tableCell, cardCell]">
                  <span class="font-semibold">{{ name(line) }}</span>
                  <span v-if="quantity(line)" class="text-sm text-(--muted) sm:ml-2">{{ quantity(line) }}</span>
                  <span v-if="line.error" class="flex flex-wrap items-center gap-x-3 text-sm text-(--muted)">
                    {{ failureText[line.error] }}
                    <UButton v-if="fixLabel[line.error] && line.food" :to="fixLink(line)" :label="fixLabel[line.error]" :aria-label="`${fixLabel[line.error]} for ${name(line)}`" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right" class="font-semibold max-sm:-ml-2.5" />
                  </span>
                </td>
                <td data-col="cost" data-label="Cost" :class="[tableCell, cardCell, 'text-right max-sm:text-left']">
                  <template v-if="line.cost !== null">
                    <MoneyAmount :value="line.cost" />
                    <SaleMark v-if="line.purchase?.usedSalePrice" class="ml-1.5" />
                    <UButton
                      v-if="breakdownFor(line)"
                      color="neutral"
                      variant="ghost"
                      :icon="openBreakdowns.has(index) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                      :aria-expanded="openBreakdowns.has(index)"
                      :aria-label="`How line ${index + 1} was priced`"
                      class="ml-1 max-sm:justify-self-start"
                      @click="toggleBreakdown(index)"
                    />
                  </template>
                  <template v-else>—</template>
                </td>
              </tr>
              <tr v-if="breakdownFor(line) && openBreakdowns.has(index)" data-mealie-cost-breakdown>
                <td colspan="2" class="px-4 pb-4 max-sm:block">
                  <div class="rounded-card bg-surface-muted p-3">
                    <RecipeCostBreakdown :line="breakdownFor(line)!" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-6 text-sm text-(--muted)">
          Fix mappings in <NuxtLink to="/data/mealie" class="text-(--accent-strong) underline">Manage → Mealie</NuxtLink>.
        </p>
      </template>
    </template>
  </div>
</template>
