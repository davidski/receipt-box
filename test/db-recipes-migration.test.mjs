import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const db = await readFile(new URL('../server/utils/db.ts', import.meta.url), 'utf8')

test('recipes migration declares the table and a unique lower(name) index with IF NOT EXISTS guards', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS grocery_recipes \(\s+id BIGSERIAL PRIMARY KEY,\s+name TEXT NOT NULL,\s+lines JSONB NOT NULL,\s+saved_total NUMERIC\(10, 2\),\s+saved_at TIMESTAMPTZ NOT NULL DEFAULT now\(\),\s+created_by TEXT,/)
  assert.match(db, /CREATE UNIQUE INDEX IF NOT EXISTS grocery_recipes_name_idx ON grocery_recipes \(lower\(name\)\)/)
})
