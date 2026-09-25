export function normalizeCategory(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new TypeError('Category must be a string or null')
  const category = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!category) throw new TypeError('Category is required')
  if ([...category].length > 100) throw new TypeError('Category must be 100 characters or fewer')
  return category
}

export function categoryKey(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}
