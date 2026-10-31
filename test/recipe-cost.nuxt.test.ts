import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDatabase = vi.hoisted(() => ({
  responses: [] as unknown[][],
  queries: [] as Array<{ sql: string, values: unknown[] }>,
  body: undefined as unknown
}))

vi.mock('../server/utils/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    mockDatabase.queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return mockDatabase.responses.shift() ?? []
  }
}))

vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mockDatabase.body
}))

import recipeCost from '../server/api/recipe-cost.post'

const run = (lines: unknown) => {
  mockDatabase.body = { lines }
  return recipeCost({} as any) as Promise<any>
}

beforeEach(() => {
  mockDatabase.responses = []
  mockDatabase.queries = []
})

describe('POST /api/recipe-cost', () => {
  it('prices each line from the latest eligible purchase and totals the result', async () => {
    mockDatabase.responses = [[
      { item: 'Flour', price: '4.00', size: '500.000', unit: 'g', saleItem: true },
      { item: 'Salt', price: '2.00', size: null, unit: null, saleItem: false }
    ]]

    const result = await run([
      { item: ' Flour ', quantity: 4, unit: 'oz' },
      { item: 'Salt', quantity: 1, unit: 'tsp' },
      { item: 'Saffron', quantity: 1, unit: 'g' }
    ])

    expect(result).toEqual({
      lines: [
        { item: 'Flour', quantity: 4, unit: 'oz', cost: 0.91, sale: true, error: null, purchaseUnit: 'g' },
        { item: 'Salt', quantity: 1, unit: 'tsp', cost: null, sale: false, error: 'NO_PACKAGE_SIZE', purchaseUnit: null },
        { item: 'Saffron', quantity: 1, unit: 'g', cost: null, sale: false, error: 'NO_PRICE', purchaseUnit: null }
      ],
      total: 0.91,
      excluded: 2
    })
    expect(mockDatabase.queries).toHaveLength(1)
    expect(mockDatabase.queries[0].sql).toContain('NOT entries.non_grocery')
    expect(mockDatabase.queries[0].sql).toContain('JOIN grocery_receipts receipts ON receipts.id = entries.receipt_id')
    expect(mockDatabase.queries[0].sql).toContain('ORDER BY entries.item, eligible, receipts.purchased_on DESC, entries.id DESC')
    expect(mockDatabase.queries[0].values).toEqual([['Flour', 'Salt', 'Saffron']])
  })

  it('includes the purchase unit for incompatible recipe units using the same query', async () => {
    mockDatabase.responses = [[{ item: 'Flour', price: '4.00', size: '1', unit: 'lb', saleItem: false }]]
    const result = await run([{ item: 'Flour', quantity: 1, unit: 'cup' }])
    expect(result.lines[0]).toMatchObject({ cost: null, error: 'DIMENSION_MISMATCH', purchaseUnit: 'lb' })
    expect(mockDatabase.queries).toHaveLength(1)
  })

  it('returns an empty result without querying when there are no lines', async () => {
    expect(await run([])).toEqual({ lines: [], total: 0, excluded: 0 })
    expect(mockDatabase.queries).toHaveLength(0)
  })

  it.each([
    ['lines is not an array', 'flour', /lines/],
    ['an item is empty', [{ item: '  ', quantity: 1, unit: 'g' }], /item/],
    ['a line is not an object', [null], /item/],
    ['quantity is zero', [{ item: 'Flour', quantity: 0, unit: 'g' }], /Flour/],
    ['quantity is negative', [{ item: 'Flour', quantity: -1, unit: 'g' }], /Flour/],
    ['quantity is a string', [{ item: 'Flour', quantity: '1', unit: 'g' }], /Flour/],
    ['quantity is not finite', [{ item: 'Flour', quantity: Infinity, unit: 'g' }], /Flour/],
    ['an item repeats case-insensitively', [
      { item: 'Flour', quantity: 1, unit: 'g' },
      { item: ' flour', quantity: 2, unit: 'g' }
    ], /flour/]
  ])('rejects with 400 when %s', async (_name, lines, message) => {
    await expect(run(lines)).rejects.toMatchObject({ statusCode: 400, statusMessage: expect.stringMatching(message) })
    expect(mockDatabase.queries).toHaveLength(0)
  })

  it('reports a missing unit as NO_UNIT', async () => {
    mockDatabase.responses = [[{ item: 'Flour', price: '4.00', size: '500', unit: 'g', saleItem: false }]]
    const result = await run([{ item: 'Flour', quantity: 1 }])
    expect(result.lines[0]).toMatchObject({ unit: '', error: 'NO_UNIT', purchaseUnit: 'g' })
  })
})
