export type ReceiptDraftLine = {
  item: string
  price: string
  size: string
  unit: string
  saleItem: boolean
  nonGrocery: boolean
  notes: string
  category?: string | null
  categoryChanged?: boolean
}

export type ReceiptDraft = {
  purchasedOn: string
  location: string
  lines: ReceiptDraftLine[]
}

function lineHasContent(line: ReceiptDraftLine) {
  return Boolean(
    line.item.trim() || line.price !== '' || line.size !== '' || line.unit.trim()
    || line.saleItem || line.nonGrocery || line.notes.trim() || line.categoryChanged
  )
}

export function receiptDraftSnapshot(draft: ReceiptDraft) {
  return JSON.stringify({
    purchasedOn: draft.purchasedOn,
    location: draft.location,
    lines: draft.lines.filter(lineHasContent).map(line => ({
      item: line.item,
      price: line.price,
      size: line.size,
      unit: line.unit,
      saleItem: line.saleItem,
      nonGrocery: line.nonGrocery,
      notes: line.notes,
      ...(line.categoryChanged ? { category: line.category ?? null } : {})
    }))
  })
}
