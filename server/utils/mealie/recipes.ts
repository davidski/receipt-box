import type postgres from 'postgres'
import { costLine, selectPurchase, summarizeRecipeCost, type PurchaseObservation, type RecipeCostError } from '../../../shared/utils/recipe-cost.ts'
import { normalizeMealieQuantity, normalizePackageQuantity, type BaseQuantity } from '../../../shared/utils/units.ts'
import { latestPurchases } from '../recipe-query.ts'
import { MealieError, fetchMealieRecipes, type MealieRecord } from './client.ts'
import { uuidPattern } from './sync.ts'

type Sql = postgres.Sql | postgres.TransactionSql

type CachedUnit = { id: string, name: string, pluralName: string | null, standardQuantity: string | null, standardUnit: string | null }

export type IngredientFailure = RecipeCostError | 'SUBRECIPE_UNSUPPORTED' | 'NO_FOOD' | 'UNKNOWN_FOOD' | 'INACTIVE_MEALIE_FOOD' | 'NO_PRODUCT_MAPPING'

export type IngredientCost = {
  food: { id: string, name: string | null } | null
  note: string | null
  recipe: string | null
  quantity: number | null
  unit: { id: string | null, name: string | null } | null
  normalizedQuantity: BaseQuantity | null
  item: string | null
  purchase: PurchaseObservation | null
  normalizedPackageQuantity: BaseQuantity | null
  cost: number | null
  status: 'exact' | 'unit_converted' | 'uncosted'
  error: IngredientFailure | null
}

const countUnits = new Set(['piece', 'pieces', 'whole'])
const text = (value: unknown) => typeof value === 'string' && value ? value : null
const record = (value: unknown) => (typeof value === 'object' && value !== null ? value as MealieRecord : null)
const positiveServings = (recipe: MealieRecord) => (typeof recipe.recipeServings === 'number' && recipe.recipeServings > 0 ? recipe.recipeServings : null)
const cachedIds = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => id !== null && uuidPattern.test(id)))]

function recipeQuantity(quantity: number, unit: MealieRecord | null, cached: CachedUnit | undefined): BaseQuantity | null {
  const count = { base: 'ea', amount: quantity } as const
  if (!unit) return count
  if (!cached) return null
  return normalizeMealieQuantity(quantity, cached.standardQuantity, cached.standardUnit)
    ?? ([cached.name, cached.pluralName].some(name => countUnits.has(String(name).trim().toLowerCase())) ? count : null)
}

/** Costs a fetched Mealie recipe at its stored quantities from the cached catalog, mappings and purchases. */
export async function costMealieRecipe(sql: Sql, recipe: MealieRecord) {
  if (!Array.isArray(recipe.recipeIngredient)) throw new MealieError('malformed', 'Mealie returned a recipe without an ingredient list')
  const ingredients = recipe.recipeIngredient.map(raw => record(raw) ?? {})
  const foodId = (raw: MealieRecord) => text(record(raw.food)?.id)?.toLowerCase() ?? null
  const unitId = (raw: MealieRecord) => text(record(raw.unit)?.id)?.toLowerCase() ?? null

  const foodIds = cachedIds(ingredients.map(foodId))
  const foods = await sql<{ id: string, name: string, active: boolean }[]>`
    SELECT id::text, name, active FROM mealie_foods WHERE id = ANY(${foodIds}::uuid[])
  `
  const units = await sql<CachedUnit[]>`
    SELECT id::text, name, plural_name, standard_quantity::text, standard_unit
    FROM mealie_units WHERE id = ANY(${cachedIds(ingredients.map(unitId))}::uuid[])
  `
  const mappings = await sql<{ item: string, mealieFoodId: string }[]>`
    SELECT item, mealie_food_id::text FROM grocery_item_food_mapping WHERE mealie_food_id = ANY(${foodIds}::uuid[])
  `
  const purchases = await latestPurchases(sql, mappings.map(mapping => mapping.item))

  const costed = ingredients.map((raw): IngredientCost => {
    const id = foodId(raw)
    const food = foods.find(row => row.id === id)
    const rawUnit = record(raw.unit)
    const uid = unitId(raw)
    const base = {
      food: id ? { id, name: food?.name ?? text(record(raw.food)?.name) } : null,
      note: text(raw.note),
      recipe: text(record(raw.referencedRecipe)?.name),
      quantity: typeof raw.quantity === 'number' ? raw.quantity : null,
      unit: rawUnit ? { id: uid, name: text(rawUnit.name) } : null,
      normalizedQuantity: null,
      item: null,
      purchase: null,
      normalizedPackageQuantity: null,
      cost: null
    }
    const fail = (error: IngredientFailure, extra = {}): IngredientCost => ({ ...base, ...extra, status: 'uncosted', error })

    if (raw.referencedRecipe) return fail('SUBRECIPE_UNSUPPORTED')
    if (!id) return fail('NO_FOOD')
    if (!food) return fail('UNKNOWN_FOOD')
    if (!food.active) return fail('INACTIVE_MEALIE_FOOD')
    const items = new Set(mappings.filter(mapping => mapping.mealieFoodId === id).map(mapping => mapping.item))
    if (!items.size) return fail('NO_PRODUCT_MAPPING')

    const candidates = purchases.filter(row => items.has(row.item))
    const purchase = selectPurchase(candidates)
    const quantity = base.quantity !== null && base.quantity > 0 ? base.quantity : 0
    const normalizedQuantity = recipeQuantity(quantity, rawUnit, units.find(unit => unit.id === uid))
    // A blank line unit makes costLine report an unlinked unit as NO_UNIT; a linked one that fails is UNSTANDARDIZED_UNIT.
    // With nothing eligible, the remaining row makes costLine report NO_PACKAGE_SIZE rather than NO_PRICE.
    const line = costLine({ item: food.name, quantity, unit: uid ?? '' }, purchase ?? candidates[0] ?? null, normalizedQuantity)
    const normalizedPackageQuantity = purchase && normalizePackageQuantity(purchase)
    const details = { item: purchase?.item ?? null, purchase, normalizedPackageQuantity, normalizedQuantity: quantity ? normalizedQuantity : null }
    if (line.error) return fail(line.error, details)

    // Same base amount per unit means the recipe and package use the same unit, whatever Mealie calls it.
    const perRecipeUnit = normalizedQuantity!.amount / quantity
    const perPackageUnit = normalizedPackageQuantity!.amount / Number(purchase!.size)
    const status = Math.abs(perRecipeUnit / perPackageUnit - 1) < 1e-9 ? 'exact' : 'unit_converted'
    return { ...base, ...details, cost: line.cost, status, error: null }
  })

  const { total, excluded } = summarizeRecipeCost(costed)
  const servings = positiveServings(recipe)
  return {
    slug: recipe.slug,
    name: recipe.name,
    servings,
    ingredients: costed,
    summary: {
      cost: total,
      costPerServing: servings ? Math.round(total / servings * 100) / 100 : null,
      costedIngredients: costed.length - excluded,
      totalIngredients: costed.length,
      // Rounded down so 100 always means complete: the total is a lower bound below that.
      coverage: costed.length ? Math.floor((costed.length - excluded) / costed.length * 100) : 0,
      uncosted: costed.filter(line => line.error).map(line => ({ name: line.food?.name ?? line.recipe ?? line.note, error: line.error }))
    }
  }
}

export async function listMealieRecipes() {
  const recipes = await fetchMealieRecipes()
  return recipes.map(recipe => ({
    slug: recipe.slug,
    name: recipe.name,
    servings: positiveServings(recipe)
  }))
}

/** The HTTP error for a Mealie failure on a recipe request; anything else is rethrown untouched. */
export function mealieRecipeError(error: unknown): { statusCode: number, statusMessage: string } {
  if (!(error instanceof MealieError)) throw error
  if (error.kind === 'disabled') return { statusCode: 409, statusMessage: error.message }
  if (error.status === 404) return { statusCode: 404, statusMessage: 'Recipe not found in Mealie' }
  if (error.kind === 'network' || error.kind === 'timeout') return { statusCode: 502, statusMessage: `Mealie is unreachable: ${error.message}` }
  return { statusCode: 502, statusMessage: error.message }
}
