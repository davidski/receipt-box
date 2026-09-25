<script setup lang="ts">
import HistoryPage from '~/components/HistoryPage.vue'

definePageMeta({ middleware: 'history' })
</script>

<template>
  <HistoryPage />
</template>
