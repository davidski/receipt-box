import { createError, defineEventHandler, readBody } from 'h3'
import { db } from '../utils/db'
import { costLine, summarizeRecipeCost, type RecipeLine, type RecipePurchase } from '../../shared/utils/recipe-cost'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ lines?: unknown }>(event)
  if (!Array.isArray(body?.lines)) throw createError({ statusCode: 400, statusMessage: 'lines must be an array' })

  const seen = new Set<string>()
  const lines: RecipeLine[] = body.lines.map((raw: Record<string, unknown> | null) => {
    const item = typeof raw?.item === 'string' ? raw.item.trim() : ''
    if (!item) throw createError({ statusCode: 400, statusMessage: 'Every line needs an item' })
    const quantity = raw?.quantity
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw createError({ statusCode: 400, statusMessage: `Quantity for "${item}" must be a number greater than 0` })
    }
    const key = item.toLowerCase()
    if (seen.has(key)) throw createError({ statusCode: 400, statusMessage: `"${item}" appears more than once` })
    seen.add(key)
    return { item, quantity, unit: typeof raw?.unit === 'string' ? raw.unit.trim() : '' }
  })

  const purchases = lines.length
    ? await db()<(RecipePurchase & { item: string })[]>`
      SELECT DISTINCT ON (entries.item) entries.item, entries.price, entries.size, entries.unit, entries.sale_item
      FROM grocery_entries entries
      JOIN grocery_receipts receipts ON receipts.id = entries.receipt_id
      WHERE entries.item = ANY(${lines.map(line => line.item)}::text[]) AND NOT entries.non_grocery
      ORDER BY entries.item, receipts.purchased_on DESC, entries.id DESC
    `
    : []
  const latest = new Map(purchases.map(row => [row.item, row]))
  const costed = lines.map(line => costLine(line, latest.get(line.item) ?? null))
  return { lines: costed, ...summarizeRecipeCost(costed) }
})
