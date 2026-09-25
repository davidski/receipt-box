import type postgres from 'postgres'
import { categoryKey, normalizeCategory } from '../../shared/utils/category.ts'

type Transaction = postgres.TransactionSql
type Database = postgres.Sql | Transaction

export type ItemCategoryAssignment = { item: string, category: string | null }

export async function seedInitialCategories(tx: Transaction) {
  const [seed] = await tx<{ seed: string }[]>`
    INSERT INTO grocery_category_seeds (seed) VALUES ('starter-v1')
    ON CONFLICT DO NOTHING
    RETURNING seed
  `
  if (!seed) return
  await tx`
    INSERT INTO grocery_categories (name, normalized_name) VALUES
      ('Produce', 'produce'),
      ('Dairy and Eggs', 'dairy and eggs'),
      ('Protein', 'protein'),
      ('Bread and Grains', 'bread and grains'),
      ('Pantry and Condiments', 'pantry and condiments'),
      ('Snacks and Sweets', 'snacks and sweets'),
      ('Frozen Foods', 'frozen foods'),
      ('Household and Nonfood', 'household and nonfood')
    ON CONFLICT (normalized_name) DO NOTHING
  `
}

export function requireCategoryId(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid category id' })
  }
  const id = BigInt(value)
  if (id < BigInt(1) || id > BigInt('9223372036854775807')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid category id' })
  }
  return id.toString()
}

export async function managedCategories(sql: Database) {
  return sql<{ id: string, name: string, itemCount: number, entryCount: number }[]>`
    SELECT categories.id::text, categories.name,
      count(DISTINCT mappings.item)::int AS item_count,
      count(DISTINCT entries.id)::int AS entry_count
    FROM grocery_categories categories
    LEFT JOIN grocery_item_categories mappings ON mappings.category_id = categories.id
    LEFT JOIN grocery_entries entries ON entries.item = mappings.item
    GROUP BY categories.id, categories.name
    ORDER BY lower(categories.name), categories.name
  `
}

export async function createCategory(tx: Transaction, rawName: unknown) {
  if (typeof rawName !== 'string') throw createError({ statusCode: 400, statusMessage: 'Category name is required' })
  let name: string
  try {
    name = normalizeCategory(rawName)!
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid category name' })
  }
  const [category] = await tx<{ id: string, name: string }[]>`
    INSERT INTO grocery_categories (name, normalized_name)
    VALUES (${name}, ${categoryKey(name)})
    ON CONFLICT (normalized_name) DO NOTHING
    RETURNING id::text, name
  `
  if (!category) throw createError({ statusCode: 409, statusMessage: 'A category with that name already exists' })
  return { ...category, itemCount: 0, entryCount: 0 }
}

export async function renameCategory(tx: Transaction, id: string, rawName: unknown) {
  if (typeof rawName !== 'string') throw createError({ statusCode: 400, statusMessage: 'Category name is required' })
  let name: string
  try {
    name = normalizeCategory(rawName)!
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid category name' })
  }
  const key = categoryKey(name)
  await lockItemWrites(tx)
  const [existing] = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_categories WHERE id = ${id} FOR UPDATE
  `
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Category not found' })
  const [duplicate] = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_categories WHERE normalized_name = ${key} AND id <> ${id}
  `
  if (duplicate) throw createError({ statusCode: 409, statusMessage: 'A category with that name already exists' })
  const [updated] = await tx<{ id: string, name: string }[]>`
    UPDATE grocery_categories
    SET name = ${name}, normalized_name = ${key}
    WHERE id = ${id}
    RETURNING id::text, name
  `
  return updated!
}

export async function mergeCategories(tx: Transaction, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw createError({ statusCode: 400, statusMessage: 'Choose two different categories' })
  await lockItemWrites(tx)
  const categories = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_categories
    WHERE id = ANY(${[sourceId, targetId]}::bigint[])
    ORDER BY id FOR UPDATE
  `
  if (categories.length !== 2) throw createError({ statusCode: 404, statusMessage: 'One or both categories were not found' })
  const moved = await tx<{ item: string }[]>`
    UPDATE grocery_item_categories SET category_id = ${targetId}
    WHERE category_id = ${sourceId}
    RETURNING item
  `
  await tx`DELETE FROM grocery_categories WHERE id = ${sourceId}`
  return { sourceId, targetId, movedItems: moved.length }
}

export async function deleteCategory(tx: Transaction, id: string) {
  await lockItemWrites(tx)
  const [existing] = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_categories WHERE id = ${id} FOR UPDATE
  `
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Category not found' })
  const mappings = await tx<{ item: string }[]>`
    DELETE FROM grocery_item_categories WHERE category_id = ${id} RETURNING item
  `
  await tx`DELETE FROM grocery_categories WHERE id = ${id}`
  return { id, deleted: true, clearedItems: mappings.length }
}

export function categoryAssignments(entries: Array<{ item: string, category?: string | null }>): ItemCategoryAssignment[] {
  const assignments = new Map<string, ItemCategoryAssignment>()
  for (const entry of entries) {
    if (entry.category === undefined) continue
    const category = normalizeCategory(entry.category)!
    const previous = assignments.get(entry.item)
    if (previous && (previous.category === null || category === null
      ? previous.category !== category
      : categoryKey(previous.category) !== categoryKey(category))) {
      throw createError({ statusCode: 400, statusMessage: `Conflicting categories for ${entry.item}` })
    }
    assignments.set(entry.item, { item: entry.item, category })
  }
  return [...assignments.values()]
}

export async function lockItemWrites(tx: Transaction) {
  // ponytail: one global item lock serializes writes; use per-item locks if write throughput matters.
  await tx`SELECT pg_advisory_xact_lock(hashtext('receipt-box:item-writes'))`
}

export async function setItemCategory(tx: Transaction, item: string, category: string | null) {
  await lockItemWrites(tx)
  if (category === null) {
    await tx`DELETE FROM grocery_item_categories WHERE item = ${item}`
    return
  }
  const name = normalizeCategory(category)!
  const key = categoryKey(name)
  await tx`
    INSERT INTO grocery_categories (name, normalized_name)
    VALUES (${name}, ${key})
    ON CONFLICT (normalized_name) DO NOTHING
  `
  const [saved] = await tx<{ id: string }[]>`
    SELECT id::text FROM grocery_categories WHERE normalized_name = ${key}
  `
  if (!saved) throw new Error('Could not create or find category')
  await tx`
    INSERT INTO grocery_item_categories (item, category_id)
    VALUES (${item}, ${saved.id})
    ON CONFLICT (item) DO UPDATE SET category_id = EXCLUDED.category_id
  `
}

export async function applyCategoryAssignments(tx: Transaction, assignments: ItemCategoryAssignment[]) {
  for (const assignment of assignments) await setItemCategory(tx, assignment.item, assignment.category)
}
