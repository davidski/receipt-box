export function cleanHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_|_$/g, '')
}

function unwrapCell(value: unknown) {
  if (value && typeof value === 'object' && 'result' in value) return (value as { result: unknown }).result
  return value
}

export function canonicalRecord(record: Record<string, unknown>) {
  const aliases: Record<string, string> = {
    food_date: 'food_Date', date: 'food_Date', purchase_date: 'food_Date', item: 'Item', location: 'Location', store: 'Location',
    size: 'Size', package_size: 'Size', unit: 'Unit', package_unit: 'Unit', price: 'Price', cost_per_unit: 'Cost_Per_Unit',
    sale_item: 'Sale_Item', sale: 'Sale_Item', on_sale: 'Sale_Item', non_grocery: 'Non_Grocery', notes: 'Notes', category: 'category'
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    const header = cleanHeader(key)
    const cell = unwrapCell(value)
    const canonicalKey = aliases[header] ?? key
    return [canonicalKey, header === 'category' && (cell === null || cell === undefined || String(cell).trim() === '') ? null : cell]
  }))
}
