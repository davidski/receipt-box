<script setup lang="ts">
import { STANDARD_UNITS } from '../../shared/utils/units'

defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ commit: [] }>()
const unitOptions: string[] = [...STANDARD_UNITS]
const open = ref(false)

function commitIfClosed(event: KeyboardEvent) {
  if (open.value) return
  event.preventDefault()
  emit('commit')
}
</script>

<template>
  <UInputMenu
    v-bind="$attrs"
    v-model="model"
    v-model:open="open"
    :items="unitOptions"
    mode="autocomplete"
    placeholder="Unit…"
    @keydown.enter.exact="commitIfClosed"
  />
</template>
