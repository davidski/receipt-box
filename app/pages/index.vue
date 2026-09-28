<script setup lang="ts">
const route = useRoute()

// Preserve old receipt edit links while the home page becomes the browser.
if (route.query.location) {
  await navigateTo({
    path: '/receipts/new',
    query: { date: route.query.date, location: route.query.location }
  })
}
</script>

<template>
  <HistoryPage />
</template>
