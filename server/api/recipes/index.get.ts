import { defineEventHandler } from 'h3'
import { db } from '../../utils/db'
import type { RecipeLine } from '../../../shared/utils/recipe-cost'
import { snapshotTotal } from '../../utils/recipe-query'

export default defineEventHandler(async () => {
  const sql = db()
  const recipes = await sql<{ lines: RecipeLine[] }[]>`
    SELECT id::text, name, lines, jsonb_array_length(lines)::int AS line_count,
      saved_total::float8 AS saved_total, saved_at, updated_at
    FROM grocery_recipes
    ORDER BY lower(name), id
  `
  // ponytail: N small pricing queries (one per recipe); batch into one DISTINCT ON query if the number of recipes grows
  return Promise.all(recipes.map(async ({ lines, ...recipe }) => ({ ...recipe, currentTotal: await snapshotTotal(sql, lines) })))
})
