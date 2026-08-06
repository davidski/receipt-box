import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  getAuthMode,
  missingOidcEnvironment,
  parseAuthMode,
  requiresApiAuthentication
} from '../server/utils/auth-policy.ts'

describe('parseAuthMode', () => {
  test('defaults to disabled and accepts normalized supported values', () => {
    assert.equal(parseAuthMode(undefined), 'disabled')
    assert.equal(parseAuthMode(''), 'disabled')
    assert.equal(parseAuthMode('  DISABLED '), 'disabled')
    assert.equal(parseAuthMode(' OIDC '), 'oidc')
  })

  test('rejects unsupported modes', () => {
    assert.throws(() => parseAuthMode('proxy'), /AUTH_MODE must be "disabled" or "oidc"/)
  })

  test('reads the process environment', () => {
    const previous = process.env.AUTH_MODE
    process.env.AUTH_MODE = 'oidc'
    try {
      assert.equal(getAuthMode(), 'oidc')
    } finally {
      if (previous === undefined) delete process.env.AUTH_MODE
      else process.env.AUTH_MODE = previous
    }
  })
})

describe('missingOidcEnvironment', () => {
  test('reports every missing or blank OIDC setting', () => {
    assert.deepEqual(missingOidcEnvironment({
      NUXT_SESSION_PASSWORD: ' ',
      NUXT_OAUTH_OIDC_CLIENT_ID: 'client'
    }), [
      'NUXT_SESSION_PASSWORD',
      'NUXT_OAUTH_OIDC_CLIENT_SECRET',
      'NUXT_OAUTH_OIDC_OPENID_CONFIG'
    ])
  })

  test('accepts a complete configuration', () => {
    assert.deepEqual(missingOidcEnvironment({
      NUXT_SESSION_PASSWORD: 'a secure session password',
      NUXT_OAUTH_OIDC_CLIENT_ID: 'client',
      NUXT_OAUTH_OIDC_CLIENT_SECRET: 'secret',
      NUXT_OAUTH_OIDC_OPENID_CONFIG: 'https://auth.example.test/.well-known/openid-configuration'
    }), [])
  })

  test('uses the process environment by default', () => {
    assert.ok(Array.isArray(missingOidcEnvironment()))
  })
})

describe('requiresApiAuthentication', () => {
  test('protects API roots and application endpoints', () => {
    assert.equal(requiresApiAuthentication('/api'), true)
    assert.equal(requiresApiAuthentication('/api/entries'), true)
    assert.equal(requiresApiAuthentication('/api/import?dry-run=true'), true)
    assert.equal(requiresApiAuthentication('/pricebook/api/receipts', '/pricebook/'), true)
  })

  test('allows only the authentication support and health endpoints', () => {
    assert.equal(requiresApiAuthentication('/api/health'), false)
    assert.equal(requiresApiAuthentication('/api/auth/config'), false)
    assert.equal(requiresApiAuthentication('/api/_auth'), false)
    assert.equal(requiresApiAuthentication('/api/_auth/session'), false)
    assert.equal(requiresApiAuthentication('/pricebook/api/health', '/pricebook/'), false)
  })

  test('ignores pages and paths outside the configured base URL', () => {
    assert.equal(requiresApiAuthentication('/'), false)
    assert.equal(requiresApiAuthentication('/login'), false)
    assert.equal(requiresApiAuthentication('/pricebook', '/pricebook/'), false)
    assert.equal(requiresApiAuthentication('/another/api/entries', '/pricebook/'), false)
  })
})
