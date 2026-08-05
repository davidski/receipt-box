import postgres from 'postgres'
import { normalizeUnit } from '../../shared/utils/units'

let client: ReturnType<typeof postgres> | undefined

export function db() {
  if (client) return client

  const config = useRuntimeConfig()
  const databaseUrl = process.env.DATABASE_URL || config.databaseUrl
  const socketPath = process.env.DATABASE_SOCKET_PATH?.trim()
  if (!databaseUrl) {
    throw createError({ statusCode: 503, statusMessage: 'DATABASE_URL is not configured' })
  }

  client = postgres(databaseUrl, {
    path: socketPath || undefined,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel
  })
  return client
}

export async function migrate() {
  const sql = db()
  await sql`
    CREATE TABLE IF NOT EXISTS grocery_entries (
      id BIGSERIAL PRIMARY KEY,
      purchased_on DATE NOT NULL,
      item TEXT NOT NULL CHECK (length(trim(item)) > 0),
      location TEXT NOT NULL CHECK (length(trim(location)) > 0),
      size NUMERIC(12, 3),
      unit TEXT,
      price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
      cost_per_unit NUMERIC(12, 4),
      sale_item BOOLEAN NOT NULL DEFAULT FALSE,
      non_grocery BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS grocery_entries_item_idx ON grocery_entries (lower(item))`
  await sql`CREATE INDEX IF NOT EXISTS grocery_entries_location_idx ON grocery_entries (lower(location))`
  await sql`CREATE INDEX IF NOT EXISTS grocery_entries_date_idx ON grocery_entries (purchased_on DESC, id DESC)`
  await sql`ALTER TABLE grocery_entries DROP COLUMN IF EXISTS unit_price`
  const existingUnits = await sql<{ unit: string }[]>`
    SELECT DISTINCT unit FROM grocery_entries WHERE unit IS NOT NULL AND length(trim(unit)) > 0
  `
  for (const { unit } of existingUnits) {
    const normalized = normalizeUnit(unit)
    if (normalized && normalized !== unit) {
      await sql`UPDATE grocery_entries SET unit = ${normalized}, updated_at = now() WHERE unit = ${unit}`
    }
  }
  await sql`
    CREATE TABLE IF NOT EXISTS grocery_stores (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0)
    )
  `
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS grocery_stores_name_idx ON grocery_stores (lower(name))`
  await sql`
    INSERT INTO grocery_stores (name)
    SELECT DISTINCT ON (lower(location)) location
    FROM grocery_entries
    WHERE length(trim(location)) > 0
    ORDER BY lower(location), location
    ON CONFLICT DO NOTHING
  `
}

export type GroceryEntry = {
  id: string
  purchasedOn: string | Date
  item: string
  location: string
  size: string | null
  unit: string | null
  price: string
  costPerUnit: string | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type PublicGroceryEntry = Omit<GroceryEntry, 'purchasedOn'> & { purchasedOn: string }

export function publicEntry(entry: GroceryEntry): PublicGroceryEntry {
  const purchasedOn = entry.purchasedOn instanceof Date
    ? entry.purchasedOn.toISOString().slice(0, 10)
    : String(entry.purchasedOn).slice(0, 10)
  return { ...entry, purchasedOn }
}
