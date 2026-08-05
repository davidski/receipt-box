export function itemSlugBase(value: string) {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[’']/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'item'
}

function itemHash(value: string) {
  let hash = 2166136261
  for (const character of value.trim().toLowerCase()) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function itemSlug(value: string) {
  return `${itemSlugBase(value)}-${itemHash(value)}`
}
