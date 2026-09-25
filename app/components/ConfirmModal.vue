<script setup lang="ts">
withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  confirmColor?: 'primary' | 'error' | 'warning'
  loading?: boolean
}>(), {
  confirmLabel: 'Confirm',
  confirmColor: 'primary',
  loading: false
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: []
}>()
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :description="description"
    :close="!loading"
    :dismissible="!loading"
    @update:open="emit('update:open', $event)"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton type="button" label="Cancel" color="neutral" variant="ghost" :disabled="loading" @click="emit('update:open', false)" />
        <UButton type="button" :label="confirmLabel" :color="confirmColor" :loading="loading" @click="emit('confirm')" />
      </div>
    </template>
  </UModal>
</template>
