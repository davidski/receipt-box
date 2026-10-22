// Escape dismisses a chart's selected-point readout from anywhere on the page, so a hover or tap selection never gets stuck open (WCAG 1.4.13).
export function useEscapeDismiss(dismiss: () => void) {
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss()
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
