import { db, publicEntry, type GroceryEntry } from '../../utils/db'

type HistoryEntryRow = GroceryEntry & {
  previousPrice: string | null
  previousCostPerUnit: string | null
  previousPurchasedOn: string | Date | null
  priceChangePercent: string | null
  comparisonBasis: 'normalized' | 'package' | null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const search = String(query.search ?? '').trim()
  const location = String(query.location ?? '').trim()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 5000)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const sortColumns: Record<string, string> = {
    purchasedOn: 'purchased_on',
    item: 'item',
    location: 'location',
    size: 'size',
    price: 'price',
    costPerUnit: 'cost_per_unit'
  }
  const sortBy = sortColumns[String(query.sortBy)] ? String(query.sortBy) : 'purchasedOn'
  const sortDirection = String(query.sortDirection).toLowerCase() === 'asc' ? 'asc' : 'desc'
  const allowedChangeFilters = ['all', 'changed', 'higher', 'lower', 'sale']
  const changeFilter = allowedChangeFilters.includes(String(query.changeFilter)) ? String(query.changeFilter) : 'all'
  const sql = db()

  const orderColumn = sql(sortColumns[sortBy]!)
  const rows = sortDirection === 'asc'
    ? await sql<HistoryEntryRow[]>`
        WITH history AS (
          SELECT entries.*,
            lag(price) OVER previous AS previous_price,
            lag(cost_per_unit) OVER previous AS previous_cost_per_unit,
            lag(size) OVER previous AS previous_size,
            lag(unit) OVER previous AS previous_unit,
            lag(sale_item) OVER previous AS previous_sale_item,
            lag(purchased_on) OVER previous AS previous_purchased_on
          FROM grocery_entries entries
          WINDOW previous AS (PARTITION BY lower(item) ORDER BY purchased_on, id)
        ), priced AS (
          SELECT history.*,
            CASE
              WHEN previous_cost_per_unit > 0 AND cost_per_unit IS NOT NULL AND sale_item = previous_sale_item AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, ''))
                THEN round(((cost_per_unit - previous_cost_per_unit) / previous_cost_per_unit) * 100, 2)
              WHEN previous_price > 0 AND sale_item = previous_sale_item AND size IS NOT DISTINCT FROM previous_size AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, ''))
                THEN round(((price - previous_price) / previous_price) * 100, 2)
              ELSE NULL
            END AS price_change_percent,
            CASE
              WHEN previous_cost_per_unit > 0 AND cost_per_unit IS NOT NULL AND sale_item = previous_sale_item AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, '')) THEN 'normalized'
              WHEN previous_price > 0 AND sale_item = previous_sale_item AND size IS NOT DISTINCT FROM previous_size AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, '')) THEN 'package'
              ELSE NULL
            END AS comparison_basis
          FROM history
        )
        SELECT * FROM priced
        WHERE (${search} = '' OR item ILIKE ${`%${search}%`} OR notes ILIKE ${`%${search}%`})
          AND (${location} = '' OR location = ${location})
          AND (${changeFilter} = 'all'
            OR (${changeFilter} = 'sale' AND sale_item)
            OR (${changeFilter} = 'changed' AND abs(price_change_percent) >= 0.01)
            OR (${changeFilter} = 'higher' AND price_change_percent >= 10)
            OR (${changeFilter} = 'lower' AND price_change_percent <= -10))
        ORDER BY ${orderColumn} ASC NULLS LAST, id ASC
        LIMIT ${limit} OFFSET ${offset}
      `
    : await sql<HistoryEntryRow[]>`
        WITH history AS (
          SELECT entries.*,
            lag(price) OVER previous AS previous_price,
            lag(cost_per_unit) OVER previous AS previous_cost_per_unit,
            lag(size) OVER previous AS previous_size,
            lag(unit) OVER previous AS previous_unit,
            lag(sale_item) OVER previous AS previous_sale_item,
            lag(purchased_on) OVER previous AS previous_purchased_on
          FROM grocery_entries entries
          WINDOW previous AS (PARTITION BY lower(item) ORDER BY purchased_on, id)
        ), priced AS (
          SELECT history.*,
            CASE
              WHEN previous_cost_per_unit > 0 AND cost_per_unit IS NOT NULL AND sale_item = previous_sale_item AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, ''))
                THEN round(((cost_per_unit - previous_cost_per_unit) / previous_cost_per_unit) * 100, 2)
              WHEN previous_price > 0 AND sale_item = previous_sale_item AND size IS NOT DISTINCT FROM previous_size AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, ''))
                THEN round(((price - previous_price) / previous_price) * 100, 2)
              ELSE NULL
            END AS price_change_percent,
            CASE
              WHEN previous_cost_per_unit > 0 AND cost_per_unit IS NOT NULL AND sale_item = previous_sale_item AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, '')) THEN 'normalized'
              WHEN previous_price > 0 AND sale_item = previous_sale_item AND size IS NOT DISTINCT FROM previous_size AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, '')) THEN 'package'
              ELSE NULL
            END AS comparison_basis
          FROM history
        )
        SELECT * FROM priced
        WHERE (${search} = '' OR item ILIKE ${`%${search}%`} OR notes ILIKE ${`%${search}%`})
          AND (${location} = '' OR location = ${location})
          AND (${changeFilter} = 'all'
            OR (${changeFilter} = 'sale' AND sale_item)
            OR (${changeFilter} = 'changed' AND abs(price_change_percent) >= 0.01)
            OR (${changeFilter} = 'higher' AND price_change_percent >= 10)
            OR (${changeFilter} = 'lower' AND price_change_percent <= -10))
        ORDER BY ${orderColumn} DESC NULLS LAST, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `
  const countRows = await sql<{ count: string }[]>`
    WITH history AS (
      SELECT entries.*,
        lag(price) OVER previous AS previous_price,
        lag(cost_per_unit) OVER previous AS previous_cost_per_unit,
        lag(size) OVER previous AS previous_size,
        lag(unit) OVER previous AS previous_unit,
        lag(sale_item) OVER previous AS previous_sale_item
      FROM grocery_entries entries
      WINDOW previous AS (PARTITION BY lower(item) ORDER BY purchased_on, id)
    ), priced AS (
      SELECT history.*,
        CASE
          WHEN previous_cost_per_unit > 0 AND cost_per_unit IS NOT NULL AND sale_item = previous_sale_item AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, ''))
            THEN ((cost_per_unit - previous_cost_per_unit) / previous_cost_per_unit) * 100
          WHEN previous_price > 0 AND sale_item = previous_sale_item AND size IS NOT DISTINCT FROM previous_size AND upper(coalesce(unit, '')) = upper(coalesce(previous_unit, ''))
            THEN ((price - previous_price) / previous_price) * 100
          ELSE NULL
        END AS price_change_percent
      FROM history
    )
    SELECT count(*)::text AS count FROM priced
    WHERE (${search} = '' OR item ILIKE ${`%${search}%`} OR notes ILIKE ${`%${search}%`})
      AND (${location} = '' OR location = ${location})
      AND (${changeFilter} = 'all'
        OR (${changeFilter} = 'sale' AND sale_item)
        OR (${changeFilter} = 'changed' AND abs(price_change_percent) >= 0.01)
        OR (${changeFilter} = 'higher' AND price_change_percent >= 10)
        OR (${changeFilter} = 'lower' AND price_change_percent <= -10))
  `

  const entries = rows.map((row) => ({
    ...publicEntry(row),
    previousPurchasedOn: row.previousPurchasedOn instanceof Date
      ? row.previousPurchasedOn.toISOString().slice(0, 10)
      : row.previousPurchasedOn ? String(row.previousPurchasedOn).slice(0, 10) : null
  }))
  return { entries, total: Number(countRows[0]?.count ?? 0) }
})
