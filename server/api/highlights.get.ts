import { db, publicEntry, type GroceryEntry } from '../utils/db'
import { priceStability, priceTrend } from '../../shared/utils/core-price'

type MoverRow = GroceryEntry & {
  previousPurchasedOn: string | Date
  previousLocation: string
  priceChangePercent: string
  comparisonBasis: 'normalized' | 'package'
}

type CoreItemRow = {
  name: string
  purchases: number
  activeMonths: number
  averageDaysBetween: string | null
  lastPurchasedOn: string | Date
  priceObservations: number
  averageChangePercent: string | null
  netChangePercent: string | null
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

  const [yearRows, summaryRows, moverRows, storeRows, monthlySpendRows, coreItemRows] = await Promise.all([
    sql<{ year: number }[]>`
      SELECT DISTINCT extract(year FROM purchased_on)::int AS year
      FROM grocery_entries
      ORDER BY year DESC
    `,
    sql<{ entries: string, receipts: string, items: string, stores: string, firstDate: string | null, lastDate: string | null }[]>`
      SELECT count(*)::text AS entries,
        count(DISTINCT receipt_id)::text AS receipts,
        count(DISTINCT lower(item))::text AS items,
        count(DISTINCT lower(location))::text AS stores,
        min(purchased_on)::text AS first_date,
        max(purchased_on)::text AS last_date
      FROM grocery_entries
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
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
    sql<{ month: string | Date, totalSpent: string }[]>`
      SELECT date_trunc('month', purchased_on)::date AS month,
        sum(price)::text AS total_spent
      FROM grocery_entries
      WHERE (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
      GROUP BY date_trunc('month', purchased_on)
      ORDER BY date_trunc('month', purchased_on)
    `,
    sql<CoreItemRow[]>`
      WITH filtered AS (
        SELECT *
        FROM grocery_entries
        WHERE NOT non_grocery
          AND (${startDate}::date IS NULL OR purchased_on >= ${startDate}::date)
          AND (${endDate}::date IS NULL OR purchased_on < ${endDate}::date)
      ), purchase_days AS (
        SELECT item_key, purchased_on,
          purchased_on - lag(purchased_on) OVER (PARTITION BY item_key ORDER BY purchased_on) AS days_between
        FROM (SELECT DISTINCT lower(item) AS item_key, purchased_on FROM filtered) dates
      ), item_stats AS (
        SELECT lower(item) AS item_key,
          (array_agg(item ORDER BY purchased_on DESC, id DESC))[1] AS name,
          count(DISTINCT receipt_id)::int AS purchases,
          count(DISTINCT date_trunc('month', purchased_on))::int AS active_months,
          max(purchased_on) AS last_purchased_on
        FROM filtered
        GROUP BY lower(item)
        HAVING count(DISTINCT receipt_id) >= 3
          AND count(DISTINCT date_trunc('month', purchased_on)) >= 2
      ), cadence AS (
        SELECT item_key, avg(days_between)::text AS average_days_between
        FROM purchase_days
        WHERE days_between IS NOT NULL AND days_between > 0
        GROUP BY item_key
      ), comparable AS (
        SELECT lower(item) AS item_key, purchased_on, id,
          CASE WHEN cost_per_unit > 0 AND unit IS NOT NULL THEN cost_per_unit ELSE price END AS comparable_price,
          CASE
            WHEN cost_per_unit > 0 AND unit IS NOT NULL THEN 'normalized:' || upper(unit)
            ELSE 'package:' || coalesce(size::text, '') || ':' || upper(coalesce(unit, ''))
          END AS comparison_basis
        FROM filtered
        WHERE NOT sale_item AND price > 0
      ), basis_counts AS (
        SELECT item_key, comparison_basis, count(*) AS observation_count,
          row_number() OVER (PARTITION BY item_key ORDER BY count(*) DESC, max(purchased_on) DESC, comparison_basis) AS basis_rank
        FROM comparable
        GROUP BY item_key, comparison_basis
      ), selected_prices AS (
        SELECT comparable.*,
          lag(comparable_price) OVER (PARTITION BY comparable.item_key ORDER BY purchased_on, id) AS previous_price,
          first_value(comparable_price) OVER (PARTITION BY comparable.item_key ORDER BY purchased_on, id) AS first_price,
          last_value(comparable_price) OVER (
            PARTITION BY comparable.item_key ORDER BY purchased_on, id
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS last_price
        FROM comparable
        JOIN basis_counts USING (item_key, comparison_basis)
        WHERE basis_rank = 1
      ), price_metrics AS (
        SELECT item_key, count(*)::int AS price_observations,
          avg(abs((comparable_price - previous_price) / previous_price) * 100)
            FILTER (WHERE previous_price > 0)::text AS average_change_percent,
          ((max(last_price) - max(first_price)) / nullif(max(first_price), 0) * 100)::text AS net_change_percent
        FROM selected_prices
        GROUP BY item_key
      )
      SELECT item_stats.name, item_stats.purchases, item_stats.active_months,
        cadence.average_days_between, item_stats.last_purchased_on,
        coalesce(price_metrics.price_observations, 0)::int AS price_observations,
        price_metrics.average_change_percent, price_metrics.net_change_percent
      FROM item_stats
      LEFT JOIN cadence USING (item_key)
      LEFT JOIN price_metrics USING (item_key)
      ORDER BY item_stats.purchases DESC, item_stats.active_months DESC, item_stats.last_purchased_on DESC, item_stats.name
      LIMIT 12
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
      stores: Number(summary?.stores ?? 0),
      firstDate: summary?.firstDate ?? null,
      lastDate: summary?.lastDate ?? null
    },
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
    coreItems: coreItemRows.map(item => {
      const averageChangePercent = item.averageChangePercent === null ? null : Number(item.averageChangePercent)
      const netChangePercent = item.netChangePercent === null ? null : Number(item.netChangePercent)
      return {
        ...item,
        averageDaysBetween: item.averageDaysBetween === null ? null : Number(item.averageDaysBetween),
        lastPurchasedOn: item.lastPurchasedOn instanceof Date
          ? item.lastPurchasedOn.toISOString().slice(0, 10)
          : String(item.lastPurchasedOn).slice(0, 10),
        averageChangePercent,
        netChangePercent,
        stability: priceStability(item.priceObservations, averageChangePercent),
        trend: priceTrend(netChangePercent)
      }
    }),
    monthlySpend
  }
})
