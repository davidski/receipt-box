import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  responses: [] as unknown[],
  queries: [] as Array<{ sql: string, values: unknown[] }>,
  body: undefined as unknown,
  authMode: 'disabled',
  user: { sub: 'user-1' } as { sub?: unknown }
}))

vi.mock('../server/utils/db', () => {
  const sql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    mock.queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    const next = mock.responses.shift() ?? []
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }
  sql.json = (value: unknown) => ({ json: value })
  return { db: () => sql }
})

vi.mock('../server/utils/auth-policy', () => ({ getAuthMode: () => mock.authMode }))

vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mock.body
}))

vi.stubGlobal('requireUserSession', async () => ({ user: mock.user }))

const { default: list } = await import('../server/api/recipes/index.get')
const { default: create } = await import('../server/api/recipes/index.post')
const { default: read } = await import('../server/api/recipes/[id].get')
const { default: update } = await import('../server/api/recipes/[id].put')
const { default: remove } = await import('../server/api/recipes/[id].delete')

const flour = { item: 'Flour', quantity: 250, unit: 'g' }
const flourPurchase = { item: 'Flour', price: '4.00', size: '500.000', unit: 'g', saleItem: false }
const stored = { id: '7', name: 'Pancakes', lines: [flour], savedTotal: 2, savedAt: '2026-09-02T00:00:00Z', createdBy: null, updatedAt: '2026-09-02T00:00:00Z' }
const eventFor = (id?: string) => ({ context: { params: { id } }, node: { res: {} as { statusCode?: number } } }) as any
const run = (handler: any, event: Record<string, unknown> = {}, body?: unknown) => {
  mock.body = body
  return handler(event) as Promise<any>
}
const duplicate = () => Object.assign(new Error('duplicate key'), { code: '23505' })

beforeEach(() => {
  mock.responses = []
  mock.queries = []
  mock.authMode = 'disabled'
  mock.user = { sub: 'user-1' }
})

describe('GET /api/recipes', () => {
  it('lists recipes ordered by lower(name) with live totals and without lines', async () => {
    mock.responses = [
      [
        { id: '1', name: 'Bread', lines: [flour], lineCount: 1, savedTotal: 1.5 },
        { id: '2', name: 'Mystery', lines: [{ item: 'Saffron', quantity: 1, unit: 'g' }], lineCount: 1, savedTotal: null },
        { id: '3', name: 'Empty', lines: [], lineCount: 0, savedTotal: null }
      ],
      [flourPurchase], [], []
    ]
    expect(await run(list)).toEqual([
      { id: '1', name: 'Bread', lineCount: 1, savedTotal: 1.5, currentTotal: 2 },
      { id: '2', name: 'Mystery', lineCount: 1, savedTotal: null, currentTotal: null },
      { id: '3', name: 'Empty', lineCount: 0, savedTotal: null, currentTotal: null }
    ])
    expect(mock.queries[0]!.sql).toContain('ORDER BY lower(name)')
  })

  it('returns an empty list when there are no recipes', async () => {
    expect(await run(list)).toEqual([])
    expect(mock.queries).toHaveLength(1)
  })
})

describe('GET /api/recipes/:id', () => {
  it('returns the recipe', async () => {
    mock.responses = [[stored]]
    expect(await run(read, eventFor('7'))).toEqual(stored)
  })

  it('404s when missing and 400s on a bad id without querying', async () => {
    mock.responses = [[]]
    await expect(run(read, eventFor('7'))).rejects.toMatchObject({ statusCode: 404 })
    mock.queries = []
    await expect(run(read, eventFor('abc'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(run(read, eventFor('9223372036854775808'))).rejects.toMatchObject({ statusCode: 400 })
    expect(mock.queries).toHaveLength(0)
  })
})

describe('POST /api/recipes', () => {
  it('creates a recipe, snapshots the server-computed price and returns 201', async () => {
    mock.responses = [[flourPurchase], [{ id: '42' }], [stored]]
    const event = eventFor()
    const result = await run(create, event, { name: ' Pancakes ', lines: [flour], savedTotal: 999 })

    expect(result).toEqual(stored)
    expect(mock.queries[2]!.sql).toContain('FROM grocery_recipes WHERE id = ?')
    expect(mock.queries[2]!.values).toEqual(['42'])
    expect(event.node.res.statusCode).toBe(201)
    expect(mock.queries[1]!.values).toEqual(['Pancakes', { json: [flour] }, 2, null])
  })

  it('saves a null snapshot when nothing could be priced', async () => {
    mock.responses = [[], [{ id: '7' }], [stored]]
    await run(create, eventFor(), { name: 'Mystery', lines: [{ item: 'Saffron', quantity: 1, unit: 'g' }] })
    expect(mock.queries[1]!.values[2]).toBeNull()
  })

  it('records created_by from the session in oidc mode', async () => {
    mock.authMode = 'oidc'
    mock.responses = [[flourPurchase], [{ id: '7' }], [stored]]
    await run(create, eventFor(), { name: 'Pancakes', lines: [flour] })
    expect(mock.queries[1]!.values[3]).toBe('user-1')
  })

  it('rejects an oidc user without a subject', async () => {
    mock.authMode = 'oidc'
    mock.user = {}
    await expect(run(create, eventFor(), { name: 'Pancakes', lines: [flour] })).rejects.toMatchObject({ statusCode: 401 })
    expect(mock.queries).toHaveLength(0)
  })

  it('leaves created_by null when auth is disabled', async () => {
    mock.responses = [[flourPurchase], [{ id: '7' }], [stored]]
    await run(create, eventFor(), { name: 'Pancakes', lines: [flour] })
    expect(mock.queries[1]!.values[3]).toBeNull()
  })

  it.each([
    ['empty name', { name: '  ', lines: [flour] }],
    ['long name', { name: 'x'.repeat(121), lines: [flour] }],
    ['missing lines', { name: 'A' }],
    ['bad quantity', { name: 'A', lines: [{ item: 'Flour', quantity: 0, unit: 'g' }] }],
    ['duplicate items', { name: 'A', lines: [flour, { ...flour, item: 'flour' }] }],
    ['too many lines', { name: 'A', lines: Array.from({ length: 101 }, (_, index) => ({ item: `i${index}`, quantity: 1, unit: 'g' })) }],
    ['no body', null]
  ])('400s on %s without writing', async (_label, body) => {
    await expect(run(create, eventFor(), body)).rejects.toMatchObject({ statusCode: 400 })
    expect(mock.queries).toHaveLength(0)
  })

  it('409s on a duplicate name, including a case-only difference, via the lower(name) unique index', async () => {
    mock.responses = [[flourPurchase], duplicate()]
    await expect(run(create, eventFor(), { name: 'PANCAKES', lines: [flour] })).rejects.toMatchObject({ statusCode: 409 })
    // The insert sends the name as typed; the case-insensitive uniqueness is enforced by the index, not app code (db-recipes-migration.test.mjs asserts the index is on lower(name)).
    expect(mock.queries[1]!.sql).toContain('INSERT INTO grocery_recipes')
    expect(mock.queries[1]!.values[0]).toBe('PANCAKES')
  })

  it('rethrows unexpected database errors', async () => {
    mock.responses = [[flourPurchase], new Error('connection lost')]
    await expect(run(create, eventFor(), { name: 'A', lines: [flour] })).rejects.toThrow('connection lost')
  })
})

describe('PUT /api/recipes/:id', () => {
  it('updates name and lines without touching the snapshot or pricing', async () => {
    mock.responses = [[{ id: '7' }], [{ id: '7' }], [stored]]
    expect(await run(update, eventFor('7'), { name: 'Crepes', lines: [flour] })).toEqual(stored)

    expect(mock.queries).toHaveLength(3)
    expect(mock.queries[1]!.sql).not.toContain('saved_total')
    expect(mock.queries[1]!.values).toEqual(['Crepes', { json: [flour] }, '7'])
  })

  it('ignores a client-supplied saved total and a false updateSavedPrice flag', async () => {
    mock.responses = [[{ id: '7' }], [{ id: '7' }], [stored]]
    await run(update, eventFor('7'), { name: 'Crepes', lines: [flour], updateSavedPrice: false, savedTotal: 1 })
    expect(mock.queries[1]!.sql).not.toContain('saved_total')
  })

  it('replaces the snapshot only when updateSavedPrice is true', async () => {
    mock.responses = [[{ id: '7' }], [flourPurchase], [{ id: '7' }], [stored]]
    await run(update, eventFor('7'), { name: 'Crepes', lines: [flour], updateSavedPrice: true })

    expect(mock.queries[2]!.sql).toContain('saved_total = ?, saved_at = now()')
    expect(mock.queries[2]!.values).toEqual(['Crepes', { json: [flour] }, 2, '7'])
  })

  it('404s before updating when the recipe is gone, even if the name is taken', async () => {
    mock.responses = [[]]
    await expect(run(update, eventFor('7'), { name: 'Taken', lines: [flour] })).rejects.toMatchObject({ statusCode: 404 })
    expect(mock.queries).toHaveLength(1)
  })

  it('404s if the recipe is deleted between the check and the update', async () => {
    mock.responses = [[{ id: '7' }], []]
    await expect(run(update, eventFor('7'), { name: 'A', lines: [flour] })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('409s when the name is taken, with or without a snapshot update', async () => {
    mock.responses = [[{ id: '7' }], duplicate()]
    await expect(run(update, eventFor('7'), { name: 'A', lines: [flour] })).rejects.toMatchObject({ statusCode: 409 })
    mock.responses = [[{ id: '7' }], [flourPurchase], duplicate()]
    await expect(run(update, eventFor('7'), { name: 'A', lines: [flour], updateSavedPrice: true })).rejects.toMatchObject({ statusCode: 409 })
  })

  it.each([
    ['bad id', 'x', { name: 'A', lines: [flour] }],
    ['id beyond bigint', '9223372036854775808', { name: 'A', lines: [flour] }],
    ['empty name', '7', { name: '', lines: [flour] }],
    ['bad lines', '7', { name: 'A', lines: 'nope' }],
    ['non-boolean flag', '7', { name: 'A', lines: [flour], updateSavedPrice: 'yes' }]
  ])('400s on %s without writing', async (_label, id, body) => {
    await expect(run(update, eventFor(id), body)).rejects.toMatchObject({ statusCode: 400 })
    expect(mock.queries).toHaveLength(0)
  })
})

describe('DELETE /api/recipes/:id', () => {
  it('deletes and returns 204', async () => {
    mock.responses = [[{ id: '7' }]]
    const event: any = eventFor('7')
    expect(await run(remove, event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
  })

  it('404s when missing and 400s on a bad id', async () => {
    mock.responses = [[]]
    await expect(run(remove, eventFor('7'))).rejects.toMatchObject({ statusCode: 404 })
    await expect(run(remove, eventFor('0'))).rejects.toMatchObject({ statusCode: 400 })
  })
})
