const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

type MoneyOptions = { whole?: boolean }

// Prices and receipt totals show cents; aggregates across many purchases pass { whole: true }.
// See docs/design-system.md (Typography).
export function formatCurrency(value: string | number, { whole = false }: MoneyOptions = {}): string {
  return (whole ? dollars : cents).format(Number(value))
}

// A signed change uses a true minus sign and an explicit plus, so direction never relies on color.
export function formatSignedCurrency(value: number | null, options: MoneyOptions = {}): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(value), options)}`
}

// Splits a formatted amount so the cents can be set smaller than the dollars.
export function splitCurrency(value: string | number): { whole: string, cents: string } {
  const formatted = formatCurrency(value)
  const point = formatted.lastIndexOf('.')
  return { whole: formatted.slice(0, point), cents: formatted.slice(point) }
}
