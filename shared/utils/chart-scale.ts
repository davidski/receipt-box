export type PrettyScale = { min: number, max: number, step: number, breaks: number[] }

// Rounded axis breaks in the spirit of R's pretty() and scales::breaks_pretty(): steps of 1, 2 or 5 times a power of ten.
export function prettyScale(rawMin: number, rawMax: number, { target = 4, minStep = 0 }: { target?: number, minStep?: number } = {}): PrettyScale {
  if (rawMax <= rawMin) {
    // A flat series gets room around its value, like ggplot2's default scale expansion.
    const pad = Math.max(Math.abs(rawMax) * 0.1, 0.05)
    rawMin -= pad
    rawMax += pad
  }
  const rough = Math.max((rawMax - rawMin) / target, minStep)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const min = Math.floor(rawMin / step) * step
  const max = Math.ceil(rawMax / step) * step
  // Round away floating-point noise such as 0.30000000000000004.
  const clean = (value: number) => Number(value.toFixed(10))
  const count = Math.round((max - min) / step)
  const breaks = Array.from({ length: count + 1 }, (_, index) => clean(max - step * index))
  return { min: clean(min), max: clean(max), step: clean(step), breaks }
}
