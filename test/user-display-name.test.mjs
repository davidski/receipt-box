import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { userDisplayName } from '../shared/utils/user-display-name.ts'

const header = await readFile(new URL('../app/components/AppHeader.vue', import.meta.url), 'utf8')

test('prefers the OIDC given name', () => {
  assert.equal(userDisplayName({
    givenName: ' David ',
    name: 'David Example',
    preferredUsername: 'davidski'
  }), 'David')
})

test('uses the first part of the full name before falling back to username', () => {
  assert.equal(userDisplayName({ name: '  David   Example  ', preferredUsername: 'davidski' }), 'David')
  assert.equal(userDisplayName({ name: ' ', preferredUsername: ' davidski ' }), 'davidski')
})

test('omits an unusable identity label', () => {
  assert.equal(userDisplayName(), undefined)
  assert.equal(userDisplayName({ givenName: ' ', name: '', preferredUsername: '\t' }), undefined)
})

test('shows the identity subtly only for an authenticated OIDC session', () => {
  assert.match(header, /v-if="authEnabled && loggedIn && displayName"/)
  assert.match(header, /class="signed-in-user"/)
  assert.match(header, /Signed in as \$\{displayName\}/)
})
