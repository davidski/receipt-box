import type postgres from 'postgres'

type Sql = postgres.Sql | postgres.TransactionSql

export type ItemBackfillCounts = {
  size: number
  unit: number
  either: number
}

export async function itemBackfillCounts(sql: Sql, item: string, excludeId: string) {
  const [counts] = await sql<ItemBackfillCounts[]>`
    SELECT
      count(*) FILTER (WHERE size IS NULL)::int AS size,
      count(*) FILTER (WHERE unit IS NULL)::int AS unit,
      count(*) FILTER (WHERE size IS NULL OR unit IS NULL)::int AS either
    FROM grocery_entries
    WHERE item = ${item} AND id <> ${excludeId}
  `
  return counts ?? { size: 0, unit: 0, either: 0 }
}

export async function backfillItemDimensions(
  sql: Sql,
  item: string,
  excludeId: string,
  size: string,
  unit: string,
  fields: Array<'size' | 'unit'>
) {
  const affectedIds = new Set<string>()
  if (fields.includes('size')) {
    const rows = await sql<{ id: string }[]>`
      UPDATE grocery_entries
      SET size = ${size}, updated_at = now()
      WHERE item = ${item} AND id <> ${excludeId} AND size IS NULL
      RETURNING id::text
    `
    rows.forEach(row => affectedIds.add(row.id))
  }
  if (fields.includes('unit')) {
    const rows = await sql<{ id: string }[]>`
      UPDATE grocery_entries
      SET unit = ${unit}, updated_at = now()
      WHERE item = ${item} AND id <> ${excludeId} AND unit IS NULL
      RETURNING id::text
    `
    rows.forEach(row => affectedIds.add(row.id))
  }
  if (affectedIds.size) {
    await sql`
      UPDATE grocery_entries
      SET updated_at = now()
      WHERE id = ANY(${[...affectedIds]}::bigint[])
    `
  }
  return affectedIds.size
}
