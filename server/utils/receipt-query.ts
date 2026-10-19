import type postgres from 'postgres'

type Transaction = postgres.TransactionSql

type ReceiptIdentity = {
  id: string
}

export async function ensureStore(tx: Transaction, location: string) {
  await tx`INSERT INTO grocery_stores (name) VALUES (${location}) ON CONFLICT DO NOTHING`
  const [store] = await tx<{ name: string }[]>`
    SELECT name FROM grocery_stores WHERE lower(name) = lower(${location})
  `
  if (!store) throw new Error('Could not create or find store')
  return store.name
}

export async function upsertReceipt(
  tx: Transaction,
  purchasedOn: string | Date,
  location: string
) {
  const [receipt] = await tx<ReceiptIdentity[]>`
    INSERT INTO grocery_receipts (purchased_on, store_id)
    SELECT ${purchasedOn}, stores.id
    FROM grocery_stores stores
    WHERE lower(stores.name) = lower(${location})
    ON CONFLICT (purchased_on, store_id) DO UPDATE SET
      purchased_on = EXCLUDED.purchased_on,
      updated_at = now()
    RETURNING id::text
  `
  if (!receipt) throw new Error('Could not create or find receipt')
  return receipt.id
}

export async function nextPosition(tx: Transaction, receiptId: string) {
  const [row] = await tx<{ next: number }[]>`
    SELECT coalesce(max(position), 0) + 1 AS next FROM grocery_entries WHERE receipt_id = ${receiptId}
  `
  return row!.next
}

// Appends entries to the end of a receipt, keeping their relative order
// (by source receipt order, then position). Without entryIds, moves every line.
export async function moveEntries(
  tx: Transaction,
  targetId: string,
  sourceIds: string[],
  options: { entryIds?: string[], touch?: boolean } = {}
) {
  await tx`
    UPDATE grocery_entries entries
    SET receipt_id = ${targetId},
      position = last.position + moved.rank,
      updated_at = CASE WHEN ${options.touch ?? false} THEN now() ELSE entries.updated_at END
    FROM (
      SELECT id, row_number() OVER (
        ORDER BY array_position(${sourceIds}::bigint[], receipt_id), position, id
      )::int AS rank
      FROM grocery_entries
      WHERE receipt_id = ANY(${sourceIds}::bigint[])
        AND (${options.entryIds ?? null}::bigint[] IS NULL OR id = ANY(${options.entryIds ?? null}::bigint[]))
    ) moved,
    (SELECT coalesce(max(position), 0) AS position FROM grocery_entries WHERE receipt_id = ${targetId}) last
    WHERE entries.id = moved.id
  `
}

export async function moveReceiptToKey(
  tx: Transaction,
  sourceId: string,
  purchasedOn: string | Date,
  location: string
) {
  const destinationId = await upsertReceipt(tx, purchasedOn, location)

  if (destinationId !== sourceId) {
    await moveEntries(tx, destinationId, [sourceId])
    await tx`DELETE FROM grocery_receipts WHERE id = ${sourceId}`
  }

  return destinationId
}

export async function moveStoreReceipts(
  tx: Transaction,
  currentLocation: string,
  destinationLocation: string
) {
  const receipts = await tx<{ id: string, purchasedOn: string | Date }[]>`
    SELECT id::text, purchased_on
    FROM grocery_receipts
    WHERE store_id = (
      SELECT id FROM grocery_stores WHERE lower(name) = lower(${currentLocation})
    )
    ORDER BY purchased_on, id
    FOR UPDATE
  `
  for (const receipt of receipts) {
    await moveReceiptToKey(tx, receipt.id, receipt.purchasedOn, destinationLocation)
  }
  return receipts.length
}

export async function mergeDuplicateReceipts(tx: Transaction) {
  const groups = await tx<{
    receiptIds: string[]
    createdAt: string | Date
    updatedAt: string | Date
  }[]>`
    SELECT array_agg(id::text ORDER BY created_at, id) AS receipt_ids,
      min(created_at) AS created_at,
      max(updated_at) AS updated_at
    FROM grocery_receipts
    GROUP BY purchased_on, store_id
    HAVING count(*) > 1
    ORDER BY purchased_on, store_id
  `

  let merged = 0
  for (const group of groups) {
    const [winnerId, ...duplicateIds] = group.receiptIds
    if (!winnerId || !duplicateIds.length) continue

    await moveEntries(tx, winnerId, duplicateIds)
    await tx`DELETE FROM grocery_receipts WHERE id = ANY(${duplicateIds}::bigint[])`
    await tx`
      UPDATE grocery_receipts
      SET created_at = ${group.createdAt}, updated_at = ${group.updatedAt}
      WHERE id = ${winnerId}
    `
    merged += duplicateIds.length
  }
  return merged
}
