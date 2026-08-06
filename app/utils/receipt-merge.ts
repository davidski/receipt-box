export type ReceiptSaveSummary = {
  id: string
  purchasedOn: string
  location: string
  itemCount: number
  total: string
}

export type AutosaveReceiptLine = {
  item: string
  price: string
  size: string
  unit: string
  saleItem: boolean
  nonGrocery: boolean
  notes: string
}

function items(count: number) {
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

export function addedReceiptMessage(submittedCount: number, saved: ReceiptSaveSummary) {
  if (saved.itemCount > submittedCount) {
    return `Added ${items(submittedCount)} to the ${saved.location} receipt · ${items(saved.itemCount)} total · $${Number(saved.total).toFixed(2)}`
  }
  return `${items(submittedCount)} saved · $${Number(saved.total).toFixed(2)}`
}

export function receiptLineIsComplete(line: AutosaveReceiptLine) {
  const price = Number(line.price)
  return Boolean(line.item.trim()) && line.price !== '' && Number.isFinite(price) && price >= 0
}

export function shouldLoadMatchingReceipt(currentReceiptId: string | null, enteredLineCount: number) {
  return !currentReceiptId && enteredLineCount === 0
}

export function receiptLineSaveSnapshot(
  purchasedOn: string,
  location: string,
  line: AutosaveReceiptLine
) {
  return JSON.stringify({
    purchasedOn,
    location,
    item: line.item,
    price: line.price,
    size: line.size,
    unit: line.unit,
    saleItem: line.saleItem,
    nonGrocery: line.nonGrocery,
    notes: line.notes
  })
}
