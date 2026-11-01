import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import {
  MealieError,
  fetchMealieFoods,
  fetchMealieRecipe,
  fetchMealieRecipes,
  fetchMealieUnits,
  getMealieConfig,
  isMealieConfigured,
  mealieRecipeUrl
} from '../server/utils/mealie/client.ts'

const token = 'secret-test-token'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function page(items, total, totalPages, extra = {}) {
  return { page: 1, per_page: 200, total, total_pages: totalPages, items, next: null, previous: null, ...extra }
}

function stubFetch(implementation) {
  return mock.method(globalThis, 'fetch', implementation)
}

function assertNoSecret(error) {
  for (const text of [error.message, error.stack, String(error.cause), JSON.stringify(error)]) {
    assert.ok(!text.includes(token), 'token leaked into the error')
  }
}

function rejectsWith(promise, kind, status) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof MealieError)
    assert.equal(error.kind, kind)
    assert.equal(error.status, status)
    assertNoSecret(error)
    return true
  })
}

describe('getMealieConfig', () => {
  test('requires both settings', () => {
    assert.equal(getMealieConfig({}), null)
    assert.equal(getMealieConfig({ MEALIE_URL: 'https://mealie.example.com' }), null)
    assert.equal(getMealieConfig({ MEALIE_API_TOKEN: token }), null)
    assert.equal(getMealieConfig({ MEALIE_URL: '  ', MEALIE_API_TOKEN: token }), null)
    assert.equal(getMealieConfig({ MEALIE_URL: 'https://mealie.example.com', MEALIE_API_TOKEN: ' ' }), null)
    assert.equal(isMealieConfigured({ MEALIE_URL: 'https://mealie.example.com' }), false)
  })

  test('trims values and trailing slashes', () => {
    const environment = { MEALIE_URL: ' https://mealie.example.com/base/ ', MEALIE_API_TOKEN: ` ${token} ` }
    assert.deepEqual(getMealieConfig(environment), { url: 'https://mealie.example.com/base', token })
    assert.equal(isMealieConfigured(environment), true)
  })
})

describe('Mealie requests', () => {
  beforeEach(() => {
    process.env.MEALIE_URL = 'https://mealie.example.com/'
    process.env.MEALIE_API_TOKEN = token
  })

  afterEach(() => {
    delete process.env.MEALIE_URL
    delete process.env.MEALIE_API_TOKEN
    mock.restoreAll()
  })

  test('sends Bearer auth to the configured base URL', async () => {
    const fetchMock = stubFetch(async () => json(page([{ id: 'u1' }], 1, 1)))
    assert.deepEqual(await fetchMealieUnits(), [{ id: 'u1' }])
    const [url, init] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'https://mealie.example.com/api/units?page=1&perPage=200')
    assert.equal(init.headers.authorization, `Bearer ${token}`)
    assert.ok(init.signal instanceof AbortSignal)
  })

  test('follows every page in order', async () => {
    const fetchMock = stubFetch(async (url) => {
      const current = Number(new URL(url).searchParams.get('page'))
      return json(page([{ id: `f${current}` }], 3, 3))
    })
    assert.deepEqual(await fetchMealieFoods(), [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }])
    assert.equal(fetchMock.mock.callCount(), 3)
  })

  test('accepts camelCase and snake_case page counts', async () => {
    stubFetch(async () => json({ page: 1, perPage: 200, total: 1, totalPages: 1, items: [{ id: 'r1' }] }))
    assert.deepEqual(await fetchMealieRecipes(), [{ id: 'r1' }])
  })

  test('returns an empty catalog when Mealie reports zero pages', async () => {
    const fetchMock = stubFetch(async () => json(page([], 0, 0)))
    assert.deepEqual(await fetchMealieFoods(), [])
    assert.equal(fetchMock.mock.callCount(), 1)
  })

  test('encodes the recipe slug', async () => {
    const fetchMock = stubFetch(async () => json({ slug: 'a/b' }))
    assert.deepEqual(await fetchMealieRecipe('a/b'), { slug: 'a/b' })
    assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://mealie.example.com/api/recipes/a%2Fb')
  })

  test('maps a timeout', async () => {
    stubFetch(async () => { throw new DOMException('timed out', 'TimeoutError') })
    await rejectsWith(fetchMealieFoods(), 'timeout')
  })

  test('maps a timeout while reading the body', async () => {
    const response = new Response('{}')
    response.json = async () => { throw new DOMException('timed out', 'TimeoutError') }
    stubFetch(async () => response)
    await rejectsWith(fetchMealieFoods(), 'timeout')
  })

  test('maps a network failure without carrying its message', async () => {
    stubFetch(async () => { throw new TypeError(`bad header "Bearer ${token}"`) })
    await rejectsWith(fetchMealieFoods(), 'network')
  })

  test('maps non-2xx statuses and drops the response body', async () => {
    for (const status of [401, 404, 500]) {
      stubFetch(async () => new Response(`denied ${token}`, { status }))
      await rejectsWith(fetchMealieRecipe('soup'), 'http', status)
      mock.restoreAll()
    }
  })

  test('rejects malformed responses', async () => {
    const bodies = [
      new Response('<html>login</html>'),
      json([]),
      json({ total: 1, total_pages: 1 }),
      json(page('nope', 1, 1)),
      json(page([1], 1, 1)),
      json(page([], 1, 'one')),
      json(page([], -1, 1)),
      json(page([], 1, 1.5)),
      json(page([], 1, 2)),
      json(page([{ id: 'f1' }], 2, 1))
    ]
    for (const body of bodies) {
      stubFetch(async () => body)
      await rejectsWith(fetchMealieFoods(), 'malformed')
      mock.restoreAll()
    }
  })

  test('fails when a later page fails, returning nothing partial', async () => {
    let calls = 0
    stubFetch(async () => (++calls === 1 ? json(page([{ id: 'f1' }], 2, 2)) : new Response('', { status: 503 })))
    await rejectsWith(fetchMealieFoods(), 'http', 503)
  })

  test('does not call Mealie when disabled', async () => {
    const fetchMock = stubFetch(async () => json(page([], 0, 0)))
    for (const key of ['MEALIE_URL', 'MEALIE_API_TOKEN']) {
      const saved = process.env[key]
      delete process.env[key]
      await rejectsWith(fetchMealieFoods(), 'disabled')
      await rejectsWith(fetchMealieRecipe('soup'), 'disabled')
      process.env[key] = saved
    }
    assert.equal(fetchMock.mock.callCount(), 0)
  })
})

describe('mealieRecipeUrl', () => {
  beforeEach(() => {
    process.env.MEALIE_URL = 'https://mealie.example/'
    process.env.MEALIE_API_TOKEN = token
  })
  afterEach(() => {
    mock.restoreAll()
    delete process.env.MEALIE_URL
    delete process.env.MEALIE_API_TOKEN
  })

  test('builds the group path and encodes both segments', async () => {
    stubFetch(async () => json({ groupSlug: 'my home' }))
    assert.equal(await mealieRecipeUrl('a/b'), 'https://mealie.example/g/my%20home/r/a%2Fb')
  })

  test('is null without a usable group or when the lookup fails', async () => {
    for (const body of [{}, { groupSlug: '' }, { groupSlug: 7 }]) {
      stubFetch(async () => json(body))
      assert.equal(await mealieRecipeUrl('a'), null)
      mock.restoreAll()
    }
    stubFetch(async () => json({}, 500))
    assert.equal(await mealieRecipeUrl('a'), null)
  })
})
