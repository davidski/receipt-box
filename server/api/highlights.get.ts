import { db, publicEntry, type GroceryEntry } from '../utils/db'

type MoverRow = GroceryEntry & {
  previousPurchasedOn: string | Date
  previousLocation: string
  priceChangePercent: string
  comparisonBasis: 'normalized' | 'package'
}

export default defineEventHandler(async (event) => {
  const sql = db()
  const period = String(getQuery(event).period ?? 'all')
  let startDate: string | null = null
  let endDate: string | null = null

  if (period === 'current-month' || period === '12m') {
    const today = new Date()
    const currentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const start = new Date(currentMonth)
    const end = new Date(currentMonth)

    if (period === 'current-month') {
      end.setUTCMonth(end.getUTCMonth() + 1)
    } else {
      start.setUTCMonth(start.getUTCMonth() - 12)
    }

    startDate = start.toISOString().slice(0, 10)
    endDate = end.toISOString().slice(0, 10)
  } else if (/^\d{4}$/.test(period)) {
    const year = Number(period)
    if (year >= 1900 && year < 9999) {
      startDate = `${year}-01-01`
      endDate = `${year + 1}-01-01`
    }
  }

  const [yearRows, summaryRows, recentRows, moverRows, storeRows, saleItemRows, monthlySpendRows] = await Promise.all([
    sql<{ year: number }[]>`
      SELECT DISTINCT extract(year FROM purchased_on)::int AS year
      FROM grocery_entries
      ORDER BY year DESC
    `,
    sql<{ entries: string, receipts: string, items: string, saleItems: string, stores: string, firstDate: string | null, lastDate: string | null }[]>`
      SELECT count(*)::text AS entries,
        count(DISTINCT receipt_id)::text AS receipts,
        count(DISTINCT lower(item))::text AS items,
        count(DISTINCT lower(item)) FILTER (WHERE sale_item)::text AS sale_items,
        count(DISTINCT lower(location))::text AS stores,
        min(purchased_on)::text AS first_date,
        max(purchased_on)::text AS last_date
      FROM grocery_entries
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
    `,
    sql<GroceryEntry[]>`
      SELECT * FROM grocery_entries
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
      ORDER BY purchased_on DESC, id DESC
      LIMIT 10
    `,
    sql<MoverRow[]>`
      WITH history AS (
        SELECT entries.*,
          lag(price) OVER previous AS previous_price,
          lag(cost_per_unit) OVER previous AS previous_cost_per_unit,
          lag(size) OVER previous AS previous_size,
          lag(unit) OVER previous AS previous_unit,
          lag(sale_item) OVER previous AS previous_sale_item,
          lag(location) OVER previous AS previous_location,
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
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
        AND abs(price_change_percent) >= 10
      ORDER BY purchased_on DESC, id DESC
      LIMIT 10
    `,
    sql<{ name: string, totalSpent: string, lastUsed: string | Date }[]>`
      SELECT (array_agg(location ORDER BY purchased_on DESC, id DESC))[1] AS name,
        sum(price)::text AS total_spent,
        max(purchased_on) AS last_used
      FROM grocery_entries
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
      GROUP BY lower(location)
      ORDER BY sum(price) DESC, max(purchased_on) DESC
      LIMIT 6
    `,
    sql<{ name: string, sales: number, lastSale: string | Date }[]>`
      SELECT (array_agg(item ORDER BY purchased_on DESC, id DESC))[1] AS name,
        count(DISTINCT receipt_id)::int AS sales,
        max(purchased_on) AS last_sale
      FROM grocery_entries
      WHERE sale_item
        AND (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
      GROUP BY lower(item)
      ORDER BY count(DISTINCT receipt_id) DESC, max(purchased_on) DESC
      LIMIT 6
    `,
    sql<{ month: string | Date, totalSpent: string }[]>`
      SELECT date_trunc('month', purchased_on)::date AS month,
        sum(price)::text AS total_spent
      FROM grocery_entries
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
      GROUP BY date_trunc('month', purchased_on)
      ORDER BY date_trunc('month', purchased_on)
    `
  ])

  const summary = summaryRows[0]
  let reportingPeriod: { startDate: string, endDate: string } | null = null
  if (startDate && endDate) {
    const inclusiveEnd = new Date(`${endDate}T00:00:00Z`)
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1)
    reportingPeriod = { startDate, endDate: inclusiveEnd.toISOString().slice(0, 10) }
  }
  const monthKey = (value: string | Date) => value instanceof Date
    ? value.toISOString().slice(0, 7) + '-01'
    : String(value).slice(0, 7) + '-01'
  const spendByMonth = new Map(monthlySpendRows.map(row => [monthKey(row.month), Number(row.totalSpent)]))
  const firstMonth = endDate
    ? `${startDate!.slice(0, 7)}-01`
    : monthlySpendRows[0] ? monthKey(monthlySpendRows[0].month) : null
  let lastMonth = monthlySpendRows.length ? monthKey(monthlySpendRows.at(-1)!.month) : null
  if (endDate) {
    const end = new Date(`${endDate}T00:00:00Z`)
    end.setUTCMonth(end.getUTCMonth() - 1)
    lastMonth = end.toISOString().slice(0, 7) + '-01'
  }

  const monthlySpend: { month: string, totalSpent: number }[] = []
  if (firstMonth && lastMonth) {
    const cursor = new Date(`${firstMonth}T00:00:00Z`)
    const end = new Date(`${lastMonth}T00:00:00Z`)
    while (cursor <= end) {
      const month = cursor.toISOString().slice(0, 7) + '-01'
      monthlySpend.push({ month, totalSpent: spendByMonth.get(month) ?? 0 })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }

  return {
    availableYears: yearRows.map(row => row.year),
    reportingPeriod,
    summary: {
      entries: Number(summary?.entries ?? 0),
      receipts: Number(summary?.receipts ?? 0),
      items: Number(summary?.items ?? 0),
      saleItems: Number(summary?.saleItems ?? 0),
      stores: Number(summary?.stores ?? 0),
      firstDate: summary?.firstDate ?? null,
      lastDate: summary?.lastDate ?? null
    },
    recent: recentRows.map(publicEntry),
    movers: moverRows.map(row => ({
      ...publicEntry(row),
      previousLocation: row.previousLocation,
      previousPurchasedOn: row.previousPurchasedOn instanceof Date
        ? row.previousPurchasedOn.toISOString().slice(0, 10)
        : String(row.previousPurchasedOn).slice(0, 10)
    })),
    topStores: storeRows.map(store => ({
      ...store,
      totalSpent: Number(store.totalSpent),
      lastUsed: store.lastUsed instanceof Date ? store.lastUsed.toISOString().slice(0, 10) : String(store.lastUsed).slice(0, 10)
    })),
    topSaleItems: saleItemRows.map(item => ({
      ...item,
      lastSale: item.lastSale instanceof Date ? item.lastSale.toISOString().slice(0, 10) : String(item.lastSale).slice(0, 10)
    })),
    monthlySpend
  }
})
