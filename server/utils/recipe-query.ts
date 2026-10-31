import type postgres from 'postgres'
import { costLine, renameRecipeLineItems, selectPurchase, summarizeRecipeCost, type PurchaseCandidate, type RecipeLine } from '../../shared/utils/recipe-cost.ts'

type Sql = postgres.Sql | postgres.TransactionSql

const maxBigint = BigInt('9223372036854775807')
export const maxRecipeLines = 100
export const maxRecipeNameLength = 120

const badRequest = (statusMessage: string) => createError({ statusCode: 400, statusMessage })

export function parseRecipeLines(value: unknown): RecipeLine[] {
  if (!Array.isArray(value)) throw badRequest('lines must be an array')
  if (value.length > maxRecipeLines) throw badRequest(`A recipe can have at most ${maxRecipeLines} lines`)

  const seen = new Set<string>()
  return value.map((raw: Record<string, unknown> | null) => {
    const item = typeof raw?.item === 'string' ? raw.item.trim() : ''
    if (!item) throw badRequest('Every line needs an item')
    const quantity = raw?.quantity
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw badRequest(`Quantity for "${item}" must be a number greater than 0`)
    }
    const key = item.toLowerCase()
    if (seen.has(key)) throw badRequest(`"${item}" appears more than once`)
    seen.add(key)
    return { item, quantity, unit: typeof raw?.unit === 'string' ? raw.unit.trim() : '' }
  })
}

export function parseRecipeName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw badRequest('A recipe name is required')
  if (name.length > maxRecipeNameLength) throw badRequest(`The recipe name can be at most ${maxRecipeNameLength} characters`)
  return name
}

export function parseRecipeId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value) || BigInt(value) < BigInt(1) || BigInt(value) > maxBigint) throw badRequest('Invalid recipe id')
  return value
}

/** At most one eligible and one ineligible grocery purchase per item: the latest of each. */
export async function latestPurchases(sql: Sql, items: string[]) {
  // shortcut: SQL can't apply normalizeUnit, so a latest purchase with a blank or unrecognized unit hides an older usable one (NO_PACKAGE_SIZE or UNSTANDARDIZED_UNIT), upgrade if that shows up in real data by storing normalized units.
  return items.length
    ? await sql<PurchaseCandidate[]>`
      SELECT DISTINCT ON (entries.item, eligible)
        entries.id::text, entries.item, entries.price, entries.size, entries.unit, entries.sale_item,
        receipts.purchased_on::text AS purchased_on,
        (entries.size > 0 AND entries.unit IS NOT NULL) IS TRUE AS eligible
      FROM grocery_entries entries
      JOIN grocery_receipts receipts ON receipts.id = entries.receipt_id
      WHERE entries.item = ANY(${items}::text[]) AND NOT entries.non_grocery
      ORDER BY entries.item, eligible, receipts.purchased_on DESC, entries.id DESC
    `
    : []
}

export async function priceRecipe(sql: Sql, lines: RecipeLine[]) {
  const purchases = await latestPurchases(sql, lines.map(line => line.item))
  const costed = lines.map((line) => {
    const candidates = purchases.filter(row => row.item === line.item)
    // With nothing eligible, the remaining row makes costLine report NO_PACKAGE_SIZE rather than NO_PRICE.
    const purchase = selectPurchase(candidates) ?? candidates[0] ?? null
    return { ...costLine(line, purchase), purchaseUnit: purchase?.unit ?? null }
  })
  return { lines: costed, ...summarizeRecipeCost(costed) }
}

/** The total to snapshot: null when no line could be priced. */
export async function snapshotTotal(sql: Sql, lines: RecipeLine[]) {
  const { total, excluded } = await priceRecipe(sql, lines)
  return excluded === lines.length ? null : total
}

/** Turns a unique-name violation into a 409; rethrows anything else. */
export function recipeWriteError(error: unknown): never {
  if ((error as { code?: string } | null)?.code === '23505') {
    throw createError({ statusCode: 409, statusMessage: 'A recipe with that name already exists' })
  }
  throw error
}

export async function findRecipe(sql: Sql, id: string) {
  const [recipe] = await sql<{
    id: string, name: string, lines: RecipeLine[], savedTotal: number | null,
    savedAt: string, createdBy: string | null, updatedAt: string
  }[]>`
    SELECT id::text, name, lines, saved_total::float8 AS saved_total, saved_at, created_by, updated_at
    FROM grocery_recipes
    WHERE id = ${id}
  `
  if (!recipe) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  return recipe
}

/** Rewrites item names in saved recipes after items are merged or renamed. */
export async function renameRecipeItems(tx: Sql, target: string, sources: string[]) {
  const keys = [...new Set([target, ...sources].map(name => name.trim().toLowerCase()))]
  const recipes = await tx<{ id: string, lines: RecipeLine[] }[]>`
    SELECT id::text, lines
    FROM grocery_recipes
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(lines) AS line
      WHERE lower(trim(line->>'item')) = ANY(${keys}::text[])
    )
    FOR UPDATE
  `
  for (const recipe of recipes) {
    const lines = renameRecipeLineItems(recipe.lines, target, sources)
    if (JSON.stringify(lines) === JSON.stringify(recipe.lines)) continue
    await tx`UPDATE grocery_recipes SET lines = ${tx.json(lines)}, updated_at = now() WHERE id = ${recipe.id}`
  }
}
