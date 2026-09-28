import { requireSplitId, runReceiptSplitUndo } from '../../../utils/receipt-split'

export default defineEventHandler(async (event) => {
  const sourceId = requireSplitId(getRouterParam(event, 'id'), 'receipt id')
  const body = await readBody<{
    targetReceiptId?: unknown
    entryIds?: unknown
    targetWasCreated?: unknown
    sourcePurchasedOn?: unknown
    sourceLocation?: unknown
    targetPurchasedOn?: unknown
    targetLocation?: unknown
  }>(event)
  if (!Array.isArray(body.entryIds) || !body.entryIds.length || body.entryIds.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'The split can no longer be undone' })
  }
  if (typeof body.targetWasCreated !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Invalid split undo state' })
  const value = (input: unknown) => typeof input === 'string' ? input : ''
  return runReceiptSplitUndo({
    sourceId,
    targetReceiptId: requireSplitId(body.targetReceiptId, 'destination receipt id'),
    entryIds: body.entryIds.map(id => requireSplitId(id, 'receipt line id')),
    targetWasCreated: body.targetWasCreated,
    sourcePurchasedOn: value(body.sourcePurchasedOn),
    sourceLocation: value(body.sourceLocation),
    targetPurchasedOn: value(body.targetPurchasedOn),
    targetLocation: value(body.targetLocation)
  })
})
