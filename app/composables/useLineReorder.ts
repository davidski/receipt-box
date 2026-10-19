import { nextTick, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { moveItem } from '../utils/move-item'

const DRAG_THRESHOLD = 4

type Drag = { from: number, startY: number, rects: DOMRect[], gap: number, started: boolean }

// Drag-or-keyboard reordering for a list of rows. Bind `handle(index, item)` to the number badge (a button)
// and `rowStyle(index)` to each row; the array is reordered in place on drop.
export function useLineReorder<T>(source: MaybeRefOrGetter<T[]>, onReorder?: () => void) {
  const dragIndex = ref<number | null>(null)
  const targetIndex = ref(0)
  const offset = ref(0)
  let drag: Drag | null = null

  function apply(from: number, to: number) {
    const list = toValue(source)
    list.splice(0, list.length, ...moveItem(list, from, to))
    onReorder?.()
  }

  function rows(handle: HTMLElement) {
    return Array.from(handle.closest('li')?.parentElement?.children ?? [])
  }

  function onPointerdown(event: PointerEvent, index: number) {
    if (event.button !== 0) return
    const handle = event.currentTarget as HTMLElement
    const rects = rows(handle).map(row => row.getBoundingClientRect())
    const rect = rects[index]
    if (!rect || rects.length < 2) return
    const neighbour = rects[index + 1] ?? rects[index - 1]!
    handle.setPointerCapture(event.pointerId)
    drag = { from: index, startY: event.clientY, rects, gap: Math.abs(index + 1 < rects.length ? neighbour.top - rect.bottom : rect.top - neighbour.bottom), started: false }
  }

  function onPointermove(event: PointerEvent) {
    if (!drag) return
    const { from, rects } = drag
    const dy = event.clientY - drag.startY
    if (!drag.started) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return
      drag.started = true
      dragIndex.value = from
    }
    const rect = rects[from]!
    offset.value = Math.min(Math.max(dy, rects[0]!.top - rect.top), rects.at(-1)!.bottom - rect.bottom)
    const center = rect.top + rect.height / 2 + offset.value
    let target = from
    rects.forEach((other, index) => {
      const otherCenter = other.top + other.height / 2
      if (index > from && center >= otherCenter) target = Math.max(target, index)
      if (index < from && center <= otherCenter) target = Math.min(target, index)
    })
    targetIndex.value = target
  }

  function end(commit: boolean) {
    if (!drag) return
    const { from, started } = drag
    const to = targetIndex.value
    drag = null
    dragIndex.value = null
    offset.value = 0
    if (commit && started) apply(from, to)
  }

  function onKeydown(event: KeyboardEvent, index: number) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const to = index + (event.key === 'ArrowUp' ? -1 : 1)
    const list = toValue(source)
    if (to < 0 || to >= list.length) return
    const container = rows(event.currentTarget as HTMLElement)[0]?.parentElement
    apply(index, to)
    // Vue moves the keyed row's DOM node, which drops focus; put it back on the moved handle.
    nextTick(() => container?.children[to]?.querySelector<HTMLElement>('[data-reorder-handle]')?.focus())
  }

  function handle(index: number, item?: string) {
    return {
      'data-reorder-handle': '',
      'aria-label': `Reorder line ${index + 1}${item ? `, ${item}` : ''}`,
      'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
      onPointerdown: (event: PointerEvent) => onPointerdown(event, index),
      onPointermove,
      onPointerup: () => end(true),
      onPointercancel: () => end(false),
      onKeydown: (event: KeyboardEvent) => onKeydown(event, index)
    }
  }

  // Dragged row follows the pointer; rows between it and the drop target slide one row to make room.
  function rowStyle(index: number) {
    const from = dragIndex.value
    if (from === null || !drag) return undefined
    if (index === from) return { transform: `translateY(${offset.value}px)` }
    const shift = drag.rects[from]!.height + drag.gap
    const to = targetIndex.value
    if (from < to && index > from && index <= to) return { transform: `translateY(${-shift}px)` }
    if (from > to && index >= to && index < from) return { transform: `translateY(${shift}px)` }
    return undefined
  }

  return { dragIndex, handle, rowStyle }
}
