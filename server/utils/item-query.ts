import type postgres from 'postgres'
import { categoryKey } from '../../shared/utils/category.ts'
import { lockItemWrites, setItemCategory } from './category-query.ts'

type Transaction = postgres.TransactionSql

export type ItemDimensionVariant = {
  size: string | null
  unit: string | null
  uses: number
}

export type ItemDimensionUpdate = {
  scope: 'all' | 'missing' | 'variant'
  matchSize?: number | null
  matchUnit?: string | null
  size: number
  unit: string
}

export async function itemDimensionVariants(tx: postgres.Sql | Transaction, item: string) {
  return tx<ItemDimensionVariant[]>`
    SELECT size::text, unit, count(*)::int AS uses
    FROM grocery_entries
    WHERE item = ${item}
    GROUP BY size, unit
    ORDER BY count(*) DESC, size NULLS LAST, unit NULLS LAST
  `
}

export async function updateItemDimensions(tx: Transaction, item: string, update: ItemDimensionUpdate) {
  const matchingRows = update.scope === 'all'
    ? tx<{ id: string }[]>`
        SELECT id::text FROM grocery_entries WHERE item = ${item} FOR UPDATE
      `
    : update.scope === 'missing'
      ? tx<{ id: string }[]>`
          SELECT id::text FROM grocery_entries
          WHERE item = ${item} AND (size IS NULL OR unit IS NULL)
          FOR UPDATE
        `
      : tx<{ id: string }[]>`
          SELECT id::text FROM grocery_entries
          WHERE item = ${item}
            AND size IS NOT DISTINCT FROM ${update.matchSize ?? null}
            AND unit IS NOT DISTINCT FROM ${update.matchUnit ?? null}
          FOR UPDATE
        `
  const rows = await matchingRows
  if (!rows.length) return 0
  const ids = rows.map(row => row.id)
  const updated = await tx<{ id: string }[]>`
    UPDATE grocery_entries
    SET size = ${update.size}, unit = ${update.unit}, updated_at = now()
    WHERE id = ANY(${ids}::bigint[])
    RETURNING id::text
  `
  return updated.length
}

export async function renameItemVariants(tx: Transaction, target: string, sources: string[], resolution?: string | null) {
  if (sources.length || resolution !== undefined) {
    const names = [...new Set([target, ...sources])]
    await lockItemWrites(tx)
    const categories = await tx<{ item: string, category: string }[]>`
      SELECT mappings.item, categories.name AS category
      FROM grocery_item_categories mappings
      INNER JOIN grocery_categories categories ON categories.id = mappings.category_id
      WHERE mappings.item = ANY(${names}::text[])
      FOR UPDATE OF mappings
    `
    const choices = [...new Map(categories.map(row => [categoryKey(row.category), row.category])).values()]
    if (resolution === undefined && choices.length > 1) {
      throw createError({
        statusCode: 409,
        statusMessage: 'These item names have conflicting categories. Choose one to keep or clear the category.',
        data: { categories: choices }
      })
    }
    const category = resolution === undefined ? choices[0] ?? null : resolution
    if (sources.length) await tx`DELETE FROM grocery_item_categories WHERE item = ANY(${sources}::text[])`
    await setItemCategory(tx, target, category)
  }

  let mergedEntries = 0
  for (const source of sources) {
    const updated = await tx<{ id: string }[]>`
      UPDATE grocery_entries
      SET item = ${target}, updated_at = now()
      WHERE item = ${source}
      RETURNING id::text
    `
    mergedEntries += updated.length
  }
  return mergedEntries
}
