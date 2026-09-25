import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const { categoryKey, normalizeCategory } = await import('../shared/utils/category.ts')
const {
  applyCategoryAssignments,
  categoryAssignments,
  createCategory,
  deleteCategory,
  managedCategories,
  mergeCategories,
  renameCategory,
  requireCategoryId,
  seedInitialCategories,
  setItemCategory
} = await import('../server/utils/category-query.ts')
const { renameItemVariants } = await import('../server/utils/item-query.ts')
const { normalizeEntry } = await import('../server/utils/entry-input.ts')

function fakeTransaction(responses = []) {
  const queries = []
  const tx = (strings, ...values) => {
    queries.push({ sql: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    return Promise.resolve(responses.shift() ?? [])
  }
  return { tx, queries }
}

describe('category normalization', () => {
  test('trims, folds whitespace and Unicode, and compares without case', () => {
    assert.equal(normalizeCategory('  ＦＲＥＳＨ   Food  '), 'FRESH Food')
    assert.equal(categoryKey('ＦＲＥＳＨ Food'), 'fresh food')
  })

  test('keeps omitted and explicit clear distinct and rejects invalid values', () => {
    assert.equal(normalizeCategory(undefined), undefined)
    assert.equal(normalizeCategory(null), null)
    assert.equal(normalizeCategory('🥕'.repeat(100)), '🥕'.repeat(100))
    for (const value of ['', '  ', 4, 'x'.repeat(101)]) {
      assert.throws(() => normalizeCategory(value))
    }
  })

  test('entry input preserves omitted categories and validates explicit categories', () => {
    const valid = { purchasedOn: '2026-08-06', item: 'Milk', location: 'Market', price: 2 }
    assert.equal(Object.hasOwn(normalizeEntry(valid), 'category'), false)
    assert.equal(normalizeEntry({ ...valid, category: null }).category, null)
    assert.equal(normalizeEntry({ ...valid, category: '  Dairy  ' }).category, 'Dairy')
    assert.throws(() => normalizeEntry({ ...valid, category: 'x'.repeat(101) }), error => error.statusCode === 400)
  })
})

describe('item category persistence', () => {
  test('omitted categories leave mappings alone; explicit null clears the shared mapping', async () => {
    const omitted = fakeTransaction()
    await applyCategoryAssignments(omitted.tx, categoryAssignments([{ item: 'Milk' }]))
    assert.equal(omitted.queries.length, 0)

    const cleared = fakeTransaction()
    await setItemCategory(cleared.tx, 'Milk', null)
    assert.match(cleared.queries[1].sql, /DELETE FROM grocery_item_categories WHERE item = \?/)
    assert.deepEqual(cleared.queries[1].values, ['Milk'])
  })

  test('creates or reuses the normalized catalog row and assigns one mapping by exact item name', async () => {
    const { tx, queries } = fakeTransaction([[], [], [{ id: '17' }], []])
    await setItemCategory(tx, 'Milk', ' Dairy  Products ')
    assert.match(queries[0].sql, /pg_advisory_xact_lock/)
    assert.match(queries[1].sql, /ON CONFLICT \(normalized_name\) DO NOTHING/)
    assert.deepEqual(queries[1].values, ['Dairy Products', 'dairy products'])
    assert.match(queries[2].sql, /WHERE normalized_name = \?/)
    assert.match(queries[3].sql, /ON CONFLICT \(item\) DO UPDATE SET category_id/)
    assert.deepEqual(queries[3].values, ['Milk', '17'])
  })

  test('rejects conflicting explicit categories for the same exact item in one request', () => {
    assert.deepEqual(categoryAssignments([
      { item: 'Milk', category: 'Dairy' },
      { item: 'Milk', category: ' dairy ' }
    ]), [{ item: 'Milk', category: 'dairy' }])
    assert.throws(() => categoryAssignments([
      { item: 'Milk', category: 'Dairy' },
      { item: 'Milk', category: null }
    ]), error => error.statusCode === 400)
    assert.throws(() => categoryAssignments([
      { item: 'Milk', category: 'Dairy' },
      { item: 'Milk', category: 'Bakery' }
    ]), error => error.statusCode === 400)
  })

  test('carries a sole category to the renamed item within the transaction', async () => {
    const { tx, queries } = fakeTransaction([
      [], [{ item: 'Old Milk', category: 'Dairy' }], [], [], [], [{ id: '8' }], [], [{ id: '8' }]
    ])
    assert.equal(await renameItemVariants(tx, 'Milk', ['Old Milk']), 1)
    assert.match(queries[0].sql, /pg_advisory_xact_lock/)
    assert.match(queries[1].sql, /FOR UPDATE OF mappings/)
    assert.match(queries[2].sql, /DELETE FROM grocery_item_categories/)
    assert.match(queries[6].sql, /ON CONFLICT \(item\) DO UPDATE/)
    assert.deepEqual(queries[6].values, ['Milk', '8'])
  })

  test('rejects category conflicts with choices, and explicit null resolves by clearing', async () => {
    const conflicts = fakeTransaction([[], [{ item: 'Old Milk', category: 'Dairy' }, { item: 'Milk', category: 'Drinks' }]])
    await assert.rejects(renameItemVariants(conflicts.tx, 'Milk', ['Old Milk']), error => {
      assert.equal(error.statusCode, 409)
      assert.deepEqual(error.data.categories, ['Dairy', 'Drinks'])
      return true
    })
    assert.equal(conflicts.queries.length, 2)

    const resolved = fakeTransaction([
      [], [{ item: 'Old Milk', category: 'Dairy' }, { item: 'Milk', category: 'Drinks' }], [], [], [], [{ id: '3' }]
    ])
    await renameItemVariants(resolved.tx, 'Milk', ['Old Milk'], null)
    assert.match(resolved.queries[4].sql, /DELETE FROM grocery_item_categories WHERE item = \?/)
    assert.deepEqual(resolved.queries[4].values, ['Milk'])
  })
})

describe('category management', () => {
  test('seeds starter categories once and leaves existing catalogs untouched', async () => {
    const fresh = fakeTransaction([[{ seed: 'starter-v1' }]])
    await seedInitialCategories(fresh.tx)
    assert.equal(fresh.queries.length, 2)
    assert.match(fresh.queries[0].sql, /INSERT INTO grocery_category_seeds/)
    assert.match(fresh.queries[1].sql, /INSERT INTO grocery_categories[\s\S]*ON CONFLICT \(normalized_name\) DO NOTHING/)
    for (const name of [
      'Produce', 'Dairy and Eggs', 'Protein', 'Bread and Grains',
      'Pantry and Condiments', 'Snacks and Sweets', 'Frozen Foods', 'Household and Nonfood'
    ]) assert.ok(fresh.queries[1].sql.includes(`'${name}'`))

    const existing = fakeTransaction([[]])
    await seedInitialCategories(existing.tx)
    assert.equal(existing.queries.length, 1)
  })

  test('creates a normalized unused category and rejects invalid or duplicate names', async () => {
    const { tx, queries } = fakeTransaction([[{ id: '9', name: 'Fresh Food' }]])
    assert.deepEqual(await createCategory(tx, '  Fresh   Food  '), {
      id: '9', name: 'Fresh Food', itemCount: 0, entryCount: 0
    })
    assert.match(queries[0].sql, /INSERT INTO grocery_categories \(name, normalized_name\)/)
    assert.match(queries[0].sql, /ON CONFLICT \(normalized_name\) DO NOTHING RETURNING id::text, name/)
    assert.deepEqual(queries[0].values, ['Fresh Food', 'fresh food'])

    await assert.rejects(createCategory(fakeTransaction([[]]).tx, 'fresh food'), error => error.statusCode === 409)
    await assert.rejects(createCategory(fakeTransaction([[]]).tx, '  '), error => error.statusCode === 400)
  })

  test('lists item and entry counts with mapped items counted distinctly', async () => {
    const { tx, queries } = fakeTransaction([[{ id: '3', name: 'Dairy', itemCount: 2, entryCount: 5 }]])
    assert.deepEqual(await managedCategories(tx), [
      { id: '3', name: 'Dairy', itemCount: 2, entryCount: 5 }
    ])
    assert.match(queries[0].sql, /count\(DISTINCT mappings\.item\)::int AS item_count/)
    assert.match(queries[0].sql, /count\(DISTINCT entries\.id\)::int AS entry_count/)
    assert.match(queries[0].sql, /LEFT JOIN grocery_entries entries ON entries\.item = mappings\.item/)
  })

  test('validates string IDs and canonicalizes leading zeroes', () => {
    assert.equal(requireCategoryId('00012'), '12')
    assert.equal(requireCategoryId('9223372036854775807'), '9223372036854775807')
    for (const id of [undefined, 1, '', '0', '-1', '1x', '9223372036854775808']) {
      assert.throws(() => requireCategoryId(id), error => error.statusCode === 400)
    }
  })

  test('renames a category with normalized display name and key', async () => {
    const { tx, queries } = fakeTransaction([[], [{ id: '4' }], [], [{ id: '4', name: 'Fresh Food' }]])
    assert.deepEqual(await renameCategory(tx, '4', '  Ｆｒｅｓｈ   Food '), { id: '4', name: 'Fresh Food' })
    assert.deepEqual(queries[3].values, ['Fresh Food', 'fresh food', '4'])
    assert.match(queries[3].sql, /UPDATE grocery_categories[\s\S]*RETURNING id::text, name/)
  })

  test('rejects invalid, missing, and duplicate normalized category names', async () => {
    const invalid = fakeTransaction()
    await assert.rejects(renameCategory(invalid.tx, '1', ' '.repeat(3)), error => error.statusCode === 400)
    assert.equal(invalid.queries.length, 0)

    const missing = fakeTransaction([[], []])
    await assert.rejects(renameCategory(missing.tx, '1', 'Other'), error => error.statusCode === 404)

    const duplicate = fakeTransaction([[], [{ id: '1' }], [{ id: '2' }]])
    await assert.rejects(renameCategory(duplicate.tx, '1', '  dAiRy  '), error => error.statusCode === 409)
    assert.deepEqual(duplicate.queries[2].values, ['dairy', '1'])
    assert.equal(duplicate.queries.length, 3)
  })

  test('merges all source mappings into the target and deletes the source', async () => {
    const { tx, queries } = fakeTransaction([
      [], [{ id: '2' }, { id: '5' }], [{ item: 'Milk' }, { item: 'Cheese' }], []
    ])
    assert.deepEqual(await mergeCategories(tx, '2', '5'), { sourceId: '2', targetId: '5', movedItems: 2 })
    assert.match(queries[2].sql, /UPDATE grocery_item_categories SET category_id = \?/)
    assert.deepEqual(queries[2].values, ['5', '2'])
    assert.match(queries[3].sql, /DELETE FROM grocery_categories WHERE id = \?/)
    assert.deepEqual(queries[3].values, ['2'])
  })

  test('rejects same or missing merge IDs', async () => {
    const same = fakeTransaction()
    await assert.rejects(mergeCategories(same.tx, '2', '2'), error => error.statusCode === 400)
    assert.equal(same.queries.length, 0)

    const missing = fakeTransaction([[], [{ id: '2' }]])
    await assert.rejects(mergeCategories(missing.tx, '2', '5'), error => error.statusCode === 404)
    assert.equal(missing.queries.length, 2)
  })

  test('deletes mappings before removing the category', async () => {
    const { tx, queries } = fakeTransaction([[], [{ id: '9' }], [{ item: 'Milk' }, { item: 'Yogurt' }], []])
    assert.deepEqual(await deleteCategory(tx, '9'), { id: '9', deleted: true, clearedItems: 2 })
    assert.match(queries[2].sql, /DELETE FROM grocery_item_categories WHERE category_id = \?/)
    assert.deepEqual(queries[2].values, ['9'])
    assert.match(queries[3].sql, /DELETE FROM grocery_categories WHERE id = \?/)
    assert.deepEqual(queries[3].values, ['9'])
  })

  test('reports a missing category on delete', async () => {
    const { tx, queries } = fakeTransaction([[], []])
    await assert.rejects(deleteCategory(tx, '9'), error => error.statusCode === 404)
    assert.equal(queries.length, 2)
  })
})
