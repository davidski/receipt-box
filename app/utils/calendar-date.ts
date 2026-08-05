export function parseCalendarDate(value: unknown): Date | null {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  return Number.isFinite(date.getTime()) ? date : null
}
