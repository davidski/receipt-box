<script setup lang="ts">
const route = useRoute()
const initialDate = computed(() => String(route.query.date || '').slice(0, 10))
const initialLocation = computed(() => String(route.query.location || ''))
</script>

<template>
  <div class="receipt-entry-layout">
    <ReceiptEntryForm :initial-date="initialDate" :initial-location="initialLocation" />
  </div>
</template>
