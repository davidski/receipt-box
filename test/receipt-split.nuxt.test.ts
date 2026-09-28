import { describe, expect, it } from 'vitest'
import { splitReceipt, undoReceiptSplit } from '../server/utils/receipt-split'

function fakeTransaction(responses: unknown[][]) {
  const queries: Array<{ sql: string, values: unknown[] }> = []
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return Promise.resolve(responses.shift() ?? [])
  }
  return { tx: tx as any, queries }
}

const source = [{ id: '1', purchasedOn: '2026-08-10', location: 'Old Store' }]
const selected = [{ id: '11' }]
const entry = {
  id: '12', receiptId: '1', purchasedOn: '2026-08-10', item: 'Remain', location: 'Old Store',
  size: null, unit: null, price: '3.25', costPerUnit: null, saleItem: false, nonGrocery: false,
  notes: null, category: null, createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z'
}
const sourceView = [{ id: '1', purchasedOn: '2026-08-10', location: 'Old Store', itemCount: 1, total: '3.25' }]

describe('splitReceipt', () => {
  it('moves only selected lines into a new destination receipt', async () => {
    const { tx, queries } = fakeTransaction([
      source, selected, [{ itemCount: 2 }], [], [{ name: 'New Store' }], [{ id: '2' }], [], sourceView, [entry]
    ])

    const result = await splitReceipt(tx, {
      sourceId: '1', entryIds: ['11'], purchasedOn: '2026-08-11', location: 'New Store'
    })

    expect(result.targetReceiptId).toBe('2')
    expect(result.targetWasCreated).toBe(true)
    expect(result.movedCount).toBe(1)
    expect(result.source.itemCount).toBe(1)
    const move = queries.find(query => query.sql.startsWith('UPDATE grocery_entries SET receipt_id'))
    expect(move?.values).toEqual(['2', '1', ['11']])
  })

  it('requires the caller to identify a duplicate destination receipt', async () => {
    const { tx, queries } = fakeTransaction([
      source, selected, [{ itemCount: 2 }], [], [{ name: 'New Store' }], []
    ])

    await expect(splitReceipt(tx, {
      sourceId: '1', entryIds: ['11'], purchasedOn: '2026-08-11', location: 'New Store'
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(queries.some(query => query.sql.startsWith('UPDATE grocery_entries SET receipt_id'))).toBe(false)
  })

  it('adds selected lines to the explicitly identified destination receipt', async () => {
    const { tx, queries } = fakeTransaction([
      source, selected, [{ itemCount: 2 }], [{ id: '2', purchasedOn: '2026-08-11', location: 'New Store' }], [], sourceView, [entry]
    ])

    const result = await splitReceipt(tx, {
      sourceId: '1', entryIds: ['11'], purchasedOn: '2026-08-11', location: 'New Store', targetReceiptId: '2'
    })

    expect(result.targetReceiptId).toBe('2')
    expect(result.targetWasCreated).toBe(false)
    expect(queries.some(query => query.sql.startsWith('INSERT INTO grocery_receipts'))).toBe(false)
    expect(queries.find(query => query.sql.startsWith('UPDATE grocery_entries SET receipt_id'))?.values).toEqual(['2', '1', ['11']])
  })

  it('rejects moving selected lines back into their source receipt key', async () => {
    const { tx, queries } = fakeTransaction([source])

    await expect(splitReceipt(tx, {
      sourceId: '1', entryIds: ['11'], purchasedOn: '2026-08-10', location: 'Old Store'
    })).rejects.toMatchObject({ statusCode: 400 })
    expect(queries).toHaveLength(1)
  })

  it('keeps at least one line in the source receipt', async () => {
    const { tx } = fakeTransaction([source, selected, [{ itemCount: 1 }]])

    await expect(splitReceipt(tx, {
      sourceId: '1', entryIds: ['11'], purchasedOn: '2026-08-11', location: 'New Store'
    })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Leave at least one line in this receipt' })
  })
})

describe('undoReceiptSplit', () => {
  it('moves the selected lines back and removes an empty receipt created by the split', async () => {
    const { tx, queries } = fakeTransaction([
      [
        { id: '1', purchasedOn: '2026-08-10', location: 'Old Store' },
        { id: '2', purchasedOn: '2026-08-11', location: 'New Store' }
      ], selected, [], [], sourceView, [entry]
    ])

    const result = await undoReceiptSplit(tx, {
      sourceId: '1', targetReceiptId: '2', entryIds: ['11'], targetWasCreated: true,
      sourcePurchasedOn: '2026-08-10', sourceLocation: 'Old Store',
      targetPurchasedOn: '2026-08-11', targetLocation: 'New Store'
    })

    expect(result.source.itemCount).toBe(1)
    expect(queries.some(query => query.sql.startsWith('DELETE FROM grocery_receipts'))).toBe(true)
    expect(queries.find(query => query.sql.startsWith('UPDATE grocery_entries SET receipt_id'))?.values).toEqual(['1', '2', ['11']])
  })
})
