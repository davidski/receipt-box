import type postgres from 'postgres'
import { fetchMealieFoods, fetchMealieUnits, isMealieConfigured, MealieError, type MealieRecord } from './client.ts'

type GetSql = () => postgres.Sql

export type MealieSyncResult =
  | { status: 'disabled' | 'skipped' }
  | { status: 'synced', foods: number, aliases: number, units: number, deactivatedFoods: number, deactivatedUnits: number }

// At the 706-food home catalog this allows 70 removed foods: well above routine merges, far below a narrowed listing.
export const maxDeactivatedFoodShare = 0.1

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// shortcut: kept in memory because the design defines no state table, and each boot's sync sets it again; persist it if several app instances ever run.
let lastError: string | null = null

export class MealieGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MealieGuardError'
  }
}

const textOrNull = (value: unknown) => typeof value === 'string' ? value : null

// A record that cannot be cached fails the whole snapshot, so an unexpected response cannot deactivate the rest.
function identified(records: MealieRecord[], label: string) {
  const ids = new Set<string>()
  return records.map((record) => {
    const { id, name } = record
    if (typeof id !== 'string' || !uuidPattern.test(id) || typeof name !== 'string' || !name || ids.has(id)) {
      throw new MealieError('malformed', `Mealie ${label} listing has a missing, invalid or repeated record`)
    }
    ids.add(id)
    return { record, id, name, plural_name: textOrNull(record.pluralName) }
  })
}

function foodAliases({ aliases = [] }: MealieRecord) {
  if (!Array.isArray(aliases) || !aliases.every(alias => typeof alias?.name === 'string')) {
    throw new MealieError('malformed', 'Mealie food listing has malformed aliases')
  }
  return [...new Set<string>(aliases.map(alias => alias.name).filter(Boolean))]
}

function foodRows(records: MealieRecord[]) {
  const foods = identified(records, 'food')
  return {
    foods: foods.map(({ record, id, name, plural_name }) => ({
      id,
      name,
      plural_name,
      description: textOrNull(record.description),
      extras: typeof record.extras === 'object' && record.extras !== null ? record.extras : {},
      mealie_created_at: textOrNull(record.createdAt),
      mealie_updated_at: textOrNull(record.updatedAt)
    })),
    aliases: foods.flatMap(({ record, id }) => foodAliases(record).map(alias => ({ food_id: id, alias })))
  }
}

function unitRows(records: MealieRecord[]) {
  return identified(records, 'unit').map(({ record, id, name, plural_name }) => ({
    id,
    name,
    plural_name,
    abbreviation: textOrNull(record.abbreviation),
    plural_abbreviation: textOrNull(record.pluralAbbreviation),
    standard_quantity: typeof record.standardQuantity === 'number' ? record.standardQuantity : null,
    standard_unit: textOrNull(record.standardUnit)
  }))
}

async function runSync(sql: postgres.Sql, force: boolean) {
  return await sql.begin(async (tx): Promise<MealieSyncResult> => {
    const [lock] = await tx<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('receipt-box:mealie-sync')) AS acquired
    `
    if (!lock?.acquired) return { status: 'skipped' }

    // The lock spans the fetch so an overlapping sync cannot overwrite this snapshot with an older one.
    const [foodRecords, unitRecords] = await Promise.all([fetchMealieFoods(), fetchMealieUnits()])
    const { foods, aliases } = foodRows(foodRecords)
    const units = unitRows(unitRecords)

    const seenFoods = new Set(foods.map(food => food.id.toLowerCase()))
    const activeFoods = await tx<{ id: string }[]>`SELECT id::text FROM mealie_foods WHERE active`
    const unseenFoods = activeFoods.filter(food => !seenFoods.has(food.id)).length
    if (!force && unseenFoods > activeFoods.length * maxDeactivatedFoodShare) {
      throw new MealieGuardError(`Mealie sync refused to deactivate ${unseenFoods} of ${activeFoods.length} cached foods`)
    }

    await tx`
      INSERT INTO mealie_foods (
        id, name, plural_name, description, extras, mealie_created_at, mealie_updated_at, active, last_seen_at, synced_at
      )
      SELECT id, name, plural_name, description, extras, mealie_created_at, mealie_updated_at, TRUE, now(), now()
      FROM jsonb_to_recordset(${tx.json(foods as postgres.JSONValue)}) AS food(
        id UUID, name TEXT, plural_name TEXT, description TEXT, extras JSONB,
        mealie_created_at TIMESTAMPTZ, mealie_updated_at TIMESTAMPTZ
      )
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        plural_name = excluded.plural_name,
        description = excluded.description,
        extras = excluded.extras,
        mealie_created_at = excluded.mealie_created_at,
        mealie_updated_at = excluded.mealie_updated_at,
        active = TRUE,
        last_seen_at = excluded.last_seen_at,
        synced_at = excluded.synced_at
    `
    await tx`DELETE FROM mealie_food_aliases WHERE food_id IN (SELECT id FROM mealie_foods WHERE last_seen_at = now())`
    await tx`
      INSERT INTO mealie_food_aliases (food_id, alias)
      SELECT food_id, alias
      FROM jsonb_to_recordset(${tx.json(aliases as postgres.JSONValue)}) AS food_alias(food_id UUID, alias TEXT)
    `
    await tx`
      INSERT INTO mealie_units (
        id, name, plural_name, abbreviation, plural_abbreviation, standard_quantity, standard_unit, active, last_seen_at, synced_at
      )
      SELECT id, name, plural_name, abbreviation, plural_abbreviation, standard_quantity, standard_unit, TRUE, now(), now()
      FROM jsonb_to_recordset(${tx.json(units as postgres.JSONValue)}) AS unit(
        id UUID, name TEXT, plural_name TEXT, abbreviation TEXT, plural_abbreviation TEXT,
        standard_quantity NUMERIC, standard_unit TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        plural_name = excluded.plural_name,
        abbreviation = excluded.abbreviation,
        plural_abbreviation = excluded.plural_abbreviation,
        standard_quantity = excluded.standard_quantity,
        standard_unit = excluded.standard_unit,
        active = TRUE,
        last_seen_at = excluded.last_seen_at,
        synced_at = excluded.synced_at
    `
    // now() is fixed for the transaction, so anything not stamped above was absent from this snapshot.
    const deactivatedFoods = await tx`
      UPDATE mealie_foods SET active = FALSE, synced_at = now() WHERE active AND last_seen_at <> now()
    `
    const deactivatedUnits = await tx`
      UPDATE mealie_units SET active = FALSE, synced_at = now() WHERE active AND last_seen_at <> now()
    `
    return {
      status: 'synced',
      foods: foods.length,
      aliases: aliases.length,
      units: units.length,
      deactivatedFoods: deactivatedFoods.count,
      deactivatedUnits: deactivatedUnits.count
    }
  }) as MealieSyncResult
}

export async function syncMealieCatalog(getSql: GetSql, { force = false } = {}): Promise<MealieSyncResult> {
  if (!isMealieConfigured()) return { status: 'disabled' }
  try {
    const result = await runSync(getSql(), force)
    if (result.status === 'synced') lastError = null
    return result
  } catch (error) {
    // Only these messages are known to be safe to show; anything else stays in the server log.
    lastError = error instanceof MealieError || error instanceof MealieGuardError ? error.message : 'Mealie sync failed'
    console.error(`Mealie sync failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    throw error
  }
}

// The failure is already logged and kept for status, so boot has nothing to wait for or handle.
export function startMealieSync(getSql: GetSql) {
  return syncMealieCatalog(getSql).catch(() => undefined)
}

export async function getMealieStatus(getSql: GetSql) {
  if (!isMealieConfigured()) return { configured: false, lastSyncedAt: null, lastError: null, counts: null }
  const [row] = await getSql()<{ lastSyncedAt: Date | null, activeFoods: number, inactiveFoods: number, aliases: number, activeUnits: number, inactiveUnits: number }[]>`
    SELECT
      greatest((SELECT max(synced_at) FROM mealie_foods), (SELECT max(synced_at) FROM mealie_units)) AS last_synced_at,
      (SELECT count(*)::int FROM mealie_foods WHERE active) AS active_foods,
      (SELECT count(*)::int FROM mealie_foods WHERE NOT active) AS inactive_foods,
      (SELECT count(*)::int FROM mealie_food_aliases) AS aliases,
      (SELECT count(*)::int FROM mealie_units WHERE active) AS active_units,
      (SELECT count(*)::int FROM mealie_units WHERE NOT active) AS inactive_units
  `
  const { lastSyncedAt, ...counts } = row!
  return { configured: true, lastSyncedAt, lastError, counts }
}
