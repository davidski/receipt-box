import postgres from 'postgres'
import { normalizeUnit } from '../../shared/utils/units'
import { normalizeStoreName, storeNameKey } from '../../shared/utils/store-name'
import { mergeDuplicateReceipts } from './receipt-query'
import { seedInitialCategories } from './category-query'

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
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('receipt-box:migrate'))`
    await tx`
      CREATE TABLE IF NOT EXISTS grocery_entries (
        id BIGSERIAL PRIMARY KEY,
        purchased_on DATE NOT NULL,
        item TEXT NOT NULL CHECK (length(trim(item)) > 0),
        location TEXT NOT NULL CHECK (length(trim(location)) > 0),
        size NUMERIC(12, 3),
        unit TEXT,
        price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
        cost_per_unit NUMERIC(12, 4) GENERATED ALWAYS AS (
          CASE
            WHEN size IS NULL OR size <= 0 THEN NULL
            WHEN lower(unit) IN ('g', 'ml') THEN price / size * 100
            ELSE price / size
          END
        ) STORED,
        sale_item BOOLEAN NOT NULL DEFAULT FALSE,
        non_grocery BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
    await tx`CREATE INDEX IF NOT EXISTS grocery_entries_item_idx ON grocery_entries (lower(item))`
    const entryColumns = await tx<{ columnName: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'grocery_entries'
    `
    const hasEntryLocation = entryColumns.some(column => column.columnName === 'location')
    const hasEntryDate = entryColumns.some(column => column.columnName === 'purchased_on')
    if (hasEntryLocation) await tx`CREATE INDEX IF NOT EXISTS grocery_entries_location_idx ON grocery_entries (lower(location))`
    if (hasEntryDate) await tx`CREATE INDEX IF NOT EXISTS grocery_entries_date_idx ON grocery_entries (purchased_on DESC, id DESC)`
    await tx`
      CREATE TABLE IF NOT EXISTS grocery_item_merge_dismissals (
        group_id TEXT PRIMARY KEY,
        hidden_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
    await tx`
      CREATE TABLE IF NOT EXISTS grocery_categories (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
        normalized_name TEXT NOT NULL UNIQUE
      )
    `
    await tx`
      CREATE TABLE IF NOT EXISTS grocery_item_categories (
        item TEXT PRIMARY KEY,
        category_id BIGINT NOT NULL REFERENCES grocery_categories(id) ON DELETE RESTRICT
      )
    `
    await tx`CREATE TABLE IF NOT EXISTS grocery_category_seeds (seed TEXT PRIMARY KEY)`
    await seedInitialCategories(tx)
    await tx`ALTER TABLE grocery_entries DROP COLUMN IF EXISTS unit_price`
    const existingUnits = await tx<{ unit: string }[]>`
      SELECT DISTINCT unit FROM grocery_entries WHERE unit IS NOT NULL AND length(trim(unit)) > 0
    `
    for (const { unit } of existingUnits) {
      const normalized = normalizeUnit(unit)
      if (normalized && normalized !== unit) {
        await tx`UPDATE grocery_entries SET unit = ${normalized}, updated_at = now() WHERE unit = ${unit}`
      }
    }
    const [costPerUnitColumn] = await tx<{ isGenerated: string }[]>`
      SELECT is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'grocery_entries'
        AND column_name = 'cost_per_unit'
    `
    if (costPerUnitColumn?.isGenerated !== 'ALWAYS') {
      await tx`ALTER TABLE grocery_entries DROP COLUMN IF EXISTS cost_per_unit`
      await tx`
        ALTER TABLE grocery_entries
        ADD COLUMN cost_per_unit NUMERIC(12, 4) GENERATED ALWAYS AS (
          CASE
            WHEN size IS NULL OR size <= 0 THEN NULL
            WHEN lower(unit) IN ('g', 'ml') THEN price / size * 100
            ELSE price / size
          END
        ) STORED
      `
    }
    await tx`
      CREATE TABLE IF NOT EXISTS grocery_stores (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0)
      )
    `

    type StoreRow = { id: string, name: string }
    type StoreGroup = { name: string, stores: StoreRow[], locations: string[] }

    const stores = await tx<StoreRow[]>`
      SELECT id::text, name FROM grocery_stores ORDER BY id
    `
    const locations = hasEntryLocation
      ? await tx<{ location: string }[]>`SELECT DISTINCT location FROM grocery_entries ORDER BY location`
      : []
    const groups = new Map<string, StoreGroup>()

    for (const store of stores) {
      const key = storeNameKey(store.name)
      const group = groups.get(key) ?? { name: normalizeStoreName(store.name), stores: [], locations: [] }
      group.stores.push(store)
      groups.set(key, group)
    }
    for (const { location } of locations) {
      const key = storeNameKey(location)
      const group = groups.get(key) ?? { name: normalizeStoreName(location), stores: [], locations: [] }
      group.locations.push(location)
      groups.set(key, group)
    }

    for (const group of groups.values()) {
      for (const location of group.locations) {
        if (location !== group.name) {
          await tx`
            UPDATE grocery_entries
            SET location = ${group.name}, updated_at = now()
            WHERE location = ${location}
          `
        }
      }

      const [winner, ...duplicates] = group.stores
      for (const duplicate of duplicates) {
        await tx`DELETE FROM grocery_stores WHERE id = ${duplicate.id}`
      }
      if (winner) {
        if (winner.name !== group.name) {
          await tx`UPDATE grocery_stores SET name = ${group.name} WHERE id = ${winner.id}`
        }
      } else {
        await tx`INSERT INTO grocery_stores (name) VALUES (${group.name})`
      }
    }

    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS grocery_stores_name_normalized_idx ON grocery_stores (
        lower(
          regexp_replace(
            regexp_replace(trim(normalize(name, NFKC)), '[[:space:]]+', ' ', 'g'),
            '[‘’ʼ]', '''', 'g'
          )
        )
      )
    `
    await tx`DROP INDEX IF EXISTS grocery_stores_name_idx`

    await tx`
      CREATE TABLE IF NOT EXISTS grocery_receipts (
        id BIGSERIAL PRIMARY KEY,
        purchased_on DATE NOT NULL,
        location TEXT NOT NULL CHECK (length(trim(location)) > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
    await tx`CREATE INDEX IF NOT EXISTS grocery_receipts_date_idx ON grocery_receipts (purchased_on DESC, id DESC)`
    await tx`ALTER TABLE grocery_entries ADD COLUMN IF NOT EXISTS receipt_id BIGINT`

    const receiptColumns = await tx<{ columnName: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'grocery_receipts'
    `
    const hasReceiptLocation = receiptColumns.some(column => column.columnName === 'location')
    if (hasReceiptLocation) {
      const receiptLocations = await tx<{ location: string }[]>`
        SELECT DISTINCT location FROM grocery_receipts ORDER BY location
      `
      for (const receipt of receiptLocations) {
        const name = normalizeStoreName(receipt.location)
        if (name) {
          await tx`INSERT INTO grocery_stores (name) VALUES (${name}) ON CONFLICT DO NOTHING`
          if (name !== receipt.location) {
            await tx`UPDATE grocery_receipts SET location = ${name} WHERE location = ${receipt.location}`
          }
        }
      }
    }

    const unassignedReceipts = hasEntryLocation && hasReceiptLocation
      ? await tx<{
          purchasedOn: string | Date
          location: string
          createdAt: string | Date
          updatedAt: string | Date
        }[]>`
          SELECT purchased_on, location, min(created_at) AS created_at, max(updated_at) AS updated_at
          FROM grocery_entries
          WHERE receipt_id IS NULL
          GROUP BY purchased_on, location
          ORDER BY purchased_on, location
        `
      : []
    for (const receipt of unassignedReceipts) {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO grocery_receipts (purchased_on, location, created_at, updated_at)
        VALUES (${receipt.purchasedOn}, ${receipt.location}, ${receipt.createdAt}, ${receipt.updatedAt})
        RETURNING id::text
      `
      await tx`
        UPDATE grocery_entries
        SET receipt_id = ${created!.id}
        WHERE receipt_id IS NULL
          AND purchased_on = ${receipt.purchasedOn}
          AND location = ${receipt.location}
      `
    }

    if (hasEntryLocation && hasReceiptLocation) {
      await tx`
        UPDATE grocery_receipts receipts
        SET purchased_on = canonical.purchased_on,
          location = canonical.location,
          updated_at = greatest(receipts.updated_at, canonical.updated_at)
        FROM (
          SELECT DISTINCT ON (receipt_id) receipt_id, purchased_on, location, updated_at
          FROM grocery_entries
          WHERE receipt_id IS NOT NULL
          ORDER BY receipt_id, id
        ) canonical
        WHERE receipts.id = canonical.receipt_id
          AND (receipts.purchased_on, receipts.location) IS DISTINCT FROM
            (canonical.purchased_on, canonical.location)
      `
    }

    await tx`ALTER TABLE grocery_receipts ADD COLUMN IF NOT EXISTS store_id BIGINT`
    if (hasReceiptLocation) {
      await tx`
        UPDATE grocery_receipts receipts
        SET store_id = stores.id
        FROM grocery_stores stores
        WHERE lower(receipts.location) = lower(stores.name)
          AND receipts.store_id IS DISTINCT FROM stores.id
      `
    }
    const [unlinkedReceipts] = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM grocery_receipts WHERE store_id IS NULL
    `
    if (Number(unlinkedReceipts?.count ?? 0) > 0) {
      throw new Error('Could not link every receipt to a store')
    }
    await tx`
      ALTER TABLE grocery_receipts ALTER COLUMN store_id SET NOT NULL
    `

    await mergeDuplicateReceipts(tx)
    await tx`DROP INDEX IF EXISTS grocery_receipts_store_date_idx`
    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS grocery_receipts_store_date_idx
      ON grocery_receipts (purchased_on, store_id)
    `

    const [foreignKey] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'grocery_entries_receipt_id_fkey'
          AND conrelid = 'grocery_entries'::regclass
      ) AS exists
    `
    if (!foreignKey?.exists) {
      await tx`
        ALTER TABLE grocery_entries
        ADD CONSTRAINT grocery_entries_receipt_id_fkey
        FOREIGN KEY (receipt_id) REFERENCES grocery_receipts(id) ON DELETE CASCADE
      `
    }
    await tx`ALTER TABLE grocery_entries ALTER COLUMN receipt_id SET NOT NULL`
    await tx`ALTER TABLE grocery_entries DROP COLUMN IF EXISTS purchased_on`
    await tx`ALTER TABLE grocery_entries DROP COLUMN IF EXISTS location`
    await tx`DROP INDEX IF EXISTS grocery_entries_location_idx`
    await tx`DROP INDEX IF EXISTS grocery_entries_date_idx`
    await tx`ALTER TABLE grocery_receipts DROP COLUMN IF EXISTS location`
    const [storeForeignKey] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'grocery_receipts_store_id_fkey'
          AND conrelid = 'grocery_receipts'::regclass
      ) AS exists
    `
    if (!storeForeignKey?.exists) {
      await tx`
        ALTER TABLE grocery_receipts
        ADD CONSTRAINT grocery_receipts_store_id_fkey
        FOREIGN KEY (store_id) REFERENCES grocery_stores(id) ON DELETE RESTRICT
      `
    }
    await tx`CREATE INDEX IF NOT EXISTS grocery_entries_receipt_idx ON grocery_entries (receipt_id, id)`
    await tx`
      CREATE OR REPLACE VIEW grocery_receipt_details AS
      SELECT receipts.id, receipts.purchased_on, stores.name AS location,
        receipts.created_at, receipts.updated_at
      FROM grocery_receipts receipts
      INNER JOIN grocery_stores stores ON stores.id = receipts.store_id
    `
    await tx`
      CREATE OR REPLACE VIEW grocery_entry_details AS
      SELECT entries.id, entries.receipt_id, receipts.purchased_on,
        entries.item, stores.name AS location, entries.size, entries.unit,
        entries.price, entries.cost_per_unit, entries.sale_item, entries.non_grocery,
        entries.notes, entries.created_at, entries.updated_at, categories.name AS category
      FROM grocery_entries entries
      INNER JOIN grocery_receipts receipts ON receipts.id = entries.receipt_id
      INNER JOIN grocery_stores stores ON stores.id = receipts.store_id
      LEFT JOIN grocery_item_categories item_categories ON item_categories.item = entries.item
      LEFT JOIN grocery_categories categories ON categories.id = item_categories.category_id
    `
  })
}

export type GroceryEntry = {
  id: string
  receiptId: string
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
  category: string | null
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
