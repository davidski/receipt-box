import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  responses: [] as unknown[],
  queries: [] as Array<{ sql: string, values: unknown[] }>,
  body: undefined as unknown
}))

vi.mock('../server/utils/db', () => {
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    mock.queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    const next = mock.responses.shift() ?? []
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }
  const sql: any = run
  // Same transaction semantics as postgres.js: a throw inside the callback rejects the whole call.
  sql.begin = (callback: (tx: unknown) => Promise<unknown>) => callback(sql)
  return { db: () => sql }
})

vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mock.body
}))

const { default: rename } = await import('../server/api/stores/[id].patch')

const eventFor = (id: string) => ({ context: { params: { id } } }) as any
const run = (id: string, body: unknown) => {
  mock.body = body
  return rename(eventFor(id)) as Promise<any>
}
const storeWrites = () => mock.queries.filter(query => /^(UPDATE grocery_stores|DELETE FROM grocery_stores)/.test(query.sql))
const receiptWrites = () => mock.queries.filter(query => /grocery_(receipts|entries)/.test(query.sql) && /^(UPDATE|DELETE)/.test(query.sql))

beforeEach(() => {
  mock.responses = []
  mock.queries = []
  mock.body = undefined
})

describe('PATCH /api/stores/:id', () => {
  it('renames a store that has receipts to a new name without moving them', async () => {
    mock.responses = [
      [{ id: '1', name: 'Big Grocer' }],
      [],
      [{ id: '2', purchasedOn: '2026-08-06' }],
      []
    ]

    expect(await run('1', { name: 'Grocer Two' })).toEqual({ id: '1', name: 'Grocer Two', merged: false })
    expect(mock.queries.map(query => query.sql)).toEqual([
      'SELECT id::text, name FROM grocery_stores WHERE id = ? FOR UPDATE',
      'SELECT id::text, name FROM grocery_stores WHERE lower(name) = lower(?) AND id <> ? FOR UPDATE',
      'UPDATE grocery_stores SET name = ? WHERE id = ?'
    ])
    expect(mock.queries[2]!.values).toEqual(['Grocer Two', '1'])
  })

  it('renames the store with a case-only change without treating it as a merge', async () => {
    mock.responses = [
      [{ id: '1', name: 'big grocer' }],
      [],
      []
    ]

    expect(await run('1', { name: 'Big Grocer' })).toEqual({ id: '1', name: 'Big Grocer', merged: false })
    expect(storeWrites()).toHaveLength(1)
    expect(receiptWrites()).toHaveLength(0)
  })

  it('merges into an existing store, moving receipts and keeping same-day receipts together', async () => {
    mock.responses = [
      [{ id: '1', name: 'Big Grocer' }],
      [{ id: '2', name: 'Grocer Two' }],
      [{ id: '2', purchasedOn: '2026-08-05' }, { id: '3', purchasedOn: '2026-08-06' }],
      [{ id: '8' }], [], [],
      [{ id: '9' }], [], [],
      []
    ]

    expect(await run('1', { name: 'grocer two' })).toEqual({ id: '2', name: 'Grocer Two', merged: true })
    expect(storeWrites()).toHaveLength(1)
    expect(storeWrites()[0]!.sql).toBe('DELETE FROM grocery_stores WHERE id = ?')
    expect(storeWrites()[0]!.values).toEqual(['1'])
    expect(mock.queries.filter(query => /^DELETE FROM grocery_receipts/.test(query.sql))).toHaveLength(2)
    expect(mock.responses).toHaveLength(0)
  })

  it('rolls back the whole merge when a receipt cannot be moved', async () => {
    mock.responses = [
      [{ id: '1', name: 'Big Grocer' }],
      [{ id: '2', name: 'Grocer Two' }],
      [{ id: '2', purchasedOn: '2026-08-05' }],
      []
    ]

    await expect(run('1', { name: 'Grocer Two' })).rejects.toThrow('Could not create or find receipt')
    expect(storeWrites()).toHaveLength(0)
    expect(receiptWrites()).toHaveLength(0)
  })

  it('returns 404 when the store does not exist', async () => {
    mock.responses = [[]]
    await expect(run('1', { name: 'Grocer Two' })).rejects.toMatchObject({ statusCode: 404 })
    expect(mock.queries).toHaveLength(1)
  })

  it('rejects a malformed id before querying', async () => {
    await expect(run('x', { name: 'Grocer Two' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mock.queries).toHaveLength(0)
  })

  it('rejects a blank name and accepts exactly 120 characters', async () => {
    await expect(run('1', { name: '   ' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mock.queries).toHaveLength(0)

    mock.responses = [[{ id: '1', name: 'Big Grocer' }], [], []]
    const name = 'a'.repeat(120)
    expect(await run('1', { name })).toEqual({ id: '1', name, merged: false })
  })

  it('rejects a name longer than 120 characters before querying', async () => {
    await expect(run('1', { name: 'a'.repeat(121) })).rejects.toMatchObject({ statusCode: 400 })
    expect(mock.queries).toHaveLength(0)
  })
})
