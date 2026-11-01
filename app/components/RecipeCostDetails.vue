<script setup lang="ts">
import { formatCurrency } from '../../shared/utils/money'

type Base = { base: string, amount: number }
type Purchase = { item: string, price: string | number, size: string | number | null, unit: string | null, purchasedOn: string, usedSalePrice: boolean }
// The same line shape comes from the Mealie cost endpoint and the native recipe-cost endpoint.
type DetailLine = {
  name: string
  purchase: Purchase
  normalizedQuantity: Base | null
  normalizedPackageQuantity: Base | null
  cost: number | null
  status: 'exact' | 'unit_converted' | 'uncosted'
}

defineProps<{ lines: DetailLine[] }>()

const amount = (value: Base) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value.amount)} ${value.base}`
const bought = (purchase: Purchase) => `${purchase.item}, ${[purchase.size === null ? null : Number(purchase.size), purchase.unit].filter(Boolean).join(' ')} for ${formatCurrency(purchase.price)} on ${parseCalendarDate(purchase.purchasedOn)?.toLocaleDateString(undefined, { dateStyle: 'medium' }) ?? purchase.purchasedOn}`
</script>

<template>
  <section v-if="lines.length" data-cost-details aria-label="Calculation details" class="mt-8">
    <h2 class="mb-1 text-heading">Calculation details</h2>
    <p class="m-0 text-sm text-(--muted)">Each line uses the latest purchase with a package size, prorated by the amount the recipe needs.</p>
    <ul class="m-0 mt-3 grid list-none gap-3 p-0">
      <li v-for="(line, index) in lines" :key="index" data-cost-detail class="rounded-card p-4 text-sm [border:1px_solid_var(--line)]">
        <strong>{{ line.name }}</strong>
        <span class="block text-(--muted) tabular-nums">Bought {{ bought(line.purchase) }}<SaleMark v-if="line.purchase.usedSalePrice" class="ml-1.5" /></span>
        <span v-if="line.cost !== null && line.normalizedQuantity && line.normalizedPackageQuantity" class="block text-(--muted) tabular-nums">
          {{ amount(line.normalizedQuantity) }} × {{ formatCurrency(line.purchase.price) }} ÷ {{ amount(line.normalizedPackageQuantity) }} = {{ formatCurrency(line.cost) }}<template v-if="line.status === 'unit_converted'"> (units converted)</template>
        </span>
      </li>
    </ul>
  </section>
</template>
