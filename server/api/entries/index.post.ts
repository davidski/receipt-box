import { normalizeEntry } from '../../utils/entry-input'
import { insertEntry } from '../../utils/entry-query'

export default defineEventHandler(async (event) => {
  const input = normalizeEntry(await readBody(event))
  const entry = await insertEntry({
    ...input,
    size: input.size === null ? null : String(input.size),
    price: String(input.price),
    costPerUnit: input.costPerUnit === null ? null : String(input.costPerUnit)
  })
  setResponseStatus(event, 201)
  return entry
})
