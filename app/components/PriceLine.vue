<script setup lang="ts">
import { sparklineCoordinates } from '../../shared/utils/highlight-reports'

// The app's price-line motif: what was paid over time, sale purchases as gold diamonds, the latest price as a dot.
const props = defineProps<{ values: number[], sale?: boolean[], label: string }>()

// Inset so end marks are not clipped by the viewBox.
const width = 120
const height = 32
const inset = 4
const points = computed(() => sparklineCoordinates(props.values, width - inset * 2, height - inset * 2)
  .map(([x, y], index) => ({ x: x + inset, y: y + inset, sale: props.sale?.[index] === true })))
const line = computed(() => points.value.map(point => `${point.x},${point.y}`).join(' '))
const latest = computed(() => points.value.at(-1))
// Dense lines get smaller diamonds so neighboring sales stay distinct instead of merging into a band.
const diamond = computed(() => props.values.length > 30 ? 2.5 : 4)
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="label" class="block h-6 w-full max-w-30 min-w-20 overflow-visible">
    <polyline :points="line" class="fill-none stroke-chart-series stroke-2 [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]" />
    <template v-for="(point, index) in points" :key="index">
      <path v-if="point.sale" data-sale-point class="fill-sale-mark stroke-surface" :d="`M ${point.x} ${point.y - diamond} L ${point.x + diamond} ${point.y} L ${point.x} ${point.y + diamond} L ${point.x - diamond} ${point.y} Z`" />
    </template>
    <circle v-if="latest && !latest.sale" data-latest-point class="fill-chart-series" :cx="latest.x" :cy="latest.y" r="2.5" />
  </svg>
</template>
