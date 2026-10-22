<script setup lang="ts">
import { formatSignedCurrency, formatSignedPercent } from '../../shared/utils/money'

// The one treatment for a price movement (docs/design-system.md, State). Increases are `error`,
// decreases are `success`, anything else is neutral. Each carries a glyph and a signed figure,
// and screen readers hear "up $0.40" instead of the glyph ("No change" reads as is). Attributes such as `size` and `title`
// fall through to the badge.
const props = withDefaults(defineProps<{
  value: number | null
  unit?: 'currency' | 'percent'
  // Currency only: show whole dollars, for aggregates.
  whole?: boolean
  // Percent only: decimals to show.
  digits?: number
  // A caller's threshold for "too small to call": keeps the signed figure but drops the direction.
  flat?: boolean
}>(), { unit: 'currency', whole: false, digits: 0, flat: false })

const figure = computed(() => props.unit === 'percent'
  ? formatSignedPercent(props.value, { digits: props.digits })
  : formatSignedCurrency(props.value, { whole: props.whole }))

const view = computed(() => {
  const text = figure.value
  const sign = text[0]
  if (props.value === null || text === '—') return { color: 'neutral', icon: 'i-lucide-minus', text, spoken: 'no comparison' } as const
  if (props.value === 0) return { color: 'neutral', icon: 'i-lucide-minus', text: 'No change', spoken: null } as const
  // A move that rounds away, such as $0.40 in a whole-dollar total, is flat but not "No change".
  if (props.flat || (sign !== '+' && sign !== '−')) return { color: 'neutral', icon: 'i-lucide-minus', text, spoken: `flat, ${text}` } as const
  const amount = text.slice(1)
  return sign === '+'
    ? { color: 'error', icon: 'i-lucide-trending-up', text, spoken: `up ${amount}` } as const
    : { color: 'success', icon: 'i-lucide-trending-down', text, spoken: `down ${amount}` } as const
})
</script>

<template>
  <UBadge :color="view.color" :icon="view.icon" variant="soft" class="whitespace-nowrap tabular-nums">
    <span data-figure :aria-hidden="view.spoken ? 'true' : undefined">{{ view.text }}</span>
    <span v-if="view.spoken" class="sr-only">{{ view.spoken }}</span>
  </UBadge>
</template>
