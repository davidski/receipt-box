<script setup lang="ts">
defineProps<{
  entry: {
    id: string
    item: string
    category: string | null
    saleItem: boolean
    nonGrocery: boolean
    notes: string | null
  }
  size: string
  price: string
}>()
</script>

<template>
  <li>
    <div class="min-w-0">
      <NuxtLink :to="itemPath(entry.item)" class="item-history-link inline-flex max-w-full items-center gap-[7px] text-inherit no-underline" :aria-label="`View normalized price history for ${entry.item}`">
        <strong>{{ entry.item }}</strong><UIcon name="i-lucide-chart-line" aria-hidden="true" />
      </NuxtLink>
      <span class="mt-1 flex flex-wrap items-center gap-[5px] text-xs text-(--muted)">
        {{ size }}
        <UBadge v-if="entry.category" :label="entry.category" color="primary" variant="soft" size="sm" />
        <UBadge v-if="entry.saleItem" label="Sale" color="warning" variant="soft" size="sm" />
        <UBadge v-if="entry.nonGrocery" label="Non-grocery" color="neutral" variant="soft" size="sm" />
      </span>
      <small v-if="entry.notes" class="block mt-[5px] text-(--muted) text-[12px] leading-[1.4]">{{ entry.notes }}</small>
    </div>
    <strong class="pt-[2px] text-sm tabular-nums">{{ price }}</strong>
  </li>
</template>
