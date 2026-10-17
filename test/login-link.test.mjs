import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const loginPage = await readFile(new URL('../app/pages/login.vue', import.meta.url), 'utf8')

test('the sign-in button navigates to the server-only OIDC route as a full page load', () => {
  assert.match(loginPage, /<UButton\s+:href="loginURL"\s+external\s/)
})
