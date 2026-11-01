<script setup lang="ts">
import { formatCurrency } from '../../shared/utils/money'

type Base = { base: string, amount: number }
type Purchase = { item: string, price: string | number, size: string | number | null, unit: string | null, purchasedOn: string, usedSalePrice: boolean }
// The purchase behind a priced line and how much of it the recipe uses.
type Breakdown = {
  purchase: Purchase
  normalizedQuantity: Base | null
  normalizedPackageQuantity: Base | null
  status: 'exact' | 'unit_converted' | 'uncosted'
}

const props = defineProps<{ line: Breakdown }>()

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const bought = computed(() => {
  const { size, unit, purchasedOn } = props.line.purchase
  const date = parseCalendarDate(purchasedOn)?.toLocaleDateString(undefined, { dateStyle: 'medium' }) ?? purchasedOn
  return size === null ? `Bought ${date}` : `${[Number(size), unit].filter(Boolean).join(' ')} on ${date}`
})
// A share under 1% reads as "under 1%", not as a misleading "0%".
const use = computed(() => {
  const need = props.line.normalizedQuantity
  const whole = props.line.normalizedPackageQuantity
  if (!need || !whole || whole.amount <= 0) return null
  const percent = need.amount / whole.amount * 100
  return {
    share: percent < 1 ? 'under 1% of the package' : `${Math.round(percent)}% of the package`,
    amounts: `${number.format(need.amount)} of ${number.format(whole.amount)} ${whole.base}`
  }
})
</script>

<template>
  <dl class="m-0 grid gap-x-6 gap-y-3 text-sm tabular-nums sm:grid-cols-3">
    <div>
      <dt class="label">Last bought</dt>
      <dd class="m-0">{{ line.purchase.item }}</dd>
      <dd class="m-0 text-muted">{{ bought }}</dd>
    </div>
    <div>
      <dt class="label">Paid</dt>
      <dd class="m-0">
        {{ formatCurrency(line.purchase.price) }}
        <SaleMark v-if="line.purchase.usedSalePrice" class="ml-1.5" />
      </dd>
    </div>
    <div v-if="use">
      <dt class="label">Recipe uses</dt>
      <dd class="m-0">{{ use.share }}</dd>
      <dd class="m-0 text-muted">{{ use.amounts }}<template v-if="line.status === 'unit_converted'">, units converted</template></dd>
    </div>
  </dl>
</template>
