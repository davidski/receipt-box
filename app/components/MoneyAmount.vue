<script setup lang="ts">
import { splitCurrency } from '../../shared/utils/money'

// Hero price figure: dollars at the surrounding size and weight, cents smaller and muted.
const props = defineProps<{ value: string | number }>()
const parts = computed(() => splitCurrency(props.value))
</script>

<template>
  <span class="tabular-nums tracking-[-0.02em]">{{ parts.whole }}<span class="text-cents font-semibold text-(--muted)">{{ parts.cents }}</span></span>
</template>
