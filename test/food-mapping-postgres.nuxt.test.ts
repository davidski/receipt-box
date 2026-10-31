import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Skipped locally without TEST_DATABASE_URL, but a missing URL fails on GitHub Actions so CI cannot silently skip.
const adminUrl = process.env.TEST_DATABASE_URL
if (!adminUrl && process.env.GITHUB_ACTIONS) throw new Error('TEST_DATABASE_URL is required on CI')
if (!adminUrl) console.warn('Skipping the Postgres tests: TEST_DATABASE_URL is not set')

const mock = vi.hoisted(() => ({ body: undefined as unknown, query: {} as Record<string, unknown> }))

vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mock.body,
  getQuery: () => mock.query
}))

const foodA = '11111111-1111-4111-8111-111111111111'
const foodB = '22222222-2222-4222-8222-222222222222'
const foodInactive = '33333333-3333-4333-8333-333333333333'
const foodUncached = '44444444-4444-4444-8444-444444444444'

describe.skipIf(!adminUrl)('food mappings on real Postgres', () => {
  const databaseName = `receipt_box_test_${process.pid}_${Date.now()}`
  let admin: postgres.Sql
  let sql: postgres.Sql
  let handlers: Record<string, any>
  let resetDatabase: (sql: any) => Promise<void>

  const call = (handler: string, { body, query = {} }: { body?: unknown, query?: Record<string, unknown> } = {}) => {
    mock.body = body
    mock.query = query
    return handlers[handler]!({ node: { res: {} } }) as Promise<any>
  }
  const addEntry = async (item: string, { size = 1 as number | null, unit = 'lb' as string | null, nonGrocery = false } = {}) => {
    const [store] = await sql<{ id: string }[]>`INSERT INTO grocery_stores (name) VALUES ('Store') ON CONFLICT DO NOTHING RETURNING id::text`
    const storeId = store?.id ?? (await sql<{ id: string }[]>`SELECT id::text FROM grocery_stores LIMIT 1`)[0]!.id
    const [receipt] = await sql<{ id: string }[]>`
      INSERT INTO grocery_receipts (purchased_on, store_id) VALUES ('2026-01-01', ${storeId})
      ON CONFLICT (purchased_on, store_id) DO UPDATE SET updated_at = now() RETURNING id::text
    `
    await sql`
      INSERT INTO grocery_entries (receipt_id, position, item, size, unit, price, non_grocery)
      VALUES (${receipt!.id}, 1, ${item}, ${size}, ${unit}, 1, ${nonGrocery})
    `
  }
  const addMapping = (item: string, food: string, source = 'manual', mappedAt = '2026-01-01T00:00:00Z') =>
    sql`INSERT INTO grocery_item_food_mapping VALUES (${item}, ${food}, ${source}, ${mappedAt})`
  const mappings = () => sql<{ item: string, mealieFoodId: string, mappingSource: string }[]>`
    SELECT item, mealie_food_id::text, mapping_source FROM grocery_item_food_mapping ORDER BY item
  `
  const items = async () => (await sql<{ item: string }[]>`SELECT DISTINCT item FROM grocery_entries ORDER BY item`).map(row => row.item)

  beforeAll(async () => {
    const url = new URL(adminUrl!)
    admin = postgres(adminUrl!, { max: 1 })
    await admin.unsafe(`CREATE DATABASE ${databaseName}`)
    url.pathname = `/${databaseName}`
    process.env.DATABASE_URL = url.href
    process.env.MEALIE_URL = 'http://mealie.invalid'
    process.env.MEALIE_API_TOKEN = 'unused'
    vi.stubGlobal('useRuntimeConfig', () => ({}))
    // The merge and rename handlers and the shared utils rely on Nitro's auto-imports.
    const h3 = await import('h3')
    vi.stubGlobal('defineEventHandler', h3.defineEventHandler)
    vi.stubGlobal('createError', h3.createError)
    vi.stubGlobal('readBody', h3.readBody)

    const { db, migrate } = await import('../server/utils/db')
    await migrate()
    await migrate()
    sql = db()
    ;({ resetDatabase } = await import('../server/utils/database-reset'))
    handlers = {
      get: (await import('../server/api/items/food.get')).default,
      put: (await import('../server/api/items/food.put')).default,
      remove: (await import('../server/api/items/food.delete')).default,
      foods: (await import('../server/api/mealie/foods.get')).default,
      list: (await import('../server/api/food-mappings/index.get')).default,
      unmapped: (await import('../server/api/food-mappings/unmapped.get')).default,
      problems: (await import('../server/api/food-mappings/problems.get')).default,
      suggestions: (await import('../server/api/food-mappings/suggestions.get')).default,
      merge: (await import('../server/api/items/merge.post')).default,
      rename: (await import('../server/api/items/rename.patch')).default
    }
  })

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
    await admin?.end()
  })

  beforeEach(async () => {
    process.env.MEALIE_URL = 'http://mealie.invalid'
    await resetDatabase(sql)
    await sql`TRUNCATE mealie_foods CASCADE`
    await sql`
      INSERT INTO mealie_foods (id, name, active, last_seen_at, synced_at) VALUES
        (${foodA}, 'Chickpeas', TRUE, now(), now()),
        (${foodB}, 'Lentils', TRUE, now(), now()),
        (${foodInactive}, 'Merged away', FALSE, now(), now())
    `
  })

  describe('API', () => {
    it('searches active foods by name or alias, treating the search as literal text', async () => {
      await sql`INSERT INTO mealie_food_aliases (food_id, alias) VALUES (${foodA}, 'Garbanzo beans'), (${foodInactive}, 'Garbanzo stale')`
      const names = async (search?: unknown) => (await call('foods', { query: { search } })).foods.map((food: { name: string }) => food.name)
      expect(await names()).toEqual(['Chickpeas', 'Lentils'])
      expect(await names(' chick ')).toEqual(['Chickpeas'])
      expect(await names('GARBANZO')).toEqual(['Chickpeas'])
      expect(await names('Merged')).toEqual([])
      expect(await names('%')).toEqual([])
      expect(await names(['Lentils'])).toEqual(['Chickpeas', 'Lentils'])
      expect((await call('foods', { query: { search: 'Lentils' } })).foods).toEqual([{ id: foodB, name: 'Lentils' }])
    })

    it('caps food results at 50', async () => {
      await sql`INSERT INTO mealie_foods (id, name, active, last_seen_at, synced_at) SELECT gen_random_uuid(), 'Bulk ' || n, TRUE, now(), now() FROM generate_series(1, 60) n`
      expect((await call('foods', { query: { search: 'Bulk' } })).foods).toHaveLength(50)
    })

    it('lists mappings, including broken ones, and is empty without Mealie', async () => {
      await addEntry('Beans')
      await addMapping('Beans', foodA)
      await addMapping('Gone', foodUncached)
      expect((await call('list')).mappings).toMatchObject([
        { item: 'Beans', foodName: 'Chickpeas', broken: false, hasEntries: true },
        { item: 'Gone', foodName: null, broken: true, hasEntries: false }
      ])
      delete process.env.MEALIE_URL
      expect(await call('list')).toEqual({ mappings: [] })
      expect(await call('foods', { query: { search: 'Chick' } })).toEqual({ foods: [] })
    })

    it('saves, replaces, reads and deletes a mapping', async () => {
      await addEntry('Goya Chick Peas')
      const saved = await call('put', { body: { item: ' Goya Chick Peas ', mealieFoodId: foodA.toUpperCase() } })
      expect(saved).toMatchObject({ item: 'Goya Chick Peas', mealieFoodId: foodA, foodName: 'Chickpeas', mappingSource: 'manual', broken: false, hasEntries: true })

      await call('put', { body: { item: 'Goya Chick Peas', mealieFoodId: foodB } })
      expect((await call('get', { query: { item: 'Goya Chick Peas' } })).mapping.foodName).toBe('Lentils')

      await expect(call('remove', { query: { item: 'Goya Chick Peas' } })).resolves.toEqual({ item: 'Goya Chick Peas', deleted: true })
      await expect(call('remove', { query: { item: 'Goya Chick Peas' } })).resolves.toEqual({ item: 'Goya Chick Peas', deleted: false })
      await expect(call('get', { query: { item: 'Goya Chick Peas' } })).resolves.toEqual({ item: 'Goya Chick Peas', mapping: null })
    })

    it('rejects bad input, an uncached food, an inactive food and an unknown item', async () => {
      await addEntry('Flour')
      await expect(call('get')).rejects.toMatchObject({ statusCode: 400 })
      await expect(call('remove')).rejects.toMatchObject({ statusCode: 400 })
      await expect(call('put', { body: { item: 'Flour', mealieFoodId: 'nope' } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(call('put', { body: { mealieFoodId: foodA } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(call('put', { body: { item: 'Flour', mealieFoodId: foodUncached } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(call('put', { body: { item: 'Flour', mealieFoodId: foodInactive } })).rejects.toMatchObject({ statusCode: 409 })
      await expect(call('put', { body: { item: 'Gone', mealieFoodId: foodA } })).rejects.toMatchObject({ statusCode: 404 })
      expect(await mappings()).toEqual([])
    })

    it('with Mealie unset, reads are empty and PUT is refused while the data stays', async () => {
      await addEntry('Flour')
      await addEntry('Sugar')
      await addMapping('Flour', foodA)
      await addMapping('Gone', foodInactive)
      process.env.MEALIE_URL = ''

      await expect(call('get', { query: { item: 'Flour' } })).resolves.toEqual({ item: 'Flour', mapping: null })
      await expect(call('unmapped')).resolves.toEqual({ items: [] })
      await expect(call('problems')).resolves.toEqual({ brokenMappings: [], orphanedMappings: [], unmappedItems: [], itemsWithoutPackageSize: [] })
      await expect(call('put', { body: { item: 'Sugar', mealieFoodId: foodA } })).rejects.toMatchObject({ statusCode: 409 })
      expect(await mappings()).toHaveLength(2)
    })

    it('lists unmapped grocery items and every kind of problem', async () => {
      await addEntry('Mapped')
      await addMapping('Mapped', foodA)
      await addEntry('Broken')
      await addMapping('Broken', foodInactive)
      await addEntry('Uncached')
      await addMapping('Uncached', foodUncached)
      await addMapping('Orphan', foodA)
      await addMapping('Orphan broken', foodInactive)
      await addEntry('Unmapped')
      await addEntry('Unmapped')
      await addEntry('Paper towels', { nonGrocery: true })
      await addEntry('No size', { size: null, unit: null })
      await addEntry('Zero size', { size: 0 })
      await addEntry('No unit', { unit: null })
      await addEntry('One usable', { size: null, unit: null })
      await addEntry('One usable')

      const { items: unmapped } = await call('unmapped')
      expect(unmapped).toContainEqual({ item: 'Unmapped', entries: 2 })
      expect(unmapped.map((row: any) => row.item)).not.toContain('Paper towels')
      expect(unmapped.map((row: any) => row.item)).not.toContain('Mapped')

      const problems = await call('problems')
      expect(problems.brokenMappings.map((row: any) => row.item)).toEqual(['Broken', 'Orphan broken', 'Uncached'])
      expect(problems.orphanedMappings.map((row: any) => row.item)).toEqual(['Orphan', 'Orphan broken'])
      expect(problems.unmappedItems).toEqual(unmapped)
      expect(problems.itemsWithoutPackageSize.map((row: any) => row.item)).toEqual(['No size', 'No unit', 'Zero size'])
      expect(await mappings()).toHaveLength(5)
    })

    it('flags a mapping broken when its food goes inactive, without remapping it', async () => {
      await addEntry('Flour')
      await call('put', { body: { item: 'Flour', mealieFoodId: foodA } })
      await sql`UPDATE mealie_foods SET active = FALSE WHERE id = ${foodA}`
      expect((await call('get', { query: { item: 'Flour' } })).mapping).toMatchObject({ mealieFoodId: foodA, broken: true })
    })

    it('leaves a mapping in place when its last entry goes', async () => {
      await addEntry('Flour')
      await addMapping('Flour', foodA)
      await sql`DELETE FROM grocery_entries WHERE item = 'Flour'`
      expect((await call('problems')).orphanedMappings.map((row: any) => row.item)).toEqual(['Flour'])
    })

    it('database reset clears mappings', async () => {
      await addMapping('Flour', foodA)
      await resetDatabase(sql)
      expect(await mappings()).toEqual([])
    })
  })

  describe('suggestions', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', '0', '9'].map(letter => `${letter.repeat(8)}-0000-4000-8000-000000000000`)
    const addFood = async (id: string, name: string, { plural = null as string | null, aliases = [] as string[], active = true } = {}) => {
      await sql`INSERT INTO mealie_foods (id, name, plural_name, active, last_seen_at, synced_at) VALUES (${id}, ${name}, ${plural}, ${active}, now(), now())`
      for (const alias of aliases) await sql`INSERT INTO mealie_food_aliases VALUES (${id}, ${alias})`
    }
    const suggest = async (item: string) => (await call('suggestions', { query: { item } })).suggestions as any[]

    it('has pg_trgm installed by the migration', async () => {
      expect(await sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`).toHaveLength(1)
    })

    it('matches an exact name, ignoring case and spacing, with its reason', async () => {
      await addFood(ids[0]!, 'Garbanzo Beans')
      expect(await suggest('  garbanzo   BEANS ')).toEqual([
        { mealieFoodId: ids[0], foodName: 'Garbanzo Beans', matchType: 'exact_name', matchedText: 'Garbanzo Beans', similarity: null }
      ])
    })

    it('matches a plural name and an exact alias', async () => {
      await addFood(ids[0]!, 'Tomato', { plural: 'Tomatoes' })
      await addFood(ids[1]!, 'Chickpeas', { aliases: ['Ceci'] })
      expect(await suggest('tomatoes')).toMatchObject([{ mealieFoodId: ids[0], matchType: 'plural_name', matchedText: 'Tomatoes' }])
      expect(await suggest('CECI')).toMatchObject([{ mealieFoodId: ids[1], foodName: 'Chickpeas', matchType: 'exact_alias', matchedText: 'Ceci', similarity: null }])
    })

    it('matches a normalized name across punctuation and a final s', async () => {
      await addFood(ids[0]!, "Baker's Yeast")
      await addFood(ids[1]!, 'Black Bean')
      expect((await suggest('bakers yeast'))[0]).toMatchObject({ mealieFoodId: ids[0], matchType: 'normalized_name' })
      expect((await suggest('Black-Beans'))[0]).toMatchObject({ mealieFoodId: ids[1], matchType: 'normalized_name' })
    })

    it('does not match punctuation alone as normalized', async () => {
      await addFood(ids[0]!, '!!!')
      await addFood(ids[1]!, 'Salt')
      expect(await suggest('???')).toEqual([])
    })

    it('marks a fuzzy name or alias as fuzzy with a score, and writes no mapping', async () => {
      await addFood(ids[0]!, 'Garbanzo Beans')
      await addFood(ids[1]!, 'Chickpeas', { aliases: ['Chick Pea Mix'] })
      await addEntry('Garbanzo Bean Can')
      const [name] = await suggest('Garbanzo Bean Can')
      expect(name).toMatchObject({ mealieFoodId: ids[0], matchType: 'fuzzy', matchedText: 'Garbanzo Beans' })
      expect(name.similarity).toBeGreaterThan(0.3)
      expect((await suggest('Chick Pea Mixes'))[0]).toMatchObject({ mealieFoodId: ids[1], matchType: 'fuzzy', matchedText: 'Chick Pea Mix' })
      expect(await mappings()).toEqual([])
    })

    it('never returns an unrelated food', async () => {
      await addFood(ids[0]!, 'Garbanzo Beans')
      expect(await suggest('Paper Towels')).toEqual([])
    })

    it('orders by match strength, one row per food at its best match', async () => {
      await addFood(ids[0]!, 'Peas Fresh')
      await addFood(ids[1]!, 'Other', { aliases: ['Peas'] })
      await addFood(ids[2]!, 'Peas', { plural: 'Peas', aliases: ['Peas'] })
      const rows = await suggest('peas')
      expect(rows.map(row => [row.mealieFoodId, row.matchType])).toEqual([[ids[2], 'exact_name'], [ids[1], 'exact_alias'], [ids[0], 'fuzzy']])
    })

    it('returns at most five', async () => {
      for (const [index, id] of ids.entries()) await addFood(id, `Olive Oil ${index}`)
      expect(await suggest('Olive Oil')).toHaveLength(5)
    })

    it('never suggests an inactive food, by name or alias', async () => {
      await addFood(ids[0]!, 'Saffron', { active: false, aliases: ['Azafran'] })
      expect(await suggest('Saffron')).toEqual([])
      expect(await suggest('Azafran')).toEqual([])
    })

    it('treats item text as data, and rejects a missing or oversized name', async () => {
      await addFood(ids[0]!, 'Salt')
      expect(await suggest("'; DROP TABLE mealie_foods; --")).toEqual([])
      expect(await sql`SELECT 1 FROM mealie_foods`).not.toHaveLength(0)
      await expect(call('suggestions')).rejects.toMatchObject({ statusCode: 400 })
      await expect(suggest('x'.repeat(201))).rejects.toMatchObject({ statusCode: 400 })
    })

    it('returns nothing with Mealie unset', async () => {
      await addFood(ids[0]!, 'Salt')
      process.env.MEALIE_URL = ''
      await expect(call('suggestions', { query: { item: 'Salt' } })).resolves.toEqual({ item: 'Salt', suggestions: [] })
    })
  })

  describe('rename', () => {
    it('moves the mapping with its source and date, Mealie set or unset', async () => {
      await addEntry('Old')
      await addMapping('Old', foodA, 'suggested')
      process.env.MEALIE_URL = ''
      await call('rename', { body: { source: 'Old', target: 'New' } })
      expect(await mappings()).toEqual([{ item: 'New', mealieFoodId: foodA, mappingSource: 'suggested' }])
      const [row] = await sql<{ mappedAt: Date }[]>`SELECT mapped_at FROM grocery_item_food_mapping`
      expect(row!.mappedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    })

    it('conflicts with a differently mapped existing target, and accepts a resolution', async () => {
      await addEntry('Old')
      await addEntry('New')
      await addMapping('Old', foodA)
      await addMapping('New', foodB)
      await expect(call('rename', { body: { source: 'Old', target: 'New' } })).rejects.toMatchObject({ statusCode: 409 })
      expect(await items()).toEqual(['New', 'Old'])
      await call('rename', { body: { source: 'Old', target: 'New', foodResolution: foodA } })
      expect(await mappings()).toEqual([{ item: 'New', mealieFoodId: foodA, mappingSource: 'manual' }])
      expect(await items()).toEqual(['New'])
    })

    it('refuses a food resolution when the name does not change, and an invalid one', async () => {
      await addEntry('Old')
      await expect(call('rename', { body: { source: 'Old', target: 'Old', foodResolution: foodA } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(call('rename', { body: { source: 'Old', target: 'New', foodResolution: 'nope' } })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('leaves the mapping alone when only the category changes', async () => {
      await addEntry('Old')
      await addMapping('Old', foodA)
      await call('rename', { body: { source: 'Old', target: 'Old', category: 'Produce' } })
      expect(await mappings()).toHaveLength(1)
    })
  })

  describe('merge', () => {
    const merge = (extra = {}) => call('merge', { body: { target: 'Target', sources: ['Source'], ...extra } })

    beforeEach(async () => {
      await addEntry('Target')
      await addEntry('Source')
    })

    it('keeps the mapping when foods match, keeping the target row', async () => {
      await addMapping('Target', foodA, 'target-row')
      await addMapping('Source', foodA, 'source-row')
      await merge()
      expect(await mappings()).toEqual([{ item: 'Target', mealieFoodId: foodA, mappingSource: 'target-row' }])
    })

    it('keeps the only mapping, on either side', async () => {
      await addMapping('Source', foodA)
      await merge()
      expect(await mappings()).toEqual([{ item: 'Target', mealieFoodId: foodA, mappingSource: 'manual' }])
      await addEntry('Other')
      await call('merge', { body: { target: 'Target', sources: ['Other'] } })
      expect(await mappings()).toEqual([{ item: 'Target', mealieFoodId: foodA, mappingSource: 'manual' }])
    })

    it('does nothing to mappings when neither name is mapped', async () => {
      await merge()
      expect(await mappings()).toEqual([])
    })

    it('reports both conflicts in one 409 and changes nothing', async () => {
      await sql`INSERT INTO grocery_categories (name, normalized_name) VALUES ('A', 'a'), ('B', 'b') ON CONFLICT DO NOTHING`
      await sql`INSERT INTO grocery_item_categories SELECT 'Target', id FROM grocery_categories WHERE name = 'A'`
      await sql`INSERT INTO grocery_item_categories SELECT 'Source', id FROM grocery_categories WHERE name = 'B'`
      await addMapping('Target', foodA)
      await addMapping('Source', foodInactive)

      const error = await merge().catch(failure => failure)
      expect(error.statusCode).toBe(409)
      expect([...error.data.categories].sort()).toEqual(['A', 'B'])
      expect(error.data.foods).toEqual(expect.arrayContaining([
        { id: foodA, name: 'Chickpeas', active: true },
        { id: foodInactive, name: 'Merged away', active: false }
      ]))
      expect(await items()).toEqual(['Source', 'Target'])
      expect(await mappings()).toHaveLength(2)

      await merge({ category: 'A', foodResolution: foodInactive })
      expect(await mappings()).toEqual([{ item: 'Target', mealieFoodId: foodInactive, mappingSource: 'manual' }])
      expect(await items()).toEqual(['Target'])
    })

    it('reports a food in a conflict that has left the cache', async () => {
      await addMapping('Target', foodA)
      await addMapping('Source', foodUncached)
      const error = await merge().catch(failure => failure)
      expect(error.data.foods).toContainEqual({ id: foodUncached, name: null, active: false })
    })

    it('clears both mappings on a null resolution', async () => {
      await addMapping('Target', foodA)
      await addMapping('Source', foodB)
      await merge({ foodResolution: null })
      expect(await mappings()).toEqual([])
    })

    it('refuses a chosen food that neither name maps to', async () => {
      await addMapping('Target', foodA)
      await addMapping('Source', foodB)
      await expect(merge({ foodResolution: foodUncached })).rejects.toMatchObject({ statusCode: 409 })
      await expect(merge({ foodResolution: 'nope' })).rejects.toMatchObject({ statusCode: 400 })
      expect(await mappings()).toHaveLength(2)
    })

    it('carries mappings with Mealie unset', async () => {
      await addMapping('Source', foodA)
      process.env.MEALIE_URL = ''
      await merge()
      expect(await mappings()).toEqual([{ item: 'Target', mealieFoodId: foodA, mappingSource: 'manual' }])
    })
  })
})
