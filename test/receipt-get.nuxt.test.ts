import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDatabase = vi.hoisted(() => ({
  responses: [] as unknown[][],
  queries: [] as string[]
}))

vi.mock('../server/utils/db', () => ({
  db: () => async (strings: TemplateStringsArray) => {
    mockDatabase.queries.push(strings.join('?').replaceAll(/\s+/g, ' ').trim())
    return mockDatabase.responses.shift() ?? []
  },
  publicEntry: (entry: { id: string, item: string }) => ({ id: entry.id, item: entry.item })
}))

import getReceipt from '../server/api/receipts/[id].get'

const eventFor = (id: string) => ({ context: { params: { id } } }) as any

beforeEach(() => {
  mockDatabase.responses = []
  mockDatabase.queries = []
})

describe('GET /api/receipts/:id', () => {
  it('returns the exact receipt and maps its entries', async () => {
    mockDatabase.responses = [
      [{ id: '17', purchasedOn: new Date('2026-08-10T00:00:00Z'), location: 'Market', itemCount: 1, total: '4.99' }],
      [{ id: '31', item: 'Coffee' }]
    ]

    const result = await getReceipt(eventFor('17')) as any

    expect(result.receipt).toEqual({
      id: '17', purchasedOn: '2026-08-10', location: 'Market', itemCount: 1, total: '4.99',
      entries: [{ id: '31', item: 'Coffee' }]
    })
    expect(mockDatabase.queries[0]).toContain('WHERE receipts.id = ?')
    expect(mockDatabase.queries[1]).toContain('WHERE receipt_id = ?')
  })

  it('rejects a malformed receipt ID before querying', async () => {
    await expect(getReceipt(eventFor('x'))).rejects.toMatchObject({ statusCode: 400 })
    expect(mockDatabase.queries).toHaveLength(0)
  })

  it('returns 404 when the exact receipt ID is missing', async () => {
    mockDatabase.responses = [[]]
    await expect(getReceipt(eventFor('17'))).rejects.toMatchObject({ statusCode: 404 })
    expect(mockDatabase.queries).toHaveLength(1)
  })
})
