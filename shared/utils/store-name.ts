const apostrophes = /[\u2018\u2019\u02bc]/g

export function normalizeStoreName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(apostrophes, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function storeNameKey(value: unknown) {
  return normalizeStoreName(value).toLowerCase()
}
