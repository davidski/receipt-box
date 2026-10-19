import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDatabase = vi.hoisted(() => ({
  responses: [] as unknown[][],
  queries: [] as Array<{ sql: string, values: unknown[] }>,
  body: undefined as unknown
}))

vi.mock('../server/utils/db', () => {
  const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    mockDatabase.queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return mockDatabase.responses.shift() ?? []
  }
  return { db: () => ({ begin: (run: (tx: unknown) => unknown) => run(tx) }) }
})

vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mockDatabase.body
}))

import putOrder from '../server/api/receipts/[id]/order.put'

const run = (id: string, body: unknown) => {
  mockDatabase.body = body
  return putOrder({ context: { params: { id } } } as any) as Promise<any>
}
const lines = (...ids: string[]) => ids.map(id => ({ id }))

beforeEach(() => {
  mockDatabase.responses = []
  mockDatabase.queries = []
})

describe('PUT /api/receipts/:id/order', () => {
  it('assigns positions in the requested order in one statement', async () => {
    mockDatabase.responses = [[{ id: '7' }], lines('1', '2', '3'), []]

    expect(await run('7', { entryIds: ['3', '1', '2'] })).toEqual({ ok: true })

    expect(mockDatabase.queries).toHaveLength(3)
    expect(mockDatabase.queries[0]!.sql).toContain('FOR UPDATE')
    expect(mockDatabase.queries[2]!.sql).toContain('WITH ORDINALITY')
    expect(mockDatabase.queries[2]!.values).toEqual([['3', '1', '2']])
  })

  it('keeps lines left out of the request after the listed ones in their current order', async () => {
    mockDatabase.responses = [[{ id: '7' }], lines('1', '2', '3', '4'), []]

    await run('7', { entryIds: ['3', '1'] })

    expect(mockDatabase.queries[2]!.values).toEqual([['3', '1', '2', '4']])
  })

  it('accepts a single line', async () => {
    mockDatabase.responses = [[{ id: '7' }], lines('1'), []]
    expect(await run('7', { entryIds: ['1'] })).toEqual({ ok: true })
  })

  it.each([
    ['a missing list', {}],
    ['a non-array list', { entryIds: '1' }],
    ['an empty list', { entryIds: [] }],
    ['an oversized list', { entryIds: Array.from({ length: 201 }, (_, index) => String(index + 1)) }],
    ['duplicate ids', { entryIds: ['1', '1'] }],
    ['a non-numeric id', { entryIds: ['1', 'x'] }],
    ['a numeric (non-string) id', { entryIds: [1] }],
    ['a missing body', undefined]
  ])('rejects %s before querying', async (_label, body) => {
    await expect(run('7', body)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockDatabase.queries).toHaveLength(0)
  })

  it('rejects a malformed receipt id before querying', async () => {
    await expect(run('x', { entryIds: ['1'] })).rejects.toMatchObject({ statusCode: 400 })
    expect(mockDatabase.queries).toHaveLength(0)
  })

  it('returns 404 for an unknown receipt', async () => {
    mockDatabase.responses = [[]]

    await expect(run('7', { entryIds: ['1'] })).rejects.toMatchObject({ statusCode: 404 })
    expect(mockDatabase.queries).toHaveLength(1)
  })

  it('rejects ids that belong to another receipt without updating anything', async () => {
    mockDatabase.responses = [[{ id: '7' }], lines('1', '2')]

    await expect(run('7', { entryIds: ['1', '9'] })).rejects.toMatchObject({ statusCode: 400 })
    expect(mockDatabase.queries).toHaveLength(2)
  })
})
