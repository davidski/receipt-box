import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Skipped locally without TEST_DATABASE_URL, but a missing URL fails on GitHub Actions so CI cannot silently skip.
const adminUrl = process.env.TEST_DATABASE_URL
if (!adminUrl && process.env.GITHUB_ACTIONS) throw new Error('TEST_DATABASE_URL is required on CI')

const mock = vi.hoisted(() => ({ body: undefined as unknown }))
vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mock.body
}))

const eggs = '11111111-1111-4111-8111-111111111111'
const flour = '22222222-2222-4222-8222-222222222222'
const cup = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const event = (slug?: string) => ({ node: { res: {} }, context: { params: { slug } } }) as any
const recipe = {
  slug: 'omelet', name: 'Omelet', recipeServings: 2, recipeYield: '40 servings',
  recipeIngredient: [
    { quantity: 2, unit: null, food: { id: eggs, name: 'Eggs' } },
    { quantity: 1, unit: { id: cup, name: 'cup' }, food: { id: flour, name: 'Flour' } }
  ]
}

const { default: list } = await import('../server/api/mealie/recipes/index.get')
const { default: cost } = await import('../server/api/mealie/recipes/[slug]/cost.get')

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.MEALIE_URL
  delete process.env.MEALIE_API_TOKEN
})

const configure = () => {
  process.env.MEALIE_URL = 'http://mealie.invalid'
  process.env.MEALIE_API_TOKEN = 'unused'
}

describe('Mealie recipe endpoints without a database', () => {
  it('lists nothing and never calls Mealie when it is unset', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(list(event())).resolves.toEqual({ recipes: [] })
    await expect(cost(event('omelet'))).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Mealie is not configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lists recipe summaries with servings from recipeServings only', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => json({
      total: 2, total_pages: 1,
      items: [{ slug: 'omelet', name: 'Omelet', recipeServings: 2 }, { slug: 'stew', name: 'Stew', recipeServings: 0, recipeYield: '4 bowls' }]
    })))
    await expect(list(event())).resolves.toEqual({ recipes: [
      { slug: 'omelet', name: 'Omelet', servings: 2 },
      { slug: 'stew', name: 'Stew', servings: null }
    ] })
  })

  it('reports an unreachable Mealie clearly on both endpoints', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(list(event())).rejects.toMatchObject({ statusCode: 502, statusMessage: expect.stringContaining('Mealie is unreachable') })
    await expect(cost(event('omelet'))).rejects.toMatchObject({ statusCode: 502, statusMessage: expect.stringContaining('Mealie is unreachable') })
  })

  it('maps an unknown slug to 404', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 404)))
    await expect(cost(event('nope'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([[undefined], ['..'], ['.'], ['%2E%2E']])('rejects the slug %s without calling Mealie', async (slug) => {
    configure()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(cost(event(slug))).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('encodes the slug into a single read-only Mealie path', async () => {
    configure()
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 404))
    vi.stubGlobal('fetch', fetchSpy)
    await cost(event('a%2Fb')).catch(() => {})
    expect(fetchSpy.mock.calls[0]![0]).toBe('http://mealie.invalid/api/recipes/a%2Fb')
    expect(fetchSpy.mock.calls[0]![1]?.method).toBeUndefined()
  })
})

describe.skipIf(!adminUrl)('Mealie recipe cost on real Postgres', () => {
  const databaseName = `receipt_box_cost_test_${process.pid}_${Date.now()}`
  let admin: postgres.Sql
  let sql: postgres.Sql

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1 })
    await admin.unsafe(`CREATE DATABASE ${databaseName}`)
    const url = new URL(adminUrl!)
    url.pathname = `/${databaseName}`
    process.env.DATABASE_URL = url.href
    const h3 = await import('h3')
    vi.stubGlobal('useRuntimeConfig', () => ({}))
    vi.stubGlobal('createError', h3.createError)
    const { db, migrate } = await import('../server/utils/db')
    await migrate()
    sql = db()
    await sql`
      INSERT INTO mealie_foods (id, name, active, last_seen_at, synced_at) VALUES
        (${eggs}, 'Eggs', TRUE, now(), now()), (${flour}, 'Flour', TRUE, now(), now())
    `
    await sql`INSERT INTO mealie_units (id, name, standard_quantity, standard_unit, last_seen_at, synced_at) VALUES (${cup}, 'cup', 1, 'cup', now(), now())`
    const [store] = await sql<{ id: string }[]>`INSERT INTO grocery_stores (name) VALUES ('Store') RETURNING id::text`
    const receipt = async (date: string) => (await sql<{ id: string }[]>`INSERT INTO grocery_receipts (purchased_on, store_id) VALUES (${date}, ${store!.id}) RETURNING id::text`)[0]!.id
    const [older, newer] = [await receipt('2026-01-01'), await receipt('2026-02-01')]
    await sql`
      INSERT INTO grocery_entries (receipt_id, position, item, size, unit, price, sale_item, non_grocery) VALUES
        (${older}, 1, 'Egg Carton', 12, 'ea', 9, FALSE, FALSE),
        (${newer}, 1, 'Farm Eggs', 12, 'ea', 4, TRUE, FALSE),
        (${newer}, 2, 'Farm Eggs', 12, 'ea', 99, FALSE, TRUE),
        (${newer}, 3, 'AP Flour', 5, 'lb', 4.79, FALSE, FALSE)
    `
    await sql`
      INSERT INTO grocery_item_food_mapping (item, mealie_food_id, mapping_source, mapped_at) VALUES
        ('Egg Carton', ${eggs}, 'manual', now()), ('Farm Eggs', ${eggs}, 'manual', now()), ('AP Flour', ${flour}, 'manual', now())
    `
  })

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
    await admin?.end()
  })

  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({}))
    vi.stubGlobal('createError', (input: object) => Object.assign(new Error('error'), input))
  })

  it('costs a recipe from the real catalog, mappings and latest purchase', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => json(recipe)))
    const result: any = await cost(event('omelet'))
    expect(result.ingredients[0]).toMatchObject({
      item: 'Farm Eggs', cost: 0.67, status: 'exact', error: null,
      purchase: { item: 'Farm Eggs', price: '4.00', purchasedOn: '2026-02-01', saleItem: true, usedSalePrice: true },
      normalizedPackageQuantity: { base: 'ea', amount: 12 }
    })
    expect(result.ingredients[1]).toMatchObject({ item: 'AP Flour', cost: null, status: 'uncosted', error: 'DIMENSION_MISMATCH' })
    expect(result.summary).toEqual({
      cost: 0.67, costPerServing: 0.34, costedIngredients: 1, totalIngredients: 2, coverage: 50,
      uncosted: [{ name: 'Flour', error: 'DIMENSION_MISMATCH' }]
    })
  })

  it('handles a recipe with no ingredients', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...recipe, recipeIngredient: [] })))
    expect((await cost(event('omelet')) as any).summary.totalIngredients).toBe(0)
  })

  it('keeps native recipes costing with Mealie unset', async () => {
    const { priceRecipe } = await import('../server/utils/recipe-query')
    expect(process.env.MEALIE_URL).toBeUndefined()
    const { lines, total } = await priceRecipe(sql, [{ item: 'Farm Eggs', quantity: 2, unit: 'ea' }])
    expect(lines[0]).toMatchObject({ cost: 0.67, sale: true, error: null })
    expect(total).toBe(0.67)
  })
})
