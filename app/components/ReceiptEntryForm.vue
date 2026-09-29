<script setup lang="ts">
import { maxEntryNotesLength } from '../../shared/utils/entry-notes'

import { normalizeUnit } from '../../shared/utils/units'
import { categoryKey } from '../../shared/utils/category'
import { storeNameKey } from '../../shared/utils/store-name'
import {
  receiptLineIsComplete,
  receiptLineSaveSnapshot,
  type ReceiptSaveSummary
} from '../utils/receipt-merge'
import { entryCsv } from '../utils/csv-export'

type Suggestion = {
  value: string
  category?: string | null
  size?: string | null
  unit?: string | null
  price?: string | null
  lastUsed?: string
}

type ReceiptLine = {
  id?: string
  key: number
  item: string
  price: string
  size: string
  unit: string
  saleItem: boolean
  nonGrocery: boolean
  notes: string
  category: string | null
  categoryItem: string
  categoryChanged: boolean
  expanded: boolean
  confirmingRemove: boolean
  itemMenuOpen: boolean
  pendingItemCreation: string
  itemBeforeCreation: string
  searchTerm: string
  suggestions: Suggestion[]
  request: number
  backfillKey: string
  backfillChecking: boolean
  backfillPrompted: boolean
  timer?: ReturnType<typeof setTimeout>
}

type PendingBackfill = {
  lineKey: number
  entryId: string
  item: string
  size: string
  unit: string | null
  counts: { size: number, unit: number, either: number }
}

type EditableReceipt = {
  id: string
  purchasedOn: string
  location: string
  itemCount: number
  total: string
  entries: Array<{
    id: string
    item: string
    price: string
    size: string | null
    unit: string | null
    saleItem: boolean
    nonGrocery: boolean
    notes: string | null
    category?: string | null
  }>
}

type MatchingReceipt = EditableReceipt
type SavedEntry = EditableReceipt['entries'][number] & {
  receiptId: string
  purchasedOn: string
  location: string
}

type SplitUndo = {
  sourceId: string
  targetReceiptId: string
  entryIds: string[]
  targetWasCreated: boolean
  sourcePurchasedOn: string
  sourceLocation: string
  targetPurchasedOn: string
  targetLocation: string
}

const props = defineProps<{
  initialDate?: string
  initialLocation?: string
  initialReceiptId?: string
}>()
const emit = defineEmits<{
  dirtyChange: [dirty:boolean]
}>()

const { apiUrl } = useApi()
const route = useRoute()
const router = useRouter()
const saving = ref(false)
const confirmingDelete = ref(false)
const errorMessage = ref('')
const receiptSessionMessage = ref('')
const locationSuggestions = ref<Suggestion[]>([])
const matchingReceipt = ref<MatchingReceipt | null>(null)
const checkingReceiptMatch = ref(false)
const receiptMatchFailed = ref(false)
const currentReceiptId = ref<string | null>(null)
const allowDateChange = ref(false)
const allowStoreChange = ref(false)
const lastSavedSummary = ref<ReceiptSaveSummary | null>(null)
const confirmedReceiptKey = ref<{ purchasedOn: string, location: string } | null>(null)
const pendingBackfill = ref<PendingBackfill | null>(null)
const backfillBusy = ref(false)
const backfillSizeSelected = ref(false)
const backfillUnitSelected = ref(false)
const { enabled: backfillPromptsEnabled, load: loadBackfillPrompts } = useBackfillPromptPreference()
const categoryChoices = ref<string[]>([])
const savedLineSnapshots = reactive(new Map<number, string>())
const failedAutosaveKey = ref('')
const discardConfirmOpen = ref(false)
const discardTarget = ref<any>(null)
const allowNavigationAfterDiscard = ref(false)
const pendingDuplicateMerge = ref<{ receipt: MatchingReceipt, description: string } | null>(null)
const splitSelectionMode = ref(false)
const selectedSplitEntryIds = ref<string[]>([])
const splitDialogOpen = ref(false)
const splitPurchasedOn = ref('')
const splitLocation = ref('')
const splitMatchingReceipt = ref<MatchingReceipt | null>(null)
const splitCheckingMatch = ref(false)
const splitMatchFailed = ref(false)
const splitError = ref('')
const splitReviewed = ref(false)
const splitIntoExistingConfirmed = ref(false)
const splitBusy = ref(false)
const splitNotice = ref<{ movedCount: number, targetReceiptId: string, targetPurchasedOn: string, targetLocation: string, undo: SplitUndo } | null>(null)
const splitMatchRetryKey = ref(0)
let nextKey = 1
let matchRequest = 0
let receiptLoadRequest = 0
let splitMatchRequest = 0
const receiptMatchRetryKey = ref(0)
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
const hasReceipt = computed(() => Boolean(currentReceiptId.value))

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function dateDisplayLabel(value: string) {
  const date = parseCalendarDate(value)
  return date
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
    : value
}

const purchasedOnStorageKey = 'receipt-box:purchased-on'

function initialPurchasedOn() {
  if (import.meta.client) {
    try {
      const storedDate = localStorage.getItem(purchasedOnStorageKey)
      if (storedDate && /^\d{4}-\d{2}-\d{2}$/.test(storedDate)) return storedDate
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }
  return localDate()
}

function blankLine(): ReceiptLine {
  return {
    key: nextKey++, item: '', price: '', size: '', unit: '', saleItem: false,
    nonGrocery: false, notes: '', category: null, categoryItem: '', categoryChanged: false, expanded: false, confirmingRemove: false, itemMenuOpen: false,
    pendingItemCreation: '', itemBeforeCreation: '', searchTerm: '', suggestions: [], request: 0, backfillKey: '', backfillChecking: false, backfillPrompted: false
  }
}

function dimensionBackfillKey(item: string, size: string, unit: string | null) {
  return size || unit ? `${item.trim()}\u001f${size}\u001f${unit ?? ''}` : ''
}

function lineFromEntry(entry: EditableReceipt['entries'][number]): ReceiptLine {
  const size = compactNumber(entry.size)
  const unit = entry.unit ?? ''
  return {
    id: entry.id,
    key: nextKey++,
    item: entry.item,
    price: Number(entry.price).toFixed(2),
    size,
    unit,
    saleItem: entry.saleItem,
    nonGrocery: entry.nonGrocery,
    notes: entry.notes ?? '',
    category: entry.category ?? null,
    categoryItem: entry.item,
    categoryChanged: false,
    expanded: Boolean(entry.notes || entry.nonGrocery),
    confirmingRemove: false,
    itemMenuOpen: false,
    pendingItemCreation: '',
    itemBeforeCreation: '',
    searchTerm: '',
    suggestions: [],
    request: 0,
    backfillKey: '',
    backfillChecking: false,
    backfillPrompted: false
  }
}

const form = reactive({
  purchasedOn: initialPurchasedOn(),
  location: '',
  lines: [blankLine()]
})

function lineHasContent(line: ReceiptLine) {
  return Boolean(
    line.id || line.item.trim() || line.price !== '' || line.size !== '' || line.unit.trim()
    || line.saleItem || line.nonGrocery || line.notes.trim()
  )
}

function lineSnapshot(line: ReceiptLine) {
  const snapshot = receiptLineSaveSnapshot(form.purchasedOn, form.location, line)
  return line.categoryChanged && line.categoryItem === line.item ? JSON.stringify({ ...JSON.parse(snapshot), category: line.category }) : snapshot
}

function snapshotWithoutCategory(snapshot: string) {
  const value = JSON.parse(snapshot)
  delete value.category
  return JSON.stringify(value)
}

function exportReceiptCsv() {
  const rows = completeLines.value.map(line => [
    form.purchasedOn,
    line.item.trim(),
    line.category,
    form.location.trim(),
    line.size === '' ? null : Number(line.size),
    normalizeUnit(line.unit),
    Number(line.price),
    null,
    null,
    line.saleItem,
    line.nonGrocery,
    line.notes.trim() || null
  ])
  if (!rows.length || !import.meta.client) return

  const blob = new Blob([entryCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const store = form.location.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'receipt'
  anchor.href = url
  anchor.download = `receipt-box-${form.purchasedOn}-${store}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

const enteredLines = computed(() => form.lines.filter(lineHasContent))
const completeLines = computed(() => enteredLines.value.filter(receiptLineIsComplete))
const incompleteLines = computed(() => enteredLines.value.filter(line => !receiptLineIsComplete(line)))
const hasBlankLine = computed(() => form.lines.some(line => !lineHasContent(line)))
const renderedLines = computed(() => splitSelectionMode.value ? form.lines.filter(line => Boolean(line.id)) : form.lines)
const savedReceiptLines = computed(() => form.lines.filter(line => Boolean(line.id) && receiptLineIsComplete(line) && savedLineSnapshots.get(line.key) === lineSnapshot(line)))
const selectedSplitLines = computed(() => savedReceiptLines.value.filter(line => line.id && selectedSplitEntryIds.value.includes(line.id)))
const canStartSplit = computed(() => (
  hasReceipt.value
  && savedReceiptLines.value.length >= 2
  && !hasUnsavedChanges.value
  && !saving.value
  && !checkingReceiptMatch.value
  && !receiptMatchFailed.value
  && !pendingDuplicateMerge.value
  && !pendingBackfill.value
))
const splitSameAsSource = computed(() => (
  splitPurchasedOn.value === form.purchasedOn
  && storeNameKey(splitLocation.value) === storeNameKey(form.location)
))
const splitDateValid = computed(() => Boolean(parseCalendarDate(splitPurchasedOn.value)))
const canMoveSplitLines = computed(() => (
  splitDialogOpen.value
  && selectedSplitLines.value.length > 0
  && selectedSplitLines.value.length < savedReceiptLines.value.length
  && splitDateValid.value
  && Boolean(splitLocation.value.trim())
  && !splitSameAsSource.value
  && !splitCheckingMatch.value
  && !splitMatchFailed.value
  && !splitBusy.value
  && splitReviewed.value
  && (!splitMatchingReceipt.value || splitIntoExistingConfirmed.value)
))
const hasUnsavedChanges = computed(() => enteredLines.value.some(line => (
  !receiptLineIsComplete(line) || savedLineSnapshots.get(line.key) !== lineSnapshot(line)
)))
const canEnterLines = computed(() => Boolean(form.location.trim()) && (
  hasReceipt.value || (!checkingReceiptMatch.value && !receiptMatchFailed.value && !matchingReceipt.value)
))
const storeError = computed(() => !form.location.trim() && enteredLines.value.length > 0
  ? 'Select a store to save this receipt'
  : undefined)
const receiptTotal = computed(() => completeLines.value.reduce((sum, line) => sum + Number(line.price), 0))
const canSaveAndAddAnother = computed(() => (
  enteredLines.value.length > 0
  && incompleteLines.value.length === 0
  && /^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn)
  && Boolean(form.location.trim())
  && !saving.value
  && !checkingReceiptMatch.value
  && !receiptMatchFailed.value
  && !matchingReceipt.value
  && !pendingDuplicateMerge.value
  && !pendingBackfill.value
))
const autosaveFailed = computed(() => Boolean(failedAutosaveKey.value) && failedAutosaveKey.value === autosaveAttemptKey())
const autosaveStatus = computed(() => {
  if (saving.value) return 'Saving changes…'
  if (autosaveFailed.value) return 'Changes could not be saved'
  if (incompleteLines.value.length) {
    return `${incompleteLines.value.length} unsaved ${incompleteLines.value.length === 1 ? 'row' : 'rows'} in progress`
  }
  if (hasUnsavedChanges.value) return 'Changes waiting to save…'
  if (currentReceiptId.value) return 'All changes saved'
  return 'Complete a row to save it'
})

function loadReceipt(receipt: EditableReceipt) {
  form.purchasedOn = receipt.purchasedOn
  form.location = receipt.location
  form.lines = receipt.entries.map(lineFromEntry)
  if (!form.lines.length) form.lines = [blankLine()]
  currentReceiptId.value = receipt.id
  allowDateChange.value = false
  allowStoreChange.value = false
  lastSavedSummary.value = {
    id: receipt.id,
    purchasedOn: receipt.purchasedOn,
    location: receipt.location,
    itemCount: receipt.itemCount,
    total: receipt.total
  }
  confirmedReceiptKey.value = { purchasedOn: receipt.purchasedOn, location: receipt.location }
  failedAutosaveKey.value = ''
  splitSelectionMode.value = false
  selectedSplitEntryIds.value = []
  savedLineSnapshots.clear()
  for (const line of form.lines) {
    if (line.id) savedLineSnapshots.set(line.key, lineSnapshot(line))
  }
}

watch(() => props.initialReceiptId, async (id) => {
  const request = ++receiptLoadRequest
  if (!id || id === currentReceiptId.value) return
  try {
    const result = await $fetch<{ receipt: EditableReceipt | null }>(apiUrl(`/receipts/${id}`))
    if (request !== receiptLoadRequest || props.initialReceiptId !== id) return
    if (result.receipt) loadReceipt(result.receipt)
    else errorMessage.value = 'Receipt not found'
  } catch (error: any) {
    if (request !== receiptLoadRequest || props.initialReceiptId !== id) return
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not load this receipt'
  }
}, { immediate: true })

watch(() => [props.initialDate, props.initialLocation, props.initialReceiptId] as const, ([initialDate, initialLocation, initialReceiptId]) => {
  if (initialReceiptId && initialReceiptId === currentReceiptId.value) return
  clearTimeout(autosaveTimer)
  form.lines.forEach(line => clearTimeout(line.timer))
  savedLineSnapshots.clear()
  form.purchasedOn = /^\d{4}-\d{2}-\d{2}$/.test(initialDate || '') ? initialDate! : initialPurchasedOn()
  form.location = initialLocation?.trim() || ''
  form.lines = [blankLine()]
  currentReceiptId.value = null
  allowDateChange.value = false
  allowStoreChange.value = false
  lastSavedSummary.value = null
  confirmedReceiptKey.value = null
  failedAutosaveKey.value = ''
  receiptMatchFailed.value = false
  errorMessage.value = ''
  confirmingDelete.value = false
}, { immediate: true })

watch(hasUnsavedChanges, dirty => emit('dirtyChange', dirty), { immediate: true })

watch(() => form.purchasedOn, (purchasedOn) => {
  if (!import.meta.client || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) return
  try {
    localStorage.setItem(purchasedOnStorageKey, purchasedOn)
  } catch {
    // Keep the in-memory date sticky even when browser storage is unavailable.
  }
})

const matchingReceiptMessage = computed(() => {
  if (!matchingReceipt.value || hasReceipt.value) return ''
  const existingItems = `${matchingReceipt.value.itemCount} ${matchingReceipt.value.itemCount === 1 ? 'item' : 'items'}`
  return `A receipt already exists for this store and date with ${existingItems}. Open it to add or edit its lines.`
})

watch([
  () => form.purchasedOn,
  () => form.location,
  () => currentReceiptId.value,
  () => receiptMatchRetryKey.value
], async ([purchasedOn, location, receiptId]) => {
  const request = ++matchRequest
  clearTimeout(autosaveTimer)
  matchingReceipt.value = null
  if (receiptMatchFailed.value) errorMessage.value = ''
  receiptMatchFailed.value = false
  const normalizedLocation = String(location ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(purchasedOn)) || !normalizedLocation) {
    checkingReceiptMatch.value = false
    return
  }
  checkingReceiptMatch.value = true
  try {
    const result = await $fetch<{ receipt: MatchingReceipt | null }>(apiUrl('/receipts/match'), {
      query: { date: purchasedOn, location: normalizedLocation, excludeId: receiptId || undefined }
    })
    if (request !== matchRequest) return
    if (result.receipt && receiptId) {
      const existingItems = `${result.receipt.itemCount} ${result.receipt.itemCount === 1 ? 'item' : 'items'}`
      pendingDuplicateMerge.value = {
        receipt: result.receipt,
        description: `A receipt already exists for ${normalizedLocation} on ${purchasedOn} with ${existingItems}. Merge this receipt into it?`
      }
    } else {
      matchingReceipt.value = result.receipt
    }
  } catch {
    if (request === matchRequest) {
      matchingReceipt.value = null
      if (receiptId && confirmedReceiptKey.value) {
        form.purchasedOn = confirmedReceiptKey.value.purchasedOn
        form.location = confirmedReceiptKey.value.location
        errorMessage.value = 'Could not check for an existing receipt. The date and store were restored.'
      } else {
        receiptMatchFailed.value = true
        errorMessage.value = 'Could not check for an existing receipt. Retry the check before saving.'
      }
    }
  } finally {
    if (request === matchRequest) {
      checkingReceiptMatch.value = false
      scheduleAutosave()
    }
  }
}, { immediate: true })

watch([
  () => splitDialogOpen.value,
  () => splitPurchasedOn.value,
  () => splitLocation.value,
  () => splitMatchRetryKey.value
], async ([open, purchasedOn, location]) => {
  const request = ++splitMatchRequest
  splitMatchingReceipt.value = null
  splitCheckingMatch.value = false
  splitMatchFailed.value = false
  splitError.value = ''
  splitReviewed.value = false
  splitIntoExistingConfirmed.value = false
  const normalizedLocation = String(location ?? '').trim()
  if (!open || !parseCalendarDate(String(purchasedOn)) || !normalizedLocation || splitSameAsSource.value) return
  splitCheckingMatch.value = true
  try {
    const result = await $fetch<{ receipt: MatchingReceipt | null }>(apiUrl('/receipts/match'), {
      query: { date: purchasedOn, location: normalizedLocation, excludeId: currentReceiptId.value || undefined }
    })
    if (request === splitMatchRequest) splitMatchingReceipt.value = result.receipt
  } catch {
    if (request === splitMatchRequest) {
      splitMatchFailed.value = true
      splitError.value = 'Could not check for a receipt at the destination. Retry the check before moving these lines.'
    }
  } finally {
    if (request === splitMatchRequest) splitCheckingMatch.value = false
  }
})

watch(() => JSON.stringify({
  purchasedOn: form.purchasedOn,
  location: form.location,
  lines: form.lines.map(line => ({ key: line.key, id: line.id, value: lineSnapshot(line) }))
}), () => scheduleAutosave())

watch(() => form.location, (location, previousLocation) => {
  if (previousLocation.trim() || !location.trim() || enteredLines.value.length) return
  nextTick(() => document.querySelector<HTMLInputElement>('[data-line-item]')?.focus())
})

function itemOptions(line: ReceiptLine) {
  return line.suggestions.map(suggestion => ({
    label: suggestion.value,
    value: suggestion.value,
    onSelect: () => chooseItem(line, suggestion),
    description: [
      suggestion.size ? `${Number(suggestion.size).toLocaleString()} ${suggestion.unit || ''}`.trim() : suggestion.unit,
      suggestion.price ? `last $${Number(suggestion.price).toFixed(2)}` : null
    ].filter(Boolean).join(' · ')
  }))
}

function compactNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : value
}

async function loadLocations() {
  try {
    locationSuggestions.value = await $fetch(apiUrl('/suggestions'), { query: { field: 'location', limit: 20 } })
  } catch {
    locationSuggestions.value = []
  }
}

function createLocation(value: string | { value: string }) {
  form.location = (typeof value === 'string' ? value : value.value).trim()
}

function createSplitLocation(value: string | { value: string }) {
  splitLocation.value = (typeof value === 'string' ? value : value.value).trim()
}

function openMatchingReceipt() {
  if (matchingReceipt.value) return navigateTo(`/receipts/${matchingReceipt.value.id}`)
}

function startSplitSelection() {
  if (!canStartSplit.value) return
  splitNotice.value = null
  splitError.value = ''
  selectedSplitEntryIds.value = []
  splitSelectionMode.value = true
}

function cancelSplitSelection() {
  splitSelectionMode.value = false
  selectedSplitEntryIds.value = []
  splitDialogOpen.value = false
  splitError.value = ''
}

function toggleSplitEntry(id: string, selected: boolean) {
  if (selected) {
    if (selectedSplitEntryIds.value.length >= savedReceiptLines.value.length - 1) return
    selectedSplitEntryIds.value = [...selectedSplitEntryIds.value, id]
  } else {
    selectedSplitEntryIds.value = selectedSplitEntryIds.value.filter(entryId => entryId !== id)
  }
  splitError.value = ''
}

function openSplitDialog() {
  if (!selectedSplitLines.value.length) return
  splitPurchasedOn.value = form.purchasedOn
  splitLocation.value = ''
  splitReviewed.value = false
  splitIntoExistingConfirmed.value = false
  splitError.value = ''
  splitDialogOpen.value = true
}

function retrySplitMatch() {
  splitMatchRetryKey.value++
}

async function moveSelectedLines() {
  if (!canMoveSplitLines.value || !currentReceiptId.value) return
  splitBusy.value = true
  splitError.value = ''
  const sourcePurchasedOn = form.purchasedOn
  const sourceLocation = form.location
  const entryIds = selectedSplitLines.value.flatMap(line => line.id ? [line.id] : [])
  try {
    const result = await $fetch<{
      source: EditableReceipt
      targetReceiptId: string
      targetWasCreated: boolean
      movedEntryIds: string[]
      movedCount: number
      targetPurchasedOn: string
      targetLocation: string
    }>(apiUrl(`/receipts/${currentReceiptId.value}/split`), {
      method: 'POST',
      body: {
        entryIds,
        purchasedOn: splitPurchasedOn.value,
        location: splitLocation.value,
        ...(splitMatchingReceipt.value ? { targetReceiptId: splitMatchingReceipt.value.id } : {})
      }
    })
    const undo: SplitUndo = {
      sourceId: currentReceiptId.value,
      targetReceiptId: result.targetReceiptId,
      entryIds: result.movedEntryIds,
      targetWasCreated: result.targetWasCreated,
      sourcePurchasedOn,
      sourceLocation,
      targetPurchasedOn: result.targetPurchasedOn,
      targetLocation: result.targetLocation
    }
    loadReceipt(result.source)
    splitDialogOpen.value = false
    selectedSplitEntryIds.value = []
    splitNotice.value = {
      movedCount: result.movedCount,
      targetReceiptId: result.targetReceiptId,
      targetPurchasedOn: result.targetPurchasedOn,
      targetLocation: result.targetLocation,
      undo
    }
    receiptSessionMessage.value = `Moved ${result.movedCount} ${result.movedCount === 1 ? 'line' : 'lines'} to ${result.targetLocation} on ${dateDisplayLabel(result.targetPurchasedOn)}.`
  } catch (error: any) {
    splitError.value = error?.data?.statusMessage || error?.message || 'Could not move these lines'
    if (error?.statusCode === 409 || error?.response?.status === 409 || error?.data?.statusCode === 409) splitMatchFailed.value = true
  } finally {
    splitBusy.value = false
  }
}

async function undoSplit() {
  const notice = splitNotice.value
  if (!notice || splitBusy.value) return
  splitBusy.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<{ source: EditableReceipt }>(apiUrl(`/receipts/${notice.undo.sourceId}/split-undo`), {
      method: 'POST',
      body: notice.undo
    })
    loadReceipt(result.source)
    splitNotice.value = null
    receiptSessionMessage.value = 'The receipt split was undone.'
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not undo this receipt split'
  } finally {
    splitBusy.value = false
  }
}

function confirmDiscardNavigation(to: any) {
  if (currentReceiptId.value && to.path === `/receipts/${currentReceiptId.value}`) return true
  if (allowNavigationAfterDiscard.value) {
    allowNavigationAfterDiscard.value = false
    return true
  }
  if (!hasUnsavedChanges.value) return true
  discardTarget.value = to
  discardConfirmOpen.value = true
  return false
}

function isReceiptEditorPath(path: string) {
  return path === '/receipts/new' || /^\/receipts\/\d+$/.test(path)
}

async function discardChanges() {
  const target = discardTarget.value
  discardConfirmOpen.value = false
  discardTarget.value = null
  if (!target) return
  // The guard is bypassed once the destination navigation is explicitly confirmed.
  allowNavigationAfterDiscard.value = true
  await navigateTo(target)
}

function resolveDuplicateMerge(confirmed: boolean) {
  const pending = pendingDuplicateMerge.value
  pendingDuplicateMerge.value = null
  if (confirmed && pending) {
    matchingReceipt.value = null
    scheduleAutosave()
    return
  }
  const confirmedKey = confirmedReceiptKey.value
  if (confirmedKey) {
    form.purchasedOn = confirmedKey.purchasedOn
    form.location = confirmedKey.location
  }
}

function retryReceiptMatch() {
  receiptMatchRetryKey.value++
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

function handleAddLineShortcut(event: KeyboardEvent) {
  if (
    event.key !== 'Enter'
    || !event.shiftKey
    || (!event.metaKey && !event.ctrlKey)
    || event.altKey
    || event.repeat
  ) return
  event.preventDefault()
  event.stopPropagation()
  addLine()
}

function handleAddReceiptShortcut(event: KeyboardEvent) {
  if (
    event.key !== 'Enter'
    || !event.altKey
    || (!event.metaKey && !event.ctrlKey)
    || event.shiftKey
    || event.repeat
    || !canSaveAndAddAnother.value
  ) return
  event.preventDefault()
  event.stopPropagation()
  saveAndAddAnotherReceipt()
}

function handleCancelRemoveShortcut(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const line = form.lines.find(candidate => candidate.confirmingRemove)
  if (!line) return
  event.preventDefault()
  event.stopPropagation()
  cancelRemoveLine(line)
}

onBeforeRouteLeave(to => confirmDiscardNavigation(to))
onBeforeRouteUpdate(to => confirmDiscardNavigation(to))

onMounted(() => {
  loadLocations()
  loadCategories()
  void loadBackfillPrompts()
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleAddLineShortcut, { capture: true })
  window.addEventListener('keydown', handleAddReceiptShortcut, { capture: true })
  window.addEventListener('keydown', handleCancelRemoveShortcut, { capture: true })
})

onBeforeUnmount(() => {
  clearTimeout(autosaveTimer)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleAddLineShortcut, { capture: true })
  window.removeEventListener('keydown', handleAddReceiptShortcut, { capture: true })
  window.removeEventListener('keydown', handleCancelRemoveShortcut, { capture: true })
  form.lines.forEach(line => clearTimeout(line.timer))
})

function searchItems(line: ReceiptLine, value: string) {
  line.searchTerm = value
  clearTimeout(line.timer)
  const search = value.trim()
  const request = ++line.request
  if (!search) {
    line.suggestions = []
    return
  }
  line.timer = setTimeout(async () => {
    try {
      const suggestions = await $fetch<Suggestion[]>(apiUrl('/suggestions'), {
        query: { field: 'item', q: search, limit: 8 }
      })
      if (request === line.request) line.suggestions = suggestions
    } catch {
      if (request === line.request) line.suggestions = []
    }
  }, 160)
}

function chooseItem(line: ReceiptLine, suggestion: Suggestion) {
  const sameItem = line.categoryItem === suggestion.value
  const visibleLine = form.lines.find(candidate => (
    candidate !== line && candidate.item.trim() === suggestion.value.trim() && candidate.categoryItem === suggestion.value
  ))
  line.item = suggestion.value
  if (!sameItem) line.categoryChanged = false
  const category = visibleLine ? visibleLine.category : sameItem ? line.category : suggestion.category ?? null
  setVisibleItemCategory(line.item, category)
  if (!line.id || line.size === '') line.size = compactNumber(suggestion.size)
  if (!line.id || !line.unit.trim()) line.unit = suggestion.unit ?? ''
  line.itemMenuOpen = false
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
}

function requestCreateItem(line: ReceiptLine, value: string | { value: string }) {
  const item = (typeof value === 'string' ? value : value.value).trim()
  if (!item) return
  line.itemBeforeCreation = line.item === item ? '' : line.item
  line.pendingItemCreation = item
  line.item = ''
  line.itemMenuOpen = false
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-confirm-item="${line.key}"]`)?.focus())
}

function confirmCreateItem(line: ReceiptLine) {
  line.item = line.pendingItemCreation
  line.searchTerm = line.pendingItemCreation
  line.category = null
  line.categoryItem = line.item
  line.categoryChanged = false
  line.pendingItemCreation = ''
  line.itemBeforeCreation = ''
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-price="${line.key}"]`)?.focus())
}

function cancelCreateItem(line: ReceiptLine) {
  line.item = line.itemBeforeCreation
  line.searchTerm = line.itemBeforeCreation
  line.pendingItemCreation = ''
  line.itemBeforeCreation = ''
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${line.key}"]`)?.focus())
}

function closeItemMenu(line: ReceiptLine) {
  line.itemMenuOpen = false
}

function setVisibleItemCategory(item: string, category: string | null, changed = false) {
  for (const line of form.lines) {
    if (line.item.trim() === item.trim()) {
      line.category = category
      line.categoryItem = line.item
      if (changed) line.categoryChanged = true
    }
  }
}

function changeCategory(line: ReceiptLine, category: string | null) {
  setVisibleItemCategory(line.item, category, true)
  if (category && !categoryChoices.value.some(choice => categoryKey(choice) === categoryKey(category))) {
    categoryChoices.value = [...categoryChoices.value, category].sort((a, b) => a.localeCompare(b))
  }
}

async function loadCategories() {
  try {
    categoryChoices.value = await $fetch<string[]>(apiUrl('/categories'))
  } catch {
    categoryChoices.value = []
  }
}

function formatPrice(line: ReceiptLine) {
  if (line.price === '') return
  const price = Number(line.price)
  if (Number.isFinite(price) && price >= 0) line.price = price.toFixed(2)
}

function focusLineItem(line: ReceiptLine, reveal = false) {
  requestAnimationFrame(() => {
    const item = document.querySelector<HTMLInputElement>(`[data-line-item="${line.key}"]`)
    item?.focus({ preventScroll: reveal })
    if (reveal) {
      document.querySelector<HTMLElement>(`[data-receipt-line="${line.key}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
}

function addLine(focus = true) {
  const existingBlank = form.lines.find(line => !lineHasContent(line))
  if (existingBlank) {
    if (focus) focusLineItem(existingBlank, true)
    return
  }
  const line = blankLine()
  form.lines.push(line)
  if (focus) focusLineItem(line, true)
}

function finishLine(line: ReceiptLine) {
  formatPrice(line)
  if (!line.item.trim()) {
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${line.key}"]`)?.focus())
    return
  }
  if (!receiptLineIsComplete(line)) {
    const field = line.price === '' || !Number.isFinite(Number(line.price)) || Number(line.price) < 0 ? 'price' : 'size'
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-${field}="${line.key}"]`)?.focus())
    return
  }
  const index = form.lines.indexOf(line)
  if (index === form.lines.length - 1) addLine()
  else requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-item="${form.lines[index + 1]!.key}"]`)?.focus())
}

function focusLineSize(line: ReceiptLine) {
  formatPrice(line)
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-size="${line.key}"]`)?.focus())
}

function focusLineUnit(line: ReceiptLine) {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-unit="${line.key}"]`)?.focus())
}

function focusLineSale(line: ReceiptLine) {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-line-sale="${line.key}"]`)?.focus())
}

function focusLineDetails(line: ReceiptLine) {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-line-details="${line.key}"]`)?.focus())
}

function advanceFromLineDetails(line: ReceiptLine) {
  if (!line.expanded) {
    finishLine(line)
    return
  }
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-category="${line.key}"]`)?.focus())
}

function focusLineNonGrocery(line: ReceiptLine) {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-line-non-grocery="${line.key}"]`)?.focus())
}

function focusLineNotes(line: ReceiptLine) {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line-notes="${line.key}"]`)?.focus())
}

function entryBody(line: ReceiptLine, includeCategory = line.categoryChanged && line.categoryItem === line.item) {
  return {
    purchasedOn: form.purchasedOn,
    location: form.location,
    item: line.item,
    price: line.price,
    size: line.size || null,
    unit: normalizeUnit(line.unit),
    saleItem: line.saleItem,
    nonGrocery: line.nonGrocery,
    notes: line.notes,
    ...(includeCategory ? { category: line.category } : {})
  }
}

function autosaveAttemptKey() {
  const rows = completeLines.value.filter(line => savedLineSnapshots.get(line.key) !== lineSnapshot(line))
  return rows.length ? JSON.stringify(rows.map(line => [line.key, lineSnapshot(line)])) : ''
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer)
  if (saving.value || checkingReceiptMatch.value || receiptMatchFailed.value || matchingReceipt.value || pendingDuplicateMerge.value || pendingBackfill.value) return
  const validHeader = /^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn) && Boolean(form.location.trim())
  const attemptKey = autosaveAttemptKey()
  if (!validHeader || !attemptKey || attemptKey === failedAutosaveKey.value) return
  failedAutosaveKey.value = ''
  autosaveTimer = setTimeout(() => saveCompletedRows(), 600)
}

function retryAutosave() {
  failedAutosaveKey.value = ''
  saveCompletedRows()
}

async function offerItemBackfill(line: ReceiptLine) {
  await loadBackfillPrompts()
  const size = String(line.size ?? '').trim()
  const unit = normalizeUnit(line.unit)
  if (!backfillPromptsEnabled.value || !line.id || line.backfillPrompted || (!size && !unit)) return false
  const key = dimensionBackfillKey(line.item, size, unit)
  if (line.backfillKey === key || line.backfillChecking || pendingBackfill.value) return false
  line.backfillChecking = true
  try {
    const counts = await $fetch<{ size: number, unit: number, either: number }>(apiUrl('/items/backfill'), {
      query: { item: line.item.trim(), excludeId: line.id }
    })
    line.backfillKey = key
    const hasEligibleEntries = (Boolean(size) && counts.size > 0) || (Boolean(unit) && counts.unit > 0)
    if (!hasEligibleEntries) return false
    line.backfillPrompted = true
    backfillSizeSelected.value = Boolean(size) && counts.size > 0
    backfillUnitSelected.value = Boolean(unit) && counts.unit > 0
    pendingBackfill.value = {
      lineKey: line.key,
      entryId: line.id,
      item: line.item.trim(),
      size,
      unit,
      counts
    }
    return true
  } finally {
    line.backfillChecking = false
  }
}

function backfillDescription(pending: PendingBackfill) {
  return `Choose which new values to add to earlier purchases of ${pending.item}.`
}

const selectedBackfillFields = computed<Array<'size' | 'unit'>>(() => [
  ...(backfillSizeSelected.value ? ['size' as const] : []),
  ...(backfillUnitSelected.value ? ['unit' as const] : [])
])

const selectedBackfillCount = computed(() => {
  const pending = pendingBackfill.value
  if (!pending) return 0
  if (backfillSizeSelected.value && backfillUnitSelected.value) return pending.counts.either
  if (backfillSizeSelected.value) return pending.counts.size
  if (backfillUnitSelected.value) return pending.counts.unit
  return 0
})

function unitFieldIsFocused(line: ReceiptLine) {
  return import.meta.client && document.activeElement?.matches(`[data-line-unit="${line.key}"]`)
}

async function checkItemBackfillOnUnitExit(line: ReceiptLine) {
  if (saving.value) return
  try {
    await offerItemBackfill(line)
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not check previous entries'
  }
}

async function resolveItemBackfill(fields: Array<'size' | 'unit'>) {
  const pending = pendingBackfill.value
  if (!pending) return
  if (fields.length) {
    backfillBusy.value = true
    errorMessage.value = ''
    try {
      await $fetch(apiUrl('/items/backfill'), {
        method: 'PATCH',
        body: {
          item: pending.item,
          excludeId: pending.entryId,
          size: pending.size,
          unit: pending.unit,
          fields
        }
      })
    } catch (error: any) {
      errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not update previous entries'
      backfillBusy.value = false
      return
    }
    backfillBusy.value = false
  }
  pendingBackfill.value = null
  scheduleAutosave()
}

async function loadCurrentReceiptSummary() {
  if (!currentReceiptId.value) return null
  const result = await $fetch<{ receipt: MatchingReceipt | null }>(apiUrl('/receipts/match'), {
    query: { date: form.purchasedOn, location: form.location }
  })
  if (!result.receipt || result.receipt.id !== currentReceiptId.value) return null
  const summary: ReceiptSaveSummary = {
    ...result.receipt,
    purchasedOn: form.purchasedOn,
    location: form.location
  }
  lastSavedSummary.value = summary
  return summary
}

async function saveCompletedRows(updateReceiptRoute = true) {
  if (saving.value || checkingReceiptMatch.value || pendingDuplicateMerge.value) return false
  if (!currentReceiptId.value && receiptMatchFailed.value) return false
  if (!currentReceiptId.value && matchingReceipt.value) return false
  const rows = completeLines.value.filter(line => savedLineSnapshots.get(line.key) !== lineSnapshot(line))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.purchasedOn) || !form.location.trim()) return false
  if (!rows.length) return Boolean(currentReceiptId.value) && !hasUnsavedChanges.value

  saving.value = true
  errorMessage.value = ''
  let savedAllRows = true
  try {
    const categoriesSaved = new Set<string>()
    for (const line of rows) {
      if (savedLineSnapshots.get(line.key) === lineSnapshot(line)) continue
      const snapshot = lineSnapshot(line)
      const submittedItem = line.item.trim()
      const savedCategory = line.category
      const savesCategory = line.categoryChanged && line.categoryItem === submittedItem
      const saved = await $fetch<SavedEntry>(apiUrl(line.id ? `/entries/${line.id}` : '/entries'), {
        method: line.id ? 'PUT' : 'POST',
        body: entryBody(line, savesCategory && !categoriesSaved.has(submittedItem))
      })
      line.id = saved.id
      currentReceiptId.value = saved.receiptId
      savedLineSnapshots.set(line.key, snapshot)
      if (savesCategory && line.category === savedCategory && line.item.trim() === submittedItem) {
        categoriesSaved.add(submittedItem)
        const canonicalCategory = Object.hasOwn(saved, 'category') ? saved.category ?? null : savedCategory
        for (const candidate of form.lines) {
          if (
            candidate.item.trim() === submittedItem
            && candidate.category === savedCategory
            && (!candidate.categoryChanged || candidate === line)
          ) {
            candidate.category = canonicalCategory
            candidate.categoryItem = candidate.item
            candidate.categoryChanged = false
          }
        }
        if (canonicalCategory) {
          const index = categoryChoices.value.findIndex(choice => categoryKey(choice) === categoryKey(canonicalCategory))
          if (index === -1) categoryChoices.value.push(canonicalCategory)
          else categoryChoices.value[index] = canonicalCategory
          categoryChoices.value.sort((a, b) => a.localeCompare(b))
        }
        savedLineSnapshots.set(line.key, snapshotWithoutCategory(snapshot))
      }
      if (!unitFieldIsFocused(line) && await offerItemBackfill(line)) {
        savedAllRows = false
        break
      }
    }

    confirmedReceiptKey.value = { purchasedOn: form.purchasedOn, location: form.location }
    if (savedAllRows) {
      allowDateChange.value = false
      allowStoreChange.value = false
    }
    failedAutosaveKey.value = ''
    await loadCurrentReceiptSummary()
  } catch (error: any) {
    savedAllRows = false
    failedAutosaveKey.value = autosaveAttemptKey()
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not save these changes'
  } finally {
    saving.value = false
    if (updateReceiptRoute && currentReceiptId.value && isReceiptEditorPath(route.path) && route.path !== `/receipts/${currentReceiptId.value}`) {
      await router.replace(`/receipts/${currentReceiptId.value}`)
    }
    scheduleAutosave()
  }
  return savedAllRows && rows.every(line => savedLineSnapshots.get(line.key) === lineSnapshot(line))
}

async function saveAndAddAnotherReceipt() {
  if (!canSaveAndAddAnother.value) return
  clearTimeout(autosaveTimer)
  receiptSessionMessage.value = ''
  const nextDate = form.purchasedOn
  await saveCompletedRows(false)
  const hasUnpersistedRows = completeLines.value.some(line => (
    !line.id || savedLineSnapshots.get(line.key) !== lineSnapshot(line)
  ))
  if (!currentReceiptId.value || pendingBackfill.value || hasUnpersistedRows) {
    if (currentReceiptId.value && isReceiptEditorPath(route.path) && route.path !== `/receipts/${currentReceiptId.value}`) {
      await router.replace(`/receipts/${currentReceiptId.value}`)
    }
    return
  }

  form.lines.forEach(line => clearTimeout(line.timer))
  savedLineSnapshots.clear()
  form.purchasedOn = nextDate
  form.location = ''
  form.lines = [blankLine()]
  currentReceiptId.value = null
  lastSavedSummary.value = null
  confirmedReceiptKey.value = null
  failedAutosaveKey.value = ''
  errorMessage.value = ''
  confirmingDelete.value = false
  receiptSessionMessage.value = 'Receipt saved. Ready for another receipt.'
  if (isReceiptEditorPath(route.path)) {
    await router.replace({ path: '/receipts/new', query: { date: nextDate } })
  }
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-receipt-store]')?.focus()
}

async function removeLine(line: ReceiptLine) {
  if (saving.value) return
  clearTimeout(line.timer)
  if (line.id) {
    saving.value = true
    errorMessage.value = ''
    try {
      await $fetch(apiUrl(`/entries/${line.id}`), { method: 'DELETE' })
      savedLineSnapshots.delete(line.key)
    } catch (error: any) {
      errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not delete this row'
      saving.value = false
      return
    }
    saving.value = false
  }

  const index = form.lines.indexOf(line)
  if (form.lines.length === 1) Object.assign(line, blankLine(), { key: line.key })
  else form.lines.splice(index, 1)

  const remainingSavedRows = form.lines.filter(candidate => candidate.id)
  if (!remainingSavedRows.length) {
    currentReceiptId.value = null
    lastSavedSummary.value = null
    confirmedReceiptKey.value = null
    failedAutosaveKey.value = ''
  } else {
    await loadCurrentReceiptSummary()
  }
  scheduleAutosave()
}

function requestRemoveLine(line: ReceiptLine) {
  if (line.id) {
    form.lines.forEach(candidate => { candidate.confirmingRemove = false })
    line.confirmingRemove = true
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-line-keep="${line.key}"]`)?.focus())
    return
  }
  removeLine(line)
}

function cancelRemoveLine(line: ReceiptLine) {
  line.confirmingRemove = false
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-line-remove="${line.key}"]`)?.focus())
}

async function deleteReceipt() {
  if (!currentReceiptId.value || !confirmingDelete.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch(apiUrl(`/receipts/${currentReceiptId.value}`), { method: 'DELETE' })
    savedLineSnapshots.clear()
    currentReceiptId.value = null
    lastSavedSummary.value = null
    form.lines = [blankLine()]
    failedAutosaveKey.value = ''
    confirmingDelete.value = false
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Could not delete this receipt'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="receipt-entry-form overflow-visible rounded-3xl shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]" @submit.prevent>
    <header class="receipt-entry-heading flex items-start justify-between gap-8 p-[clamp(24px,3vw,36px)] [border-bottom:1px_solid_var(--line)]">
      <div>
        <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Shopping trip editor</p>
        <h1 class="leading-1.04 text-[clamp(34px,3.5vw,42px)]">{{ hasReceipt ? 'Edit receipt' : 'Add receipt' }}</h1>
        <p class="mt-[10px] text-(--muted)">{{ hasReceipt ? 'Date and store are locked unless you allow a change.' : 'Choose a store and enter its purchases. Completed rows save automatically.' }}</p>
        <UButton :to="{ path: '/', query: { date: form.purchasedOn } }" label="Return to selected day" icon="i-lucide-calendar-days" color="neutral" variant="outline" class="mt-3" />
      </div>
      <div class="receipt-meta-fields grid grid-cols-[170px_minmax(230px,310px)] items-end gap-3.5">
        <div v-if="!hasReceipt" class="receipt-date-display grid min-w-0 [align-content:end] gap-[7px]">
          <span class="text-[13px] font-bold text-(--muted)">Date</span>
          <time class="flex min-h-[52px] items-center text-base text-(--ink)" data-receipt-date-display :datetime="form.purchasedOn">{{ dateDisplayLabel(form.purchasedOn) }}</time>
        </div>
        <UFormField v-else label="Date" name="purchasedOn" required class="field date-field relative grid min-w-0 gap-[5px] text-sm font-medium text-(--muted)">
          <UInput v-model="form.purchasedOn" type="date" required size="lg" :disabled="!allowDateChange" />
          <UCheckbox v-model="allowDateChange" label="Allow date change" />
        </UFormField>
        <UFormField label="Store" name="location" required class="field receipt-store-field relative grid min-w-0 gap-[7px]" :error="storeError">
          <UInputMenu v-model="form.location" data-receipt-store :items="locationSuggestions.map(suggestion => suggestion.value)" create-item icon="i-lucide-store" placeholder="Choose or add a store…" required size="lg" :disabled="hasReceipt && !allowStoreChange" @create="createLocation" />
          <UCheckbox v-if="hasReceipt" v-model="allowStoreChange" label="Allow store change" />
        </UFormField>
      </div>
    </header>

    <p v-if="receiptSessionMessage" class="sr-only" role="status" aria-live="polite">{{ receiptSessionMessage }}</p>
    <div v-if="splitNotice" class="receipt-split-notice m-[16px_24px_0] flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 [background:var(--accent-soft)] [border:1px_solid_color-mix(in_srgb,var(--accent)_40%,var(--line))]" role="status" aria-live="polite">
      <span class="flex-[1_1_280px] text-[13px] font-[650] text-(--accent-strong)">Moved {{ splitNotice.movedCount }} {{ splitNotice.movedCount === 1 ? 'line' : 'lines' }} to {{ splitNotice.targetLocation }} on {{ dateDisplayLabel(splitNotice.targetPurchasedOn) }}.</span>
      <UButton type="button" label="Open destination" icon="i-lucide-arrow-up-right" color="neutral" variant="ghost" :to="`/receipts/${splitNotice.targetReceiptId}`" />
      <UButton type="button" label="Undo" icon="i-lucide-undo-2" color="neutral" variant="outline" :loading="splitBusy" @click="undoSplit" />
    </div>

    <div v-if="canEnterLines" class="receipt-line-labels relative grid grid-cols-[minmax(230px,2fr)_120px_100px_130px_126px] items-center gap-2.5 p-[12px_24px_10px_54px] text-[11px] font-[750] tracking-[.08em] text-(--muted) uppercase [background:var(--surface-muted)]">
      <span>Item</span><span>Price</span><span>Size</span><span>Unit</span><span>Options</span>
      <UPopover>
        <UButton type="button" icon="i-lucide-circle-help" color="neutral" variant="ghost" aria-label="Keyboard entry help" title="Keyboard entry help" />
        <template #content>
          <div class="receipt-keyboard-help w-[min(320px,calc(100vw-32px))] px-4 py-3.5 text-left text-(--ink)">
            <strong>Keyboard entry</strong>
            <p><kbd>Enter</kbd> accepts an item, then moves through Price, Size, and Unit. From Unit, it starts the next row.</p>
            <p><kbd>Tab</kbd> from Unit moves through Sale and Details. Expanded details are included before the next row.</p>
            <p><kbd>⌘ Shift Enter</kbd> on Mac or <kbd>Ctrl Shift Enter</kbd> elsewhere adds or moves to a new item row.</p>
            <p><kbd>⌘ Option Enter</kbd> on Mac or <kbd>Ctrl Alt Enter</kbd> elsewhere saves the receipt and starts another.</p>
            <p><kbd>⌘ Enter</kbd> on Mac or <kbd>Ctrl Enter</kbd> elsewhere finishes the row from any field.</p>
            <p>Item and Price are required. Size and Unit are optional.</p>
          </div>
        </template>
      </UPopover>
    </div>

    <ol v-if="canEnterLines" class="receipt-entry-lines m-0 list-none p-0 [counter-reset:receipt-line]">
      <li v-for="(line, index) in renderedLines" :key="line.key" :data-receipt-line="line.key" class="receipt-entry-line relative grid grid-cols-[minmax(230px,2fr)_120px_100px_130px_126px] items-center gap-2.5 p-[12px_24px_12px_54px] [border-top:1px_solid_var(--line)]">
        <UCheckbox
          v-if="splitSelectionMode && line.id"
          class="receipt-split-line-checkbox absolute top-[50%] left-3 z-2 transform-[translateY(-50%)]"
          :model-value="selectedSplitEntryIds.includes(line.id)"
          :disabled="!selectedSplitEntryIds.includes(line.id) && selectedSplitEntryIds.length >= savedReceiptLines.length - 1"
          :aria-label="`Select ${line.item} to move`"
          @update:model-value="toggleSplitEntry(line.id, $event === true)"
        />
        <span v-else class="receipt-line-number absolute top-[22px] left-5 grid size-6 place-items-center rounded-lg text-xs font-[750] text-(--muted) [background:var(--surface-muted)]" :aria-label="`Line ${index + 1}`">{{ index + 1 }}</span>
        <div class="receipt-line-content contents" :inert="splitSelectionMode">
        <UFormField :name="`item-${line.key}`" class="field receipt-line-item relative grid min-w-0 gap-[7px]">
          <span class="mobile-field-label hidden">Item</span>
          <UInputMenu
            v-model="line.item"
            v-model:open="line.itemMenuOpen"
            v-model:search-term="line.searchTerm"
            :data-line-item="line.key"
            :items="itemOptions(line)"
            value-key="value"
            :create-item="{ when: 'always', position: 'top' }"
            ignore-filter
            placeholder="Start typing an item…"
            @update:search-term="searchItems(line, $event)"
            @create="requestCreateItem(line, $event)"
            @keydown.meta.enter.exact.prevent="finishLine(line)"
            @keydown.ctrl.enter.exact.prevent="finishLine(line)"
          />
        </UFormField>
        <UFormField :name="`price-${line.key}`" class="field receipt-line-price-input relative grid min-w-0 gap-[7px]">
          <span class="mobile-field-label hidden">Price</span>
          <UInput :data-line-price="line.key" v-model="line.price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" icon="i-lucide-dollar-sign" @focus="closeItemMenu(line)" @blur="formatPrice(line)" @keydown.enter.exact.prevent="focusLineSize(line)" @keydown.meta.enter.exact.prevent="finishLine(line)" @keydown.ctrl.enter.exact.prevent="finishLine(line)" />
        </UFormField>
        <UFormField :name="`size-${line.key}`" class="field receipt-line-size relative grid min-w-0 gap-[7px]">
          <span class="mobile-field-label hidden">Size</span>
          <UInput :data-line-size="line.key" v-model="line.size" type="number" min="0.000001" step="any" inputmode="decimal" placeholder="—" @keydown.enter.exact.prevent="focusLineUnit(line)" @keydown.meta.enter.exact.prevent="finishLine(line)" @keydown.ctrl.enter.exact.prevent="finishLine(line)" />
        </UFormField>
        <UFormField :name="`unit-${line.key}`" class="field receipt-line-unit relative grid min-w-0 gap-[7px]">
          <span class="mobile-field-label hidden">Unit</span>
          <UnitInput :data-line-unit="line.key" v-model="line.unit" @blur="checkItemBackfillOnUnitExit(line)" @commit="finishLine(line)" @tab-next="focusLineSale(line)" @keydown.meta.enter.exact.prevent="finishLine(line)" @keydown.ctrl.enter.exact.prevent="finishLine(line)" />
        </UFormField>
        <div class="receipt-line-options flex justify-center gap-0 [align-self:end]">
          <UButton
            type="button"
            :data-line-sale="line.key"
            icon="i-lucide-tag"
            :aria-label="line.saleItem ? 'Remove sale-price flag' : 'Mark as purchased at a sale price'"
            :title="line.saleItem ? 'Purchased at a sale price. Click to remove.' : 'Mark as purchased at a sale price.'"
            :color="line.saleItem ? 'warning' : 'neutral'"
            :variant="line.saleItem ? 'soft' : 'ghost'"
            @keydown.tab.exact.prevent="focusLineDetails(line)"
            @click="line.saleItem = !line.saleItem"
          />
          <UButton type="button" :data-line-details="line.key" icon="i-lucide-ellipsis" :aria-label="line.expanded ? 'Hide details' : 'Show details'" :title="line.expanded ? 'Hide item details' : 'Show item details'" color="neutral" :variant="line.expanded ? 'soft' : 'ghost'" :aria-expanded="line.expanded" @keydown.tab.exact.prevent="advanceFromLineDetails(line)" @click="line.expanded = !line.expanded" />
          <UButton class="receipt-line-remove" type="button" :data-line-remove="line.key" icon="i-lucide-x" :aria-label="`Remove line ${index + 1}`" :title="`Remove line ${index + 1}`" color="neutral" variant="ghost" size="md" :disabled="saving" @click="requestRemoveLine(line)" />
        </div>
        <div v-if="line.pendingItemCreation" class="receipt-item-create-confirmation col-span-full flex items-center justify-end gap-2.5 rounded-xl px-3 py-2.5 [background:color-mix(in_srgb,var(--accent-soft),transparent_35%)] [border:1px_solid_color-mix(in_srgb,var(--accent),transparent_60%)]" role="alert">
          <span>Create <strong>“{{ line.pendingItemCreation }}”</strong> as a new item?</span>
          <UButton type="button" label="Cancel" color="neutral" variant="outline" @click="cancelCreateItem(line)" />
          <UButton type="button" :data-confirm-item="line.key" label="Create item" icon="i-lucide-plus" @click="confirmCreateItem(line)" />
        </div>
        <div v-if="line.expanded" class="receipt-line-details col-span-full grid grid-cols-[minmax(180px,1fr)_minmax(240px,2fr)_auto] items-start gap-4.5 p-[4px_0_3px]">
          <UFormField label="Category" :name="`category-${line.key}`" class="field relative grid min-w-0 gap-[7px]">
            <div class="receipt-category-field">
              <CategoryInput :data-line-category="line.key" :aria-describedby="`category-scope-${line.key}`" v-model="line.category" :items="categoryChoices" @change="changeCategory(line, $event)" @tab-next="focusLineNotes(line)" />
              <small :id="`category-scope-${line.key}`" class="category-scope-hint leading-1.35 mt-[5px] block text-xs text-(--muted)">Applies to all purchases of this item.</small>
            </div>
          </UFormField>
          <UFormField label="Notes" :name="`notes-${line.key}`" class="field relative grid min-w-0 gap-[7px]">
            <UInput :data-line-notes="line.key" v-model="line.notes" placeholder="Optional note" :maxlength="maxEntryNotesLength" :aria-describedby="`notes-character-count-${line.key}`" :ui="{ trailing: 'pointer-events-none' }" @keydown.tab.exact.prevent="focusLineNonGrocery(line)">
              <template #trailing>
                <span :id="`notes-character-count-${line.key}`" class="text-xs text-muted tabular-nums" aria-live="polite" role="status">{{ line.notes.length }}/{{ maxEntryNotesLength }}</span>
              </template>
            </UInput>
          </UFormField>
          <USwitch :data-line-non-grocery="line.key" v-model="line.nonGrocery" label="Non-grocery" class="receipt-line-non-grocery mt-[27px]" @keydown.tab.exact.prevent="finishLine(line)" />
        </div>
        <div v-if="line.confirmingRemove" class="receipt-line-remove-confirmation col-span-full flex items-center justify-end gap-2.5 rounded-xl px-3 py-2.5 [background:color-mix(in_srgb,var(--error),transparent_93%)] [border:1px_solid_color-mix(in_srgb,var(--error),transparent_65%)]" role="alert">
          <span><strong>Remove {{ line.item }}?</strong> This saved entry will be permanently deleted.</span>
          <UButton type="button" :data-line-keep="line.key" label="Keep item" color="neutral" variant="outline" :disabled="saving" @click="cancelRemoveLine(line)" />
          <UButton type="button" label="Remove item" color="error" :loading="saving" @click="removeLine(line)" />
        </div>
        </div>
      </li>
    </ol>

    <div v-if="splitSelectionMode" class="receipt-split-selection-bar mx-6 mt-3 mb-4.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[14px] px-4 py-3 [background:var(--accent-soft)] [border:1px_solid_color-mix(in_srgb,var(--accent)_35%,var(--line))]">
      <span class="flex-[1_1_260px] text-[13px] text-(--muted)">Select the lines to move. Leave at least one line in this receipt.</span>
      <strong class="whitespace-nowrap text-[13px] text-(--accent-strong)">{{ selectedSplitLines.length }} selected</strong>
      <UButton type="button" :label="`Move ${selectedSplitLines.length} ${selectedSplitLines.length === 1 ? 'line' : 'lines'}`" icon="i-lucide-split" :disabled="!selectedSplitLines.length" @click="openSplitDialog" />
    </div>
    <UButton v-else-if="canEnterLines" type="button" label="Add another line" icon="i-lucide-plus" color="neutral" variant="outline" class="receipt-add-line mx-6 my-4" title="Add another line (Command/Control+Shift+Enter)" :disabled="hasBlankLine" @click="addLine()" />

    <div v-else class="receipt-store-prompt flex min-h-[190px] items-center justify-center gap-3.5 p-8 text-left text-(--muted)">
      <UIcon name="i-lucide-store" class="receipt-store-prompt-icon size-7 flex-[0_0_28px] text-(--accent)" aria-hidden="true" />
      <template v-if="matchingReceiptMessage">
        <UAlert color="warning" variant="soft" icon="i-lucide-receipt-text" :description="matchingReceiptMessage" />
        <UButton type="button" label="Open existing receipt" icon="i-lucide-arrow-up-right" color="warning" variant="outline" @click="openMatchingReceipt" />
              <p v-if="enteredLines.length" class="m-0"><span class="mt-[3px] block text-[13px]">Your draft lines are kept while you choose another store.</span></p>
      </template>
      <p v-else-if="checkingReceiptMatch" class="m-0"><strong class="block text-base text-(--ink)">Checking for a receipt</strong><span class="mt-[3px] block text-[13px]">Looking for existing lines for this date and store.</span></p>
      <p v-else-if="receiptMatchFailed" class="m-0"><strong class="block text-base text-(--ink)">Could not check for an existing receipt</strong><span class="mt-[3px] block text-[13px]">Retry the check before adding lines.</span></p>
      <p v-else class="m-0"><strong class="block text-base text-(--ink)">Choose or add a store</strong><span class="mt-[3px] block text-[13px]">Select a store to add or edit a receipt.</span></p>
    </div>

    <footer v-if="canEnterLines" class="receipt-entry-footer sticky bottom-0 z-5 flex items-center justify-end gap-4.5 rounded-[0_0_24px_24px] p-[16px_24px_max(16px,env(safe-area-inset-bottom))] shadow-[0_-10px_28px_rgb(34_49_38/8%)] backdrop-blur-[14px] [background:color-mix(in_srgb,var(--surface),transparent_4%)] [border-top:1px_solid_var(--line)]">
      <dl class="receipt-footer-context m-0 grid min-w-0 flex-[0_1_300px] grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] gap-3 text-left" data-receipt-footer-context aria-label="Current receipt">
        <div>
          <dt>Date</dt>
          <dd><time :datetime="form.purchasedOn">{{ dateDisplayLabel(form.purchasedOn) }}</time></dd>
        </div>
        <div>
          <dt>Store</dt>
          <dd><span :title="form.location">{{ form.location }}</span></dd>
        </div>
      </dl>
      <div v-if="hasReceipt && confirmingDelete" class="receipt-delete-confirmation" role="alert">
        <div class="receipt-delete-copy min-w-0 text-left">
          <strong>Delete this receipt?</strong>
          <span>All {{ enteredLines.length }} {{ enteredLines.length === 1 ? 'entry' : 'entries' }} will be permanently deleted.</span>
        </div>
        <UButton type="button" size="xl" label="Keep receipt" color="neutral" variant="outline" :disabled="saving" @click="confirmingDelete = false" />
        <UButton type="button" size="xl" label="Delete permanently" icon="i-lucide-trash-2" color="error" :loading="saving" @click="deleteReceipt" />
      </div>
      <template v-else>
        <UButton v-if="hasReceipt && splitSelectionMode" type="button" label="Cancel split" icon="i-lucide-x" color="neutral" variant="outline" @click="cancelSplitSelection" />
        <UButton v-else-if="hasReceipt" type="button" label="Delete receipt" icon="i-lucide-trash-2" color="error" variant="outline" :disabled="saving" @click="confirmingDelete = true" />
        <UButton v-if="hasReceipt && !splitSelectionMode" type="button" label="Export receipt" icon="i-lucide-download" color="neutral" variant="outline" :disabled="saving || !completeLines.length" @click="exportReceiptCsv" />
        <UButton v-if="hasReceipt && !splitSelectionMode && savedReceiptLines.length >= 2" type="button" label="Split receipt" icon="i-lucide-split" color="neutral" variant="outline" :disabled="!canStartSplit" @click="startSplitSelection" />
        <span v-if="hasReceipt" class="flex-1" />
        <UButton v-if="!splitSelectionMode" type="button" label="Save and add another" icon="i-lucide-receipt-text" color="primary" variant="soft" aria-keyshortcuts="Meta+Alt+Enter Control+Alt+Enter" title="Save and add another receipt (Command/Control+Alt+Enter)" :disabled="!canSaveAndAddAnother" @click="saveAndAddAnotherReceipt" />
        <div class="receipt-autosave-status" role="status" aria-live="polite">
          <UIcon :name="saving || checkingReceiptMatch ? 'i-lucide-loader-circle' : hasUnsavedChanges ? 'i-lucide-pencil-line' : 'i-lucide-cloud-check'" :class="{ spinning: saving || checkingReceiptMatch }" aria-hidden="true" />
          <span>{{ autosaveStatus }}</span>
          <UButton v-if="autosaveFailed" type="button" label="Retry" size="xs" color="error" variant="soft" @click="retryAutosave" />
        </div>
        <div class="receipt-footer-total">
          <span>{{ enteredLines.length }} {{ enteredLines.length === 1 ? 'line' : 'lines' }}</span>
          <strong>${{ receiptTotal.toFixed(2) }}</strong>
        </div>
      </template>
    </footer>

    <UAlert v-if="errorMessage" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorMessage" class="notice m-[15px_0_0] rounded-[10px] p-[11px_13px] text-sm" />
    <UButton v-if="receiptMatchFailed" type="button" label="Retry receipt check" icon="i-lucide-refresh-cw" color="error" variant="outline" class="notice m-[15px_0_0] rounded-[10px] p-[11px_13px] text-sm" @click="retryReceiptMatch" />
  </form>

  <UModal
    v-model:open="splitDialogOpen"
    :dismissible="!splitBusy"
    :close="false"
    title="Move selected lines"
    :description="`Choose where to move ${selectedSplitLines.length} ${selectedSplitLines.length === 1 ? 'line' : 'lines'}. They will be removed from this receipt.`"
  >
    <template #body>
      <div class="receipt-split-dialog grid min-w-0 gap-4.5">
        <div>
          <p class="receipt-split-source m-[0_0_8px] text-[13px] text-(--muted)">From {{ form.location }} · {{ dateDisplayLabel(form.purchasedOn) }}</p>
          <ul class="receipt-split-preview m-0 grid max-h-[190px] list-none overflow-auto rounded-xl p-0 [border:1px_solid_var(--line)]">
            <li v-for="line in selectedSplitLines" :key="line.id" class="flex items-center justify-between gap-3 border-t border-(--line) px-3 py-[9px] first:border-t-0">
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--ink)">{{ line.item }}</span>
              <strong class="shrink-0 text-(--muted) tabular-nums">${{ Number(line.price).toFixed(2) }}</strong>
            </li>
          </ul>
        </div>
        <div class="receipt-split-destination grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-3.5">
          <UFormField label="Destination date" name="splitPurchasedOn" required>
            <UInput v-model="splitPurchasedOn" data-split-date type="date" required size="lg" />
          </UFormField>
          <UFormField label="Destination store" name="splitLocation" required>
            <UInputMenu v-model="splitLocation" data-split-store :items="locationSuggestions.map(suggestion => suggestion.value)" create-item icon="i-lucide-store" placeholder="Choose or add a store…" required size="lg" @create="createSplitLocation" />
          </UFormField>
        </div>
        <UAlert v-if="splitSameAsSource" color="warning" variant="soft" icon="i-lucide-circle-alert" description="Choose a different date or store to move these lines." />
        <UAlert v-else-if="splitCheckingMatch" color="neutral" variant="soft" icon="i-lucide-loader-circle" description="Checking for a receipt at this destination…" />
        <UAlert v-else-if="splitMatchingReceipt" color="warning" variant="soft" icon="i-lucide-receipt-text" :description="`A receipt already exists for ${splitMatchingReceipt.location} on ${dateDisplayLabel(splitMatchingReceipt.purchasedOn)} with ${splitMatchingReceipt.itemCount} ${splitMatchingReceipt.itemCount === 1 ? 'item' : 'items'}.`" />
        <UButton v-if="splitMatchFailed" type="button" label="Retry destination check" icon="i-lucide-refresh-cw" color="error" variant="outline" @click="retrySplitMatch" />
        <UCheckbox v-model="splitReviewed" label="I reviewed these lines and the destination." :disabled="splitBusy" />
        <UCheckbox
          v-if="splitMatchingReceipt"
          v-model="splitIntoExistingConfirmed"
          :label="`Add these lines to the existing ${splitMatchingReceipt.itemCount}-item receipt`"
          :disabled="splitBusy"
        />
        <UAlert v-if="splitError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="splitError" />
      </div>
    </template>
    <template #footer>
      <div class="receipt-split-actions flex w-full flex-wrap justify-end gap-2">
        <UButton type="button" label="Cancel" color="neutral" variant="ghost" :disabled="splitBusy" @click="splitDialogOpen = false" />
        <UButton type="button" :label="`Move ${selectedSplitLines.length} ${selectedSplitLines.length === 1 ? 'line' : 'lines'}`" icon="i-lucide-split" :loading="splitBusy" :disabled="!canMoveSplitLines" @click="moveSelectedLines" />
      </div>
    </template>
  </UModal>

  <UModal
    :open="Boolean(pendingBackfill)"
    :dismissible="false"
    :close="false"
    title="Update previous entries?"
    :description="pendingBackfill ? backfillDescription(pendingBackfill) : ''"
  >
    <template #body>
      <div v-if="pendingBackfill" class="item-backfill-summary grid gap-4.5">
        <p class="item-backfill-proposed-label m-0 text-xs font-bold tracking-[.08em] text-(--muted) uppercase">Proposed values</p>
        <div class="item-backfill-proposed flex gap-3">
          <div v-if="pendingBackfill.size" class="grid min-w-[112px] rounded-[10px] p-3 px-4 [background:color-mix(in_srgb,var(--accent)_10%,var(--surface))] [border:1px_solid_color-mix(in_srgb,var(--accent)_45%,var(--line))]">
            <span class="text-xs font-bold tracking-[.04em] text-(--muted) uppercase">Size</span>
            <strong class="text-2xl leading-[1.2] text-(--ink)">{{ pendingBackfill.size }}</strong>
          </div>
          <div v-if="pendingBackfill.unit" class="grid min-w-[112px] rounded-[10px] p-3 px-4 [background:color-mix(in_srgb,var(--accent)_10%,var(--surface))] [border:1px_solid_color-mix(in_srgb,var(--accent)_45%,var(--line))]">
            <span class="text-xs font-bold tracking-[.04em] text-(--muted) uppercase">Unit</span>
            <strong class="text-2xl leading-[1.2] text-(--ink)">{{ pendingBackfill.unit }}</strong>
          </div>
        </div>
        <div class="item-backfill-choices grid gap-3.5">
          <UCheckbox
            v-if="pendingBackfill.size"
            v-model="backfillSizeSelected"
            label="Update missing sizes"
            :description="`${pendingBackfill.counts.size} previous ${pendingBackfill.counts.size === 1 ? 'entry' : 'entries'}`"
            :disabled="backfillBusy || !pendingBackfill.counts.size"
          />
          <UCheckbox
            v-if="pendingBackfill.unit"
            v-model="backfillUnitSelected"
            label="Update missing units"
            :description="`${pendingBackfill.counts.unit} previous ${pendingBackfill.counts.unit === 1 ? 'entry' : 'entries'}`"
            :disabled="backfillBusy || !pendingBackfill.counts.unit"
          />
        </div>
        <p class="item-backfill-note m-0 text-[13px] text-(--muted)">Existing values will not be overwritten.</p>
      </div>
    </template>
    <template #footer>
      <div v-if="pendingBackfill" class="item-backfill-actions flex w-full flex-wrap justify-end gap-2">
        <UButton type="button" color="neutral" variant="ghost" label="Keep unchanged" :disabled="backfillBusy" @click="resolveItemBackfill([])" />
        <UButton type="button" :label="`Update ${selectedBackfillCount} ${selectedBackfillCount === 1 ? 'entry' : 'entries'}`" :loading="backfillBusy" :disabled="!selectedBackfillFields.length" @click="resolveItemBackfill(selectedBackfillFields)" />
      </div>
    </template>
  </UModal>
  <ConfirmModal
    v-model:open="discardConfirmOpen"
    title="Discard unsaved receipt?"
    description="Your unsaved changes will be lost."
    confirm-label="Discard changes"
    confirm-color="error"
    @confirm="discardChanges"
  />
  <ConfirmModal
    v-if="pendingDuplicateMerge"
    :open="Boolean(pendingDuplicateMerge)"
    title="Merge duplicate receipt?"
    :description="pendingDuplicateMerge.description"
    confirm-label="Merge receipts"
    confirm-color="warning"
    @update:open="!$event && resolveDuplicateMerge(false)"
    @confirm="resolveDuplicateMerge(true)"
  />
</template>
