import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import { MealieError } from '../server/utils/mealie/client.ts'
import { MealieGuardError, getMealieStatus, maxDeactivatedFoodShare, startMealieSync, syncMealieCatalog } from '../server/utils/mealie/sync.ts'

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const food = (index, extra = {}) => ({ id: uuid(index), name: `Food ${index}`, aliases: [], ...extra })
const unit = (index, extra = {}) => ({ id: uuid(index), name: `Unit ${index}`, ...extra })
const foods = count => Array.from({ length: count }, (_, index) => food(index))
const listing = items => new Response(JSON.stringify({ total: items.length, total_pages: 1, items }))

// In-memory stand-in for the catalog tables; the SQL itself is exercised only against real Postgres during verification.
function fakeDatabase() {
  const state = { foods: new Map(), aliases: new Set(), units: new Map() }
  const database = { state, writes: 0, locked: false, beginCalls: 0, failOn: null }
  let clock = 0
  let now = 0
  const upsert = (table, rows) => {
    for (const row of rows) table.set(row.id, { ...row, active: true, lastSeen: now })
    database.writes += 1
  }
  const deactivate = (table) => {
    const unseen = [...table.values()].filter(row => row.active && row.lastSeen !== now)
    for (const row of unseen) row.active = false
    database.writes += 1
    return Object.assign([], { count: unseen.length })
  }
  const tx = (strings, ...values) => {
    const query = strings.join('?')
    if (database.failOn && query.includes(database.failOn)) return Promise.reject(new Error('database detail'))
    if (query.includes('pg_try_advisory_xact_lock')) {
      const acquired = !database.locked
      if (acquired) database.locked = true
      return Promise.resolve([{ acquired }])
    }
    if (query.includes('SELECT id::text FROM mealie_foods')) {
      return Promise.resolve([...state.foods.values()].filter(row => row.active).map(({ id }) => ({ id })))
    }
    if (query.includes('INSERT INTO mealie_foods')) return Promise.resolve(upsert(state.foods, values[0]))
    if (query.includes('DELETE FROM mealie_food_aliases')) {
      for (const entry of [...state.aliases]) {
        if (state.foods.get(entry.split('|')[0]).lastSeen === now) state.aliases.delete(entry)
      }
      database.writes += 1
      return Promise.resolve([])
    }
    if (query.includes('INSERT INTO mealie_food_aliases')) {
      for (const { food_id, alias } of values[0]) state.aliases.add(`${food_id}|${alias}`)
      database.writes += 1
      return Promise.resolve([])
    }
    if (query.includes('INSERT INTO mealie_units')) return Promise.resolve(upsert(state.units, values[0]))
    if (query.includes('UPDATE mealie_foods')) return Promise.resolve(deactivate(state.foods))
    if (query.includes('UPDATE mealie_units')) return Promise.resolve(deactivate(state.units))
    throw new Error(`Unexpected query: ${query}`)
  }
  tx.json = value => value
  const sql = (strings) => {
    assert.match(strings.join('?'), /last_synced_at/)
    const rows = table => [...table.values()]
    return Promise.resolve([{
      lastSyncedAt: clock ? new Date(clock) : null,
      activeFoods: rows(state.foods).filter(row => row.active).length,
      inactiveFoods: rows(state.foods).filter(row => !row.active).length,
      aliases: state.aliases.size,
      activeUnits: rows(state.units).filter(row => row.active).length,
      inactiveUnits: rows(state.units).filter(row => !row.active).length
    }])
  }
  sql.begin = async (callback) => {
    database.beginCalls += 1
    const saved = structuredClone(state)
    const heldLock = database.locked
    now = ++clock
    try {
      return await callback(tx)
    } catch (error) {
      Object.assign(state, saved)
      throw error
    } finally {
      database.locked = heldLock
    }
  }
  database.sql = sql
  database.getSql = () => sql
  return database
}

function stubMealie(respond) {
  const calls = []
  mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname
    calls.push(path)
    return respond(path)
  })
  return calls
}

const serve = (foodItems, unitItems = []) => stubMealie(path => listing(path === '/api/foods' ? foodItems : unitItems))

describe('Mealie catalog sync', () => {
  let database
  let logged

  beforeEach(() => {
    process.env.MEALIE_URL = 'https://mealie.example.com'
    process.env.MEALIE_API_TOKEN = 'secret-test-token'
    database = fakeDatabase()
    logged = mock.method(console, 'error', () => {})
  })

  afterEach(() => {
    delete process.env.MEALIE_URL
    delete process.env.MEALIE_API_TOKEN
    mock.restoreAll()
  })

  const sync = options => syncMealieCatalog(database.getSql, options)
  const syncWith = async (foodItems, unitItems, options) => {
    mock.restoreAll()
    logged = mock.method(console, 'error', () => {})
    serve(foodItems, unitItems)
    return sync(options)
  }
  const assertLeftIntact = async (expectedFoods) => {
    assert.deepEqual([...database.state.foods.values()], expectedFoods)
  }

  test('caches a new food with its fields and aliases', async () => {
    const result = await syncWith([food(1, {
      name: 'Chickpeas',
      pluralName: 'Chickpeas plural',
      description: 'Legume',
      extras: { source: 'x' },
      aliases: [{ name: 'Garbanzo' }, { name: 'Garbanzo' }, { name: '' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z'
    })], [unit(2)])

    assert.deepEqual(result, { status: 'synced', foods: 1, aliases: 1, units: 1, deactivatedFoods: 0, deactivatedUnits: 0 })
    const { active, lastSeen, ...stored } = database.state.foods.get(uuid(1))
    assert.equal(active, true)
    assert.ok(lastSeen)
    assert.deepEqual(stored, {
      id: uuid(1),
      name: 'Chickpeas',
      plural_name: 'Chickpeas plural',
      description: 'Legume',
      extras: { source: 'x' },
      mealie_created_at: '2026-01-01T00:00:00Z',
      mealie_updated_at: '2026-01-02T00:00:00Z'
    })
    assert.deepEqual([...database.state.aliases], [`${uuid(1)}|Garbanzo`])
  })

  test('renaming a food updates the same row', async () => {
    await syncWith([food(1)], [])
    await syncWith([food(1, { name: 'Renamed' })], [])
    assert.equal(database.state.foods.size, 1)
    assert.equal(database.state.foods.get(uuid(1)).name, 'Renamed')
  })

  test('replaces aliases when one is added and another removed, and for a food left with none', async () => {
    await syncWith([food(1, { aliases: [{ name: 'Old' }] }), food(2, { aliases: [{ name: 'Gone' }] })], [])
    await syncWith([food(1, { aliases: [{ name: 'New' }] }), food(2, { aliases: undefined })], [])
    assert.deepEqual([...database.state.aliases], [`${uuid(1)}|New`])
  })

  test('marks a disappeared food inactive without deleting it or its aliases, and revives it when it reappears', async () => {
    const all = [...foods(10)]
    all[0] = food(0, { aliases: [{ name: 'Kept' }] })
    await syncWith(all, [])

    const result = await syncWith(all.slice(1), [])
    assert.equal(result.deactivatedFoods, 1)
    assert.equal(database.state.foods.get(uuid(0)).active, false)
    assert.ok(database.state.aliases.has(`${uuid(0)}|Kept`))

    const again = await syncWith(all, [])
    assert.equal(again.deactivatedFoods, 0)
    assert.equal(database.state.foods.get(uuid(0)).active, true)
  })

  test('updates a changed unit definition and deactivates a missing unit', async () => {
    await syncWith([], [
      unit(1, { abbreviation: 'T', pluralAbbreviation: 'Ts', standardQuantity: 0.5, standardUnit: 'fluid_ounce' }),
      unit(2)
    ])
    const result = await syncWith([], [unit(1, { standardQuantity: 15, standardUnit: 'milliliter' })])

    const updated = database.state.units.get(uuid(1))
    assert.equal(updated.standard_quantity, 15)
    assert.equal(updated.standard_unit, 'milliliter')
    assert.equal(updated.abbreviation, null)
    assert.equal(result.deactivatedUnits, 1)
    assert.equal(database.state.units.get(uuid(2)).active, false)
  })

  describe('failed or incomplete responses leave the cache intact', () => {
    const fails = {
      'an HTTP error on units': path => path === '/api/units' ? new Response('', { status: 500 }) : listing(foods(2)),
      'a truncated listing': path => path === '/api/foods'
        ? new Response(JSON.stringify({ total: 3, total_pages: 1, items: foods(2) }))
        : listing([]),
      'a repeated food': path => listing(path === '/api/foods' ? [food(1), food(1)] : []),
      'a food without a name': path => listing(path === '/api/foods' ? [food(1, { name: null })] : []),
      'an empty food name': path => listing(path === '/api/foods' ? [food(1, { name: '' })] : []),
      'a food with an invalid id': path => listing(path === '/api/foods' ? [food(1, { id: 'not-a-uuid' })] : []),
      'aliases that are not a list': path => listing(path === '/api/foods' ? [food(1, { aliases: 'x' })] : []),
      'an alias without a name': path => listing(path === '/api/foods' ? [food(1, { aliases: [{}] })] : []),
      'a null alias': path => listing(path === '/api/foods' ? [food(1, { aliases: [null] })] : []),
      'a unit with an invalid id': path => listing(path === '/api/foods' ? foods(2) : [unit(1, { id: 7 })])
    }
    for (const [name, respond] of Object.entries(fails)) {
      test(name, async () => {
        await syncWith(foods(2), [])
        const before = structuredClone([...database.state.foods.values()])
        const writes = database.writes
        mock.restoreAll()
        logged = mock.method(console, 'error', () => {})
        stubMealie(respond)

        await assert.rejects(sync(), MealieError)

        assert.equal(database.writes, writes)
        await assertLeftIntact(before)
        const status = await getMealieStatus(database.getSql)
        assert.match(status.lastError, /^Mealie /)
        assert.ok(!status.lastError.includes('secret-test-token'))
      })
    }
  })

  test('rolls back when a write fails and reports a generic error without the database detail', async () => {
    await syncWith([food(1, { aliases: [{ name: 'Old' }] })], [])
    const before = structuredClone([...database.state.foods.values()])
    mock.restoreAll()
    logged = mock.method(console, 'error', () => {})
    serve([food(1, { name: 'Renamed' })])
    database.failOn = 'INSERT INTO mealie_food_aliases'

    await assert.rejects(sync(), /database detail/)

    await assertLeftIntact(before)
    assert.deepEqual([...database.state.aliases], [`${uuid(1)}|Old`])
    assert.equal((await getMealieStatus(database.getSql)).lastError, 'Mealie sync failed')
    assert.match(logged.mock.calls[0].arguments[0], /database detail/)
  })

  test('a concurrent sync is skipped without calling Mealie or writing', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let reachedMealie
    const reached = new Promise((resolve) => { reachedMealie = resolve })
    const calls = stubMealie(async (path) => {
      reachedMealie()
      await gate
      return listing(path === '/api/foods' ? [food(1)] : [])
    })

    const first = sync()
    await reached
    const fetchesSoFar = calls.length
    assert.deepEqual(await sync(), { status: 'skipped' })
    assert.equal(calls.length, fetchesSoFar)
    assert.equal(database.writes, 0)

    release()
    assert.equal((await first).status, 'synced')
    assert.equal(database.state.foods.size, 1)
    assert.equal((await sync()).status, 'synced')
  })

  describe('deactivation guard', () => {
    const catalog = foods(706)

    test('the threshold allows 70 of the real 706-food catalog to disappear', async () => {
      assert.equal(maxDeactivatedFoodShare, 0.1)
      await syncWith(catalog, [])
      const result = await syncWith(catalog.slice(70), [])
      assert.equal(result.deactivatedFoods, 70)
    })

    test('one more than the threshold trips and changes nothing', async () => {
      await syncWith(catalog, [])
      await assert.rejects(syncWith(catalog.slice(71), [{ ...unit(1) }]), (error) => {
        assert.ok(error instanceof MealieGuardError)
        assert.match(error.message, /71 of 706/)
        return true
      })
      assert.equal([...database.state.foods.values()].filter(row => row.active).length, 706)
      assert.equal(database.state.units.size, 0)
      assert.match((await getMealieStatus(database.getSql)).lastError, /71 of 706/)
    })

    test('trips on a listing narrowed to one page, or emptied', async () => {
      await syncWith(catalog, [])
      await assert.rejects(syncWith(catalog.slice(0, 200), []), MealieGuardError)
      await assert.rejects(syncWith([], []), MealieGuardError)
      assert.equal([...database.state.foods.values()].filter(row => row.active).length, 706)
    })

    test('force overrides the guard, and already inactive foods do not count', async () => {
      await syncWith(catalog, [])
      const forced = await syncWith(catalog.slice(0, 200), [], { force: true })
      assert.equal(forced.deactivatedFoods, 506)

      // 20 of the 200 still active is exactly 10%, regardless of the 506 inactive rows.
      const next = await syncWith(catalog.slice(0, 180), [])
      assert.equal(next.deactivatedFoods, 20)
    })

    test('the first sync of an empty cache is not guarded', async () => {
      assert.equal((await syncWith(catalog, [])).foods, 706)
    })
  })

  test('status reports counts and clears the last error after a success', async () => {
    assert.equal((await getMealieStatus(database.getSql)).lastSyncedAt, null)
    await syncWith([...foods(10).slice(0, 9), food(9, { aliases: [{ name: 'A' }] })], [unit(1), unit(2)])
    await syncWith(foods(9), [unit(1)])
    mock.restoreAll()
    logged = mock.method(console, 'error', () => {})
    stubMealie(() => new Response('', { status: 503 }))
    await assert.rejects(sync(), MealieError)
    assert.match((await getMealieStatus(database.getSql)).lastError, /returned 503/)

    await syncWith(foods(9), [unit(1)])
    const status = await getMealieStatus(database.getSql)
    assert.equal(status.configured, true)
    assert.equal(status.lastError, null)
    assert.ok(status.lastSyncedAt instanceof Date)
    assert.deepEqual(status.counts, { activeFoods: 9, inactiveFoods: 1, aliases: 1, activeUnits: 1, inactiveUnits: 1 })
  })

  test('startup sync swallows and logs a failure', async () => {
    stubMealie(() => new Response('', { status: 500 }))
    assert.equal(await startMealieSync(database.getSql), undefined)
    assert.equal(logged.mock.callCount(), 1)
    assert.ok(!logged.mock.calls[0].arguments[0].includes('secret-test-token'))
  })

  test('startup sync syncs when configured', async () => {
    serve([food(1)])
    assert.equal((await startMealieSync(database.getSql)).status, 'synced')
    assert.equal(database.state.foods.size, 1)
  })

  test('logs a non-Error rejection as unknown', async () => {
    database.sql.begin = () => Promise.reject('boom')
    await assert.rejects(sync())
    assert.equal(logged.mock.calls[0].arguments[0], 'Mealie sync failed: unknown error')
  })

  for (const [name, unset] of [['MEALIE_URL', 'MEALIE_URL'], ['MEALIE_API_TOKEN', 'MEALIE_API_TOKEN']]) {
    test(`disabled without ${name}: no database, no Mealie`, async () => {
      delete process.env[unset]
      const calls = serve([food(1)])
      const getSql = () => assert.fail('must not open a database connection')

      assert.deepEqual(await syncMealieCatalog(getSql), { status: 'disabled' })
      assert.deepEqual(await startMealieSync(getSql), { status: 'disabled' })
      assert.deepEqual(await getMealieStatus(getSql), { configured: false, lastSyncedAt: null, lastError: null, counts: null })
      assert.deepEqual(calls, [])
    })
  }
})
