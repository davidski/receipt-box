<script setup lang="ts">
import { STANDARD_UNITS } from '../../shared/utils/units'

defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ required: true })
const unitOptions: string[] = [...STANDARD_UNITS]
</script>

<template>
  <UInputMenu
    v-bind="$attrs"
    v-model="model"
    :items="unitOptions"
    create-item
    placeholder="Choose or add a unit…"
  />
</template>
