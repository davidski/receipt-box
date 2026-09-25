<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = defineProps<{ items: string[] }>()
const model = defineModel<string | null>({ required: true })
const emit = defineEmits<{ change: [category: string | null], tabNext: [] }>()
const open = ref(false)

function selectCategory(value: string | null) {
  const category = value?.trim() || null
  model.value = category
  emit('change', category)
}

function createCategory(value: string | { value: string }) {
  selectCategory((typeof value === 'string' ? value : value.value).trim())
}

function advanceFromInput(event: KeyboardEvent) {
  event.preventDefault()
  open.value = false
  const clear = (event.currentTarget as HTMLElement).closest('.category-input')?.querySelector<HTMLButtonElement>('[data-category-clear]')
  if (clear && !clear.disabled) clear.focus()
  else emit('tabNext')
}
</script>

<template>
  <div class="category-input">
    <UInputMenu
      v-bind="$attrs"
      :model-value="model ?? ''"
      v-model:open="open"
      :items="props.items"
      :create-item="{ when: 'always', position: 'top' }"
      :maxlength="100"
      placeholder="Uncategorized"
      @update:model-value="selectCategory"
      @create="createCategory"
      @keydown.tab.exact="advanceFromInput"
    >
      <template #create-item-label="{ item }">Add “{{ item }}”</template>
    </UInputMenu>
    <UButton
      type="button"
      data-category-clear
      label="Clear item category"
      icon="i-lucide-x"
      color="neutral"
      variant="outline"
      size="sm"
      :disabled="model === null"
      @click="selectCategory(null)"
      @keydown.tab.exact.prevent="emit('tabNext')"
    />
  </div>
</template>
