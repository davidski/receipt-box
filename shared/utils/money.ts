const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

type MoneyOptions = { whole?: boolean }

// Prices and receipt totals show cents; aggregates across many purchases pass { whole: true }.
// See docs/design-system.md (Typography).
export function formatCurrency(value: string | number, { whole = false }: MoneyOptions = {}): string {
  return (whole ? dollars : cents).format(Number(value))
}

// A signed change uses a true minus sign and an explicit plus, so direction never relies on color.
// An amount that rounds to zero carries no sign.
export function formatSignedCurrency(value: number | null, options: MoneyOptions = {}): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return signed(value, formatCurrency(Math.abs(value), options))
}

// A signed percent change, such as "+12%" or "−6.5%". Highlights shows one decimal; history shows none.
export function formatSignedPercent(value: number | null, { digits = 0 }: { digits?: number } = {}): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const magnitude = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Math.abs(value))
  return signed(value, `${magnitude}%`)
}

function signed(value: number, magnitude: string): string {
  if (!/[1-9]/.test(magnitude)) return magnitude
  return `${value > 0 ? '+' : '−'}${magnitude}`
}

// Splits a formatted amount so the cents can be set smaller than the dollars.
export function splitCurrency(value: string | number): { whole: string, cents: string } {
  const formatted = formatCurrency(value)
  const point = formatted.lastIndexOf('.')
  return { whole: formatted.slice(0, point), cents: formatted.slice(point) }
}
