export const entryExportHeaders = [
  'purchase_date', 'item', 'store', 'package_size', 'package_unit', 'price',
  'normalized_price', 'normalized_basis', 'on_sale', 'non_grocery', 'notes'
]

export function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function entryCsv(rows: unknown[][]) {
  const lines = [entryExportHeaders, ...rows]
  return `\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}`
}
