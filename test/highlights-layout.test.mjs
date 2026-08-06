import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

test('the Highlights period field accommodates its longest option without overflowing', () => {
  assert.match(stylesheet, /\.period-field \{ width: 240px; \}/)
  assert.match(stylesheet, /\.period-field \[data-slot="base"\] \{ width: 100%; \}/)
  assert.match(stylesheet, /\.period-field \{ width: min\(240px, 100%\); \}/)
})
