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
    INSERT INTO grocery_receipts (purchased_on, location)
    VALUES (${purchasedOn}, ${location})
    ON CONFLICT (
      purchased_on,
      (
        lower(
          regexp_replace(
            regexp_replace(trim(normalize(location, NFKC)), '[[:space:]]+', ' ', 'g'),
            '[‘’ʼ]', '''', 'g'
          )
        )
      )
    ) DO UPDATE SET
      purchased_on = EXCLUDED.purchased_on,
      location = EXCLUDED.location,
      updated_at = now()
    RETURNING id::text
  `
  if (!receipt) throw new Error('Could not create or find receipt')
  return receipt.id
}

export async function moveReceiptToKey(
  tx: Transaction,
  sourceId: string,
  purchasedOn: string | Date,
  location: string
) {
  const destinationId = await upsertReceipt(tx, purchasedOn, location)

  await tx`
    UPDATE grocery_entries
    SET receipt_id = ${destinationId}, purchased_on = ${purchasedOn}, location = ${location}, updated_at = now()
    WHERE receipt_id = ${sourceId}
  `
  if (destinationId !== sourceId) {
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
    WHERE lower(location) = lower(${currentLocation})
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
    GROUP BY purchased_on, location
    HAVING count(*) > 1
    ORDER BY purchased_on, location
  `

  let merged = 0
  for (const group of groups) {
    const [winnerId, ...duplicateIds] = group.receiptIds
    if (!winnerId || !duplicateIds.length) continue

    await tx`
      UPDATE grocery_entries
      SET receipt_id = ${winnerId}
      WHERE receipt_id = ANY(${duplicateIds}::bigint[])
    `
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
