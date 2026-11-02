import type postgres from 'postgres'
import { lockItemWrites } from './category-query.ts'
import { uuidPattern } from './mealie/sync.ts'

type Transaction = postgres.TransactionSql
type Database = postgres.Sql | Transaction

// Every way a mapping can be created. A confirmed suggestion is still manual, because a person chose it. A new source adds its value here; there is no database constraint to migrate.
export type FoodMappingSource = 'manual'

export type FoodMapping = {
  item: string
  mealieFoodId: string
  foodName: string | null
  mappingSource: FoodMappingSource
  mappedAt: Date
  broken: boolean
  hasEntries: boolean
}

export type MappedFood = { item: string, mealieFoodId: string, foodName: string | null, active: boolean }

export type FoodSuggestionMatch = 'exact_name' | 'plural_name' | 'exact_alias' | 'normalized_name' | 'fuzzy'

export type FoodSuggestion = {
  mealieFoodId: string
  foodName: string
  matchType: FoodSuggestionMatch
  matchedText: string
  similarity: number | null
}

// Tuned on made-up receipt names against a real 706-food catalog: below this wrong top picks appear, above it real foods are lost. Fuzzy results still need a person to confirm them.
export const fuzzyCutoff = 0.3
const maxSuggestions = 5

export function requireItemName(value: unknown) {
  const item = typeof value === 'string' ? value.trim() : ''
  if (!item) throw createError({ statusCode: 400, statusMessage: 'An item name is required' })
  return item
}

export function requireFoodId(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw createError({ statusCode: 400, statusMessage: 'Invalid Mealie food id' })
  return value.toLowerCase()
}

// undefined means no choice was made and null means clear, matching the category resolution.
export function parseFoodResolution(value: unknown) {
  return value === undefined || value === null ? value : requireFoodId(value)
}

// No foreign key: a food missing from the cache must flag the mapping as broken, never remove it.
async function foodMappings(sql: Database, item: string | null) {
  return sql<FoodMapping[]>`
    SELECT mappings.item, mappings.mealie_food_id::text, foods.name AS food_name, mappings.mapping_source, mappings.mapped_at,
      COALESCE(NOT foods.active, TRUE) AS broken,
      EXISTS (SELECT 1 FROM grocery_entries entries WHERE entries.item = mappings.item) AS has_entries
    FROM grocery_item_food_mapping mappings
    LEFT JOIN mealie_foods foods ON foods.id = mappings.mealie_food_id
    WHERE ${item}::text IS NULL OR mappings.item = ${item}
    ORDER BY lower(mappings.item), mappings.item
  `
}

export async function getFoodMapping(sql: Database, item: string) {
  const [mapping] = await foodMappings(sql, item)
  return mapping ?? null
}

export function listFoodMappings(sql: Database) {
  return foodMappings(sql, null)
}

export async function setFoodMapping(tx: Transaction, item: string, foodId: string) {
  await lockItemWrites(tx)
  const [entry] = await tx`SELECT 1 FROM grocery_entries WHERE item = ${item} LIMIT 1`
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'That item name no longer exists' })
  const [food] = await tx<{ active: boolean }[]>`SELECT active FROM mealie_foods WHERE id = ${foodId}`
  if (!food) throw createError({ statusCode: 400, statusMessage: 'That food is not in the Mealie catalog. Sync Mealie and try again.' })
  if (!food.active) throw createError({ statusCode: 409, statusMessage: 'That food is no longer active in Mealie' })
  const source: FoodMappingSource = 'manual'
  await tx`
    INSERT INTO grocery_item_food_mapping (item, mealie_food_id, mapping_source, mapped_at)
    VALUES (${item}, ${foodId}, ${source}, now())
    ON CONFLICT (item) DO UPDATE SET
      mealie_food_id = excluded.mealie_food_id,
      mapping_source = excluded.mapping_source,
      mapped_at = excluded.mapped_at
  `
  return (await getFoodMapping(tx, item))!
}

export async function deleteFoodMapping(tx: Transaction, item: string) {
  await lockItemWrites(tx)
  const deleted = await tx`DELETE FROM grocery_item_food_mapping WHERE item = ${item} RETURNING item`
  return deleted.length > 0
}

export async function unmappedItems(sql: Database) {
  return sql<{ item: string, entries: number }[]>`
    SELECT entries.item, count(*)::int AS entries
    FROM grocery_entries entries
    WHERE NOT entries.non_grocery
      AND NOT EXISTS (SELECT 1 FROM grocery_item_food_mapping mappings WHERE mappings.item = entries.item)
    GROUP BY entries.item
    ORDER BY lower(entries.item), entries.item
  `
}

// Only active foods can be mapped, so inactive ones never reach the picker. strpos treats the search as literal text, unlike LIKE.
export function searchActiveFoods(sql: Database, search: string) {
  return sql<{ id: string, name: string }[]>`
    SELECT foods.id::text, foods.name
    FROM mealie_foods foods
    WHERE foods.active AND (
      strpos(lower(foods.name), lower(${search})) > 0
      OR EXISTS (SELECT 1 FROM mealie_food_aliases aliases WHERE aliases.food_id = foods.id AND strpos(lower(aliases.alias), lower(${search})) > 0)
    )
    ORDER BY lower(foods.name), foods.id
    LIMIT 50
  `
}

export async function cachedFood(sql: Database, id: string) {
  const [food] = await sql<{ id: string, name: string, active: boolean }[]>`SELECT id::text, name, active FROM mealie_foods WHERE id = ${id}`
  return food ?? null
}

export async function foodMappingProblems(sql: Database) {
  // Only items mapped to an active food: an unmapped item cannot price a recipe whatever its size, and an inactive food fails costing first (see the broken group). The size test mirrors selectPurchase.
  const itemsWithoutPackageSize = await sql<{ item: string, entries: number }[]>`
    SELECT entries.item, count(*)::int AS entries
    FROM grocery_entries entries
    JOIN grocery_item_food_mapping mappings ON mappings.item = entries.item
    JOIN mealie_foods foods ON foods.id = mappings.mealie_food_id AND foods.active
    WHERE NOT entries.non_grocery
    GROUP BY entries.item
    HAVING count(*) FILTER (WHERE entries.size > 0 AND entries.unit IS NOT NULL) = 0
    ORDER BY lower(entries.item), entries.item
  `
  return { itemsWithoutPackageSize }
}

export async function lockMappedFoods(tx: Transaction, names: string[]) {
  return tx<MappedFood[]>`
    SELECT mappings.item, mappings.mealie_food_id::text, foods.name AS food_name, COALESCE(foods.active, FALSE) AS active
    FROM grocery_item_food_mapping mappings
    LEFT JOIN mealie_foods foods ON foods.id = mappings.mealie_food_id
    WHERE mappings.item = ANY(${names}::text[])
    ORDER BY mappings.item
    FOR UPDATE OF mappings
  `
}

export function distinctFoods(rows: MappedFood[]) {
  return [...new Map(rows.map(({ mealieFoodId, foodName, active }) => [mealieFoodId, { id: mealieFoodId, name: foodName, active }])).values()]
}

// A chosen food must already be mapped on one of the names, so a resolution cannot introduce an uncached or stale food.
export function hasFoodConflict(rows: MappedFood[], resolution: string | null | undefined) {
  const foods = distinctFoods(rows)
  return resolution === undefined ? foods.length > 1 : resolution !== null && !foods.some(food => food.id === resolution)
}

// Moves the kept row so its source and mapped_at survive; the target's own row wins when it already has that food.
export async function carryFoodMapping(tx: Transaction, target: string, rows: MappedFood[], foodId: string | null) {
  const kept = rows.find(row => row.item === target && row.mealieFoodId === foodId) ?? rows.find(row => row.mealieFoodId === foodId)
  const stale = rows.filter(row => row !== kept).map(row => row.item)
  if (stale.length) await tx`DELETE FROM grocery_item_food_mapping WHERE item = ANY(${stale}::text[])`
  if (kept && kept.item !== target) await tx`UPDATE grocery_item_food_mapping SET item = ${target} WHERE item = ${kept.item}`
}

// Read-only: a suggestion only becomes a mapping when a person sends it to PUT /api/items/food.
export async function foodSuggestions(sql: Database, item: string) {
  return sql<FoodSuggestion[]>`
    WITH terms AS (
      SELECT foods.id, foods.name AS food_name, 'name' AS kind, foods.name AS term FROM mealie_foods foods WHERE foods.active
      UNION ALL
      SELECT foods.id, foods.name, 'plural', foods.plural_name FROM mealie_foods foods WHERE foods.active AND foods.plural_name IS NOT NULL
      UNION ALL
      SELECT foods.id, foods.name, 'alias', aliases.alias
      FROM mealie_foods foods
      INNER JOIN mealie_food_aliases aliases ON aliases.food_id = foods.id
      WHERE foods.active
    ),
    keyed AS (
      SELECT source.*, keys.exact_key, btrim(regexp_replace(regexp_replace(translate(keys.exact_key, '''’', ''), '[^[:alnum:]]+', ' ', 'g'), 's( |$)', '\\1', 'g')) AS normalized_key
      FROM (
        SELECT id, food_name, kind, term FROM terms
        UNION ALL
        SELECT NULL, NULL, 'item', ${item}::text
      ) source
      CROSS JOIN LATERAL (
        SELECT lower(regexp_replace(btrim(normalize(source.term, NFKC)), '[[:space:]]+', ' ', 'g')) AS exact_key
      ) keys
    ),
    scored AS (
      SELECT food.id, food.food_name, food.term, similarity(food.exact_key, query.exact_key) AS score,
        CASE
          WHEN food.exact_key = query.exact_key AND food.kind = 'name' THEN 1
          WHEN food.exact_key = query.exact_key AND food.kind = 'plural' THEN 2
          WHEN food.exact_key = query.exact_key THEN 3
          WHEN food.kind <> 'alias' AND food.normalized_key = query.normalized_key AND query.normalized_key <> '' THEN 4
          ELSE 5
        END AS rank
      FROM keyed food
      CROSS JOIN (SELECT exact_key, normalized_key FROM keyed WHERE kind = 'item') query
      WHERE food.kind <> 'item'
    ),
    best AS (
      SELECT DISTINCT ON (id) *
      FROM scored
      WHERE rank < 5 OR score >= ${fuzzyCutoff}
      ORDER BY id, rank, score DESC, term
    )
    SELECT id::text AS mealie_food_id, food_name, term AS matched_text,
      (ARRAY['exact_name', 'plural_name', 'exact_alias', 'normalized_name', 'fuzzy'])[rank] AS match_type,
      CASE WHEN rank = 5 THEN score END AS similarity
    FROM best
    ORDER BY rank, score DESC, lower(food_name), id
    LIMIT ${maxSuggestions}
  `
}
