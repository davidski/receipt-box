import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const unitInput = await readFile(new URL('../app/components/UnitInput.vue', import.meta.url), 'utf8')

test('selecting a Nuxt UI unit option does not also finish the receipt line', () => {
  assert.match(unitInput, /<UInputMenu/)
  assert.match(unitInput, /mode="autocomplete"/)
  assert.doesNotMatch(unitInput, /create-item/)
  assert.match(unitInput, /v-model:open="open"/)
  assert.match(unitInput, /@keydown\.enter\.exact="commitIfClosed"/)
  assert.match(unitInput, /if \(open\.value\) return/)
  assert.match(unitInput, /emit\('commit'\)/)
})
