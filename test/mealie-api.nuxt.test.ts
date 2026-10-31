import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  body: undefined as unknown,
  sync: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
  migrate: vi.fn()
}))
const db = vi.hoisted(() => () => 'sql')

vi.mock('../server/utils/db', () => ({ db, migrate: mock.migrate }))

vi.mock('../server/utils/mealie/sync', () => {
  class MealieGuardError extends Error {}
  return { MealieGuardError, syncMealieCatalog: mock.sync, getMealieStatus: mock.status, startMealieSync: mock.start }
})

vi.mock('h3', async importOriginal => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: async () => mock.body
}))

vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

const { MealieError } = await import('../server/utils/mealie/client')
const { MealieGuardError } = await import('../server/utils/mealie/sync')
const { default: status } = await import('../server/api/mealie/status.get')
const { default: sync } = await import('../server/api/mealie/sync.post')
const { default: migrations } = await import('../server/plugins/migrations')

const run = (handler: any) => handler({ node: { res: {} } }) as Promise<any>

beforeEach(() => {
  vi.clearAllMocks()
  mock.body = undefined
  mock.migrate.mockResolvedValue(undefined)
})

describe('Mealie API', () => {
  it('returns the status', async () => {
    mock.status.mockResolvedValue({ configured: false })
    await expect(run(status)).resolves.toEqual({ configured: false })
    expect(mock.status).toHaveBeenCalledWith(db)
  })

  it('syncs without force by default and only honours force: true', async () => {
    mock.sync.mockResolvedValue({ status: 'skipped' })
    await expect(run(sync)).resolves.toEqual({ status: 'skipped' })
    expect(mock.sync).toHaveBeenLastCalledWith(db, { force: false })

    mock.body = { force: 'yes' }
    await run(sync)
    expect(mock.sync).toHaveBeenLastCalledWith(db, { force: false })

    mock.body = { force: true }
    await run(sync)
    expect(mock.sync).toHaveBeenLastCalledWith(db, { force: true })
  })

  it.each([
    ['disabled', () => mock.sync.mockResolvedValue({ status: 'disabled' }), 409, 'Mealie is not configured'],
    ['guard', () => mock.sync.mockRejectedValue(new MealieGuardError('refused')), 409, 'refused'],
    ['upstream failure', () => mock.sync.mockRejectedValue(new MealieError('http', 'Mealie GET /api/foods returned 500', 500)), 502, 'Mealie GET /api/foods returned 500']
  ])('maps %s to an HTTP error', async (_, arrange, statusCode, statusMessage) => {
    arrange()
    await expect(run(sync)).rejects.toMatchObject({ statusCode, statusMessage })
  })

  it('marks only the deactivation guard as forceable', async () => {
    mock.sync.mockRejectedValue(new MealieGuardError('refused'))
    await expect(run(sync)).rejects.toMatchObject({ data: { forceable: true } })
    mock.sync.mockResolvedValue({ status: 'disabled' })
    const disabled = await run(sync).catch(error => error)
    expect(disabled.statusCode).toBe(409)
    expect(disabled.data).toBeUndefined()
  })

  it('does not relabel unexpected failures', async () => {
    const failure = new Error('database down')
    mock.sync.mockRejectedValue(failure)
    await expect(run(sync)).rejects.toBe(failure)
  })
})

describe('startup', () => {
  it('starts the sync after migrating and does not wait for it', async () => {
    mock.start.mockReturnValue(new Promise(() => {}))
    await (migrations as any)()
    expect(mock.migrate.mock.invocationCallOrder[0]).toBeLessThan(mock.start.mock.invocationCallOrder[0]!)
    expect(mock.start).toHaveBeenCalledWith(db)
  })

  it('does not start a sync when migration fails', async () => {
    mock.migrate.mockRejectedValue(new Error('migration failed'))
    await expect((migrations as any)()).rejects.toThrow('migration failed')
    expect(mock.start).not.toHaveBeenCalled()
  })
})
