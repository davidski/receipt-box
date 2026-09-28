import { requireSplitId, runReceiptSplit } from '../../../utils/receipt-split'

export default defineEventHandler(async (event) => {
  const sourceId = requireSplitId(getRouterParam(event, 'id'), 'receipt id')
  const body = await readBody<{
    entryIds?: unknown
    purchasedOn?: unknown
    location?: unknown
    targetReceiptId?: unknown
  }>(event)
  if (!Array.isArray(body.entryIds) || body.entryIds.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'Select between one and 200 receipt lines' })
  }
  const entryIds = body.entryIds.map(id => requireSplitId(id, 'receipt line id'))
  const targetReceiptId = body.targetReceiptId === undefined ? undefined : requireSplitId(body.targetReceiptId, 'destination receipt id')
  return runReceiptSplit({
    sourceId,
    entryIds,
    purchasedOn: String(body.purchasedOn ?? ''),
    location: String(body.location ?? ''),
    targetReceiptId
  })
})
