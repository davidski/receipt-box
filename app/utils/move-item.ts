// Returns a copy of `array` with the item at `from` moved to `to`; out-of-range or equal indexes leave the order unchanged.
export function moveItem<T>(array: readonly T[], from: number, to: number): T[] {
  const result = [...array]
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < result.length
  if (from === to || !inRange(from) || !inRange(to)) return result
  result.splice(to, 0, ...result.splice(from, 1))
  return result
}
