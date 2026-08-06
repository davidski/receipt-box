import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const managePage = await readFile(new URL('../app/pages/data.vue', import.meta.url), 'utf8')
const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('the Manage section uses the standard desktop content width', () => {
  assert.match(managePage, /<div class="content-page">/)
  assert.doesNotMatch(managePage, /narrow-page/)
  assert.match(stylesheet, /\.content-page \{ width: min\(1200px, 100%\); margin: 0 auto; \}/)
})
