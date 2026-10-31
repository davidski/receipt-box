import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const db = await readFile(new URL('../server/utils/db.ts', import.meta.url), 'utf8')

test('Mealie catalog migration declares the design tables with IF NOT EXISTS guards', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS mealie_foods \(\s+id UUID PRIMARY KEY,\s+name TEXT NOT NULL,[\s\S]+?active BOOLEAN NOT NULL DEFAULT TRUE,[\s\S]+?last_seen_at TIMESTAMPTZ NOT NULL,\s+synced_at TIMESTAMPTZ NOT NULL/)
  assert.match(db, /CREATE TABLE IF NOT EXISTS mealie_food_aliases \(\s+food_id UUID REFERENCES mealie_foods\(id\) ON DELETE CASCADE,\s+alias TEXT NOT NULL,\s+PRIMARY KEY \(food_id, alias\)/)
  assert.match(db, /CREATE TABLE IF NOT EXISTS mealie_units \(\s+id UUID PRIMARY KEY,[\s\S]+?standard_quantity NUMERIC,\s+standard_unit TEXT,[\s\S]+?synced_at TIMESTAMPTZ NOT NULL/)
})
