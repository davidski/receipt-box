<script setup lang="ts">
import ManagePage from '~/components/ManagePage.vue'

definePageMeta({ middleware: 'manage', scrollToTop: to => !to.query.food })
</script>

<template>
  <ManagePage />
</template>
