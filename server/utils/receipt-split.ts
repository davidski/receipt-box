import type postgres from 'postgres'
import { createError } from 'h3'
import { normalizeStoreName } from '../../shared/utils/store-name'
import { db, publicEntry, type GroceryEntry } from './db'
import { ensureStore } from './receipt-query'

type Transaction = postgres.TransactionSql

export function requireSplitId(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) < BigInt(1) || BigInt(value) > BigInt('9223372036854775807')) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${label}` })
  }
  return value
}

export type SplitReceiptInput = {
  sourceId: string
  entryIds: string[]
  purchasedOn: string
  location: string
  targetReceiptId?: string
}

export type UndoReceiptSplitInput = {
  sourceId: string
  targetReceiptId: string
  entryIds: string[]
  targetWasCreated: boolean
  sourcePurchasedOn: string
  sourceLocation: string
  targetPurchasedOn: string
  targetLocation: string
}

type ReceiptView = {
  id: string
  purchasedOn: string
  location: string
  itemCount: number
  total: string
  entries: ReturnType<typeof publicEntry>[]
}

function receiptKeyMatches(receipt: { purchasedOn: string | Date, location: string }, purchasedOn: string, location: string) {
  const date = receipt.purchasedOn instanceof Date ? receipt.purchasedOn.toISOString().slice(0, 10) : String(receipt.purchasedOn).slice(0, 10)
  return date === purchasedOn && receipt.location.toLowerCase() === location.toLowerCase()
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  if (Number(value.slice(0, 4)) < 1) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function receiptView(tx: Transaction, id: string): Promise<ReceiptView> {
  const [receipt] = await tx<{
    id: string
    purchasedOn: string | Date
    location: string
    itemCount: number
    total: string
  }[]>`
    SELECT receipts.id::text, receipts.purchased_on, stores.name AS location,
      count(entries.id)::int AS item_count,
      coalesce(sum(entries.price), 0)::text AS total
    FROM grocery_receipts receipts
    INNER JOIN grocery_stores stores ON stores.id = receipts.store_id
    LEFT JOIN grocery_entries entries ON entries.receipt_id = receipts.id
    WHERE receipts.id = ${id}
    GROUP BY receipts.id, receipts.purchased_on, stores.name
  `
  if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  const entries = await tx<GroceryEntry[]>`
    SELECT * FROM grocery_entry_details WHERE receipt_id = ${id} ORDER BY id
  `
  return {
    ...receipt,
    purchasedOn: receipt.purchasedOn instanceof Date ? receipt.purchasedOn.toISOString().slice(0, 10) : String(receipt.purchasedOn).slice(0, 10),
    entries: entries.map(publicEntry)
  }
}

export async function splitReceipt(tx: Transaction, input: SplitReceiptInput) {
  const location = normalizeStoreName(input.location)
  if (!validDate(input.purchasedOn)) throw createError({ statusCode: 400, statusMessage: 'A valid destination date is required' })
  if (!location) throw createError({ statusCode: 400, statusMessage: 'A destination store is required' })
  if (!input.entryIds.length || new Set(input.entryIds).size !== input.entryIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Select one or more distinct receipt lines' })
  }

  const [source] = await tx<{ id: string, purchasedOn: string | Date, location: string }[]>`
    SELECT receipts.id::text, receipts.purchased_on, stores.name AS location
    FROM grocery_receipts receipts
    INNER JOIN grocery_stores stores ON stores.id = receipts.store_id
    WHERE receipts.id = ${input.sourceId}
    FOR UPDATE OF receipts
  `
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  if (receiptKeyMatches(source, input.purchasedOn, location)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a different date or store for the split lines' })
  }

  const selected = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_entries
    WHERE receipt_id = ${input.sourceId} AND id = ANY(${input.entryIds}::bigint[])
    FOR UPDATE
  `
  if (selected.length !== input.entryIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'One or more selected lines no longer belong to this receipt' })
  }
  const [counts] = await tx<{ itemCount: number }[]>`
    SELECT count(*)::int AS item_count FROM grocery_entries WHERE receipt_id = ${input.sourceId}
  `
  if (!counts || counts.itemCount <= input.entryIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Leave at least one line in this receipt' })
  }

  let targetReceiptId = input.targetReceiptId
  let targetLocation = location
  let targetWasCreated = false
  if (targetReceiptId) {
    const [target] = await tx<{ id: string, purchasedOn: string | Date, location: string }[]>`
      SELECT receipts.id::text, receipts.purchased_on, stores.name AS location
      FROM grocery_receipts receipts
      INNER JOIN grocery_stores stores ON stores.id = receipts.store_id
      WHERE receipts.id = ${targetReceiptId}
      FOR UPDATE OF receipts
    `
    if (!target || targetReceiptId === input.sourceId || !receiptKeyMatches(target, input.purchasedOn, location)) {
      throw createError({ statusCode: 409, statusMessage: 'The selected destination receipt changed. Check the destination and try again.' })
    }
    targetLocation = target.location
  } else {
    const canonicalLocation = await ensureStore(tx, location)
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO grocery_receipts (purchased_on, store_id)
      SELECT ${input.purchasedOn}, stores.id
      FROM grocery_stores stores
      WHERE lower(stores.name) = lower(${canonicalLocation})
      ON CONFLICT (purchased_on, store_id) DO NOTHING
      RETURNING id::text
    `
    if (!created) {
      throw createError({ statusCode: 409, statusMessage: 'A receipt now exists at the destination. Check it before moving these lines.' })
    }
    targetReceiptId = created.id
    targetLocation = canonicalLocation
    targetWasCreated = true
  }

  await tx`
    UPDATE grocery_entries
    SET receipt_id = ${targetReceiptId}, updated_at = now()
    WHERE receipt_id = ${input.sourceId} AND id = ANY(${input.entryIds}::bigint[])
  `

  return {
    source: await receiptView(tx, input.sourceId),
    targetReceiptId,
    targetWasCreated,
    movedEntryIds: input.entryIds,
    movedCount: input.entryIds.length,
    targetPurchasedOn: input.purchasedOn,
    targetLocation
  }
}

export async function undoReceiptSplit(tx: Transaction, input: UndoReceiptSplitInput) {
  if (!input.entryIds.length || new Set(input.entryIds).size !== input.entryIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'The split can no longer be undone' })
  }
  if (input.sourceId === input.targetReceiptId) throw createError({ statusCode: 400, statusMessage: 'The split can no longer be undone' })
  const receipts = await tx<{ id: string, purchasedOn: string | Date, location: string }[]>`
    SELECT receipts.id::text, receipts.purchased_on, stores.name AS location
    FROM grocery_receipts receipts
    INNER JOIN grocery_stores stores ON stores.id = receipts.store_id
    WHERE receipts.id = ANY(${[input.sourceId, input.targetReceiptId]}::bigint[])
    ORDER BY receipts.id
    FOR UPDATE OF receipts
  `
  const source = receipts.find(receipt => receipt.id === input.sourceId)
  const target = receipts.find(receipt => receipt.id === input.targetReceiptId)
  if (
    !source || !target
    || !receiptKeyMatches(source, input.sourcePurchasedOn, input.sourceLocation)
    || !receiptKeyMatches(target, input.targetPurchasedOn, input.targetLocation)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'The source or destination changed. This move can no longer be undone.' })
  }

  const selected = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_entries
    WHERE receipt_id = ${input.targetReceiptId} AND id = ANY(${input.entryIds}::bigint[])
    FOR UPDATE
  `
  if (selected.length !== input.entryIds.length) {
    throw createError({ statusCode: 409, statusMessage: 'One or more moved lines have changed. This move can no longer be undone.' })
  }
  await tx`
    UPDATE grocery_entries
    SET receipt_id = ${input.sourceId}, updated_at = now()
    WHERE receipt_id = ${input.targetReceiptId} AND id = ANY(${input.entryIds}::bigint[])
  `
  if (input.targetWasCreated) {
    await tx`
      DELETE FROM grocery_receipts
      WHERE id = ${input.targetReceiptId}
        AND NOT EXISTS (SELECT 1 FROM grocery_entries WHERE receipt_id = ${input.targetReceiptId})
    `
  }
  return { source: await receiptView(tx, input.sourceId) }
}

export function runReceiptSplit(input: SplitReceiptInput) {
  return db().begin(tx => splitReceipt(tx, input))
}

export function runReceiptSplitUndo(input: UndoReceiptSplitInput) {
  return db().begin(tx => undoReceiptSplit(tx, input))
}
