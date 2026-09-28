<script setup lang="ts">
definePageMeta({ key: 'receipt-editor' })

const route = useRoute()
const isNewReceipt = computed(() => route.params.id === 'new')
const receiptId = computed(() => isNewReceipt.value ? undefined : String(route.params.id || ''))
const initialDate = computed(() => isNewReceipt.value ? String(route.query.date || '').slice(0, 10) : '')
const initialLocation = computed(() => isNewReceipt.value ? String(route.query.location || '') : '')
</script>

<template>
  <div class="receipt-entry-layout">
    <ReceiptEntryForm :initial-date="initialDate" :initial-location="initialLocation" :initial-receipt-id="receiptId" />
  </div>
</template>
