export function parseCalendarDate(value: unknown): Date | null {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day, 12)
  return Number.isFinite(date.getTime())
    && date.getFullYear() === year
    && date.getMonth() === month
    && date.getDate() === day
    ? date
    : null
}
