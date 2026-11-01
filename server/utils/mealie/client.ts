export interface MealieConfig {
  url: string
  token: string
}

export type MealieRecord = Record<string, unknown>
export type MealieErrorKind = 'disabled' | 'timeout' | 'network' | 'http' | 'malformed'

const requestTimeoutMs = 10_000
const pageSize = 200

// Messages name only the Mealie path. Upstream errors and bodies are dropped because they can echo the token.
export class MealieError extends Error {
  readonly kind: MealieErrorKind
  readonly status?: number

  constructor(kind: MealieErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'MealieError'
    this.kind = kind
    this.status = status
  }
}

export function getMealieConfig(environment: NodeJS.ProcessEnv = process.env): MealieConfig | null {
  const url = environment.MEALIE_URL?.trim().replace(/\/+$/, '')
  const token = environment.MEALIE_API_TOKEN?.trim()
  return url && token ? { url, token } : null
}

export function isMealieConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return getMealieConfig(environment) !== null
}

function isRecord(value: unknown): value is MealieRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

async function mealieGet(path: string): Promise<MealieRecord> {
  const config = getMealieConfig()
  if (!config) throw new MealieError('disabled', 'Mealie is not configured')

  const label = `Mealie GET ${path.split('?', 1)[0]}`
  let response: Response
  try {
    response = await fetch(`${config.url}${path}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(requestTimeoutMs)
    })
  } catch (error) {
    throw requestError(error, label)
  }
  if (!response.ok) throw new MealieError('http', `${label} returned ${response.status}`, response.status)

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new MealieError('malformed', `${label} did not return JSON`)
    throw requestError(error, label)
  }
  if (!isRecord(body)) throw new MealieError('malformed', `${label} did not return a JSON object`)
  return body
}

function requestError(error: unknown, label: string): MealieError {
  return error instanceof Error && error.name === 'TimeoutError'
    ? new MealieError('timeout', `${label} timed out`)
    : new MealieError('network', `${label} failed`)
}

async function mealieGetAll(path: string): Promise<MealieRecord[]> {
  const items: MealieRecord[] = []
  let page = 1
  let totalPages: unknown
  let total: unknown
  do {
    const body = await mealieGet(`${path}?page=${page}&perPage=${pageSize}`)
    totalPages = body.total_pages ?? body.totalPages
    total = body.total
    if (!isCount(totalPages) || !isCount(total) || !Array.isArray(body.items) || !body.items.every(isRecord)) {
      throw new MealieError('malformed', `Mealie GET ${path} returned a malformed page`)
    }
    if (page < totalPages && body.items.length === 0) {
      throw new MealieError('malformed', `Mealie GET ${path} returned an empty page before the last`)
    }
    items.push(...body.items)
    page += 1
  } while (page <= totalPages)

  // Callers treat this list as a full snapshot, so a short or repeated listing must fail rather than pass as complete.
  if (items.length !== total) {
    throw new MealieError('malformed', `Mealie GET ${path} returned ${items.length} of ${total} items`)
  }
  return items
}

export const fetchMealieFoods = () => mealieGetAll('/api/foods')
export const fetchMealieUnits = () => mealieGetAll('/api/units')
export const fetchMealieRecipes = () => mealieGetAll('/api/recipes')
export const fetchMealieRecipe = (slug: string) => mealieGet(`/api/recipes/${encodeURIComponent(slug)}`)

/** The recipe's page in Mealie, whose path needs the token user's group; null if that lookup fails, since the link is optional. */
export async function mealieRecipeUrl(slug: string): Promise<string | null> {
  try {
    const { groupSlug } = await mealieGet('/api/users/self')
    if (typeof groupSlug !== 'string' || !groupSlug) return null
    return `${getMealieConfig()!.url}/g/${encodeURIComponent(groupSlug)}/r/${encodeURIComponent(slug)}`
  } catch {
    return null
  }
}
