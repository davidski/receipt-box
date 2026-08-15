<script setup lang="ts">
import { normalizedHistoricalPrice } from '../../shared/utils/normalized-price'
import { storeNameKey } from '../../shared/utils/store-name'
import { entryCsv, entryExportHeaders } from '../utils/csv-export'

type Entry = {
  purchasedOn: string
  item: string
  location: string
  size: string | null
  unit: string | null
  price: string
  costPerUnit: string | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
}

type ImportResult = { imported: number, skipped: number, errors: string[] }
type Store = { id: string, name: string, uses: number }
type ItemVariant = { name: string, uses: number, lastUsed: string }
type ItemDuplicateGroup = { id: string, variants: ItemVariant[], preferredTarget: string, reasons: string[] }
type ItemReview = { items: ItemVariant[], groups: ItemDuplicateGroup[], hiddenGroups: ItemDuplicateGroup[] }
type DimensionVariant = { size: string | null, unit: string | null, uses: number }

const { apiUrl } = useApi()
const file = ref<File | null>(null)
const importing = ref(false)
const exporting = ref<'csv' | 'xlsx' | null>(null)
const activeSection = ref<'stores' | 'items' | 'transfer' | 'maintenance'>('stores')
const result = ref<{ imported: number, skipped: number, errors: string[] } | null>(null)
const errorMessage = ref('')
const { data: stores, refresh: refreshStores } = await useFetch<Store[]>(apiUrl('/stores'))
const {
  data: duplicateItems,
  pending: duplicateItemsPending,
  error: duplicateItemsLoadError,
  status: duplicateItemsStatus,
  execute: loadDuplicateItems,
  refresh: refreshDuplicateItems
} = await useFetch<ItemReview>(apiUrl('/items/duplicates'), { immediate: false, server: false })
const newStoreName = ref('')
const editingStoreId = ref<string | null>(null)
const editingStoreName = ref('')
const storeBusy = ref(false)
const storeError = ref('')
const storeNotice = ref('')
const itemTargets = reactive<Record<string, string>>({})
const itemMergeBusy = ref<string | null>(null)
const itemMergeError = ref('')
const itemMergeNotice = ref('')
const itemReviewBusy = ref<string | null>(null)
const showHiddenItemGroups = ref(false)
const renameItemSource = ref('')
const renameItemTarget = ref('')
const itemRenameBusy = ref(false)
const itemDimensions = ref<DimensionVariant[]>([])
const itemDimensionsPending = ref(false)
const editPackageDetails = ref(false)
const dimensionScope = ref('')
const dimensionVariant = ref('')
const replacementSize = ref('')
const replacementUnit = ref('')
const visibleItemGroupCount = ref(30)
const resetConfirmation = ref('')
const resetConfirming = ref(false)
const resetBusy = ref(false)
const resetError = ref('')
const resetComplete = ref(false)
const visibleDuplicateItemGroups = computed(() => (duplicateItems.value?.groups || []).slice(0, visibleItemGroupCount.value))
const displayedHiddenItemGroups = computed(() => showHiddenItemGroups.value ? (duplicateItems.value?.hiddenGroups || []) : [])
const renameItemOptions = computed(() => (duplicateItems.value?.items || []).map(item => ({
  label: item.name,
  description: `${item.uses} ${item.uses === 1 ? 'entry' : 'entries'}`,
  value: item.name
})))
const selectedItemUses = computed(() => duplicateItems.value?.items.find(item => item.name === renameItemSource.value)?.uses || 0)
const dimensionScopeOptions = computed(() => [
  { label: 'One existing package variant', description: 'Update only entries with a specific quantity and unit.', value: 'variant' },
  { label: 'Any missing package detail', description: `${missingDimensionUses.value} matching ${missingDimensionUses.value === 1 ? 'entry' : 'entries'}`, value: 'missing' },
  { label: 'All entries for this item', description: `${selectedItemUses.value} matching ${selectedItemUses.value === 1 ? 'entry' : 'entries'}`, value: 'all' }
])
const dimensionVariantOptions = computed(() => itemDimensions.value.map((variant, index) => ({
    label: packageVariantLabel(variant),
    description: `${variant.uses} ${variant.uses === 1 ? 'entry' : 'entries'}`,
    value: `variant:${index}`
  })))
const missingDimensionUses = computed(() => itemDimensions.value.filter(variant => variant.size === null || variant.unit === null).reduce((total, variant) => total + variant.uses, 0))
const selectedDimensionVariant = computed(() => {
  if (!dimensionVariant.value.startsWith('variant:')) return null
  return itemDimensions.value[Number(dimensionVariant.value.slice(8))] || null
})
const packageUpdateCount = computed(() => {
  if (dimensionScope.value === 'all') return selectedItemUses.value
  if (dimensionScope.value === 'missing') return missingDimensionUses.value
  if (dimensionScope.value === 'variant') return selectedDimensionVariant.value?.uses || 0
  return 0
})
const nameWillChange = computed(() => Boolean(renameItemSource.value && renameItemTarget.value.trim() !== renameItemSource.value))
const packageWillChange = computed(() => editPackageDetails.value && Boolean(dimensionScope.value && Number(replacementSize.value) > 0 && replacementUnit.value.trim() && packageUpdateCount.value))
const itemEditButtonLabel = computed(() => {
  if (nameWillChange.value && packageWillChange.value) return `Rename ${selectedItemUses.value} and update ${packageUpdateCount.value} entries`
  if (nameWillChange.value) return `Rename ${selectedItemUses.value} ${selectedItemUses.value === 1 ? 'entry' : 'entries'}`
  if (packageWillChange.value) return `Update ${packageUpdateCount.value} ${packageUpdateCount.value === 1 ? 'entry' : 'entries'}`
  return 'Update item history'
})

function packageVariantLabel(variant: DimensionVariant) {
  if (variant.size === null && variant.unit === null) return 'Package details missing'
  if (variant.size === null) return `Quantity missing · ${variant.unit}`
  if (variant.unit === null) return `${Number(variant.size).toLocaleString()} · unit missing`
  return `${Number(variant.size).toLocaleString()} ${variant.unit}`
}

watch(duplicateItems, (value) => {
  for (const group of value?.groups || []) {
    if (!group.variants.some(variant => variant.name === itemTargets[group.id])) {
      itemTargets[group.id] = group.preferredTarget
    }
  }
}, { immediate: true })

function selectManageSection(section: typeof activeSection.value) {
  activeSection.value = section
  if (section === 'items' && duplicateItemsStatus.value === 'idle') {
    void loadDuplicateItems()
  }
}

function storeErrorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || error?.message || fallback
}

async function addStore() {
  const name = newStoreName.value.trim()
  if (!name) return
  storeBusy.value = true
  storeError.value = ''
  try {
    await $fetch(apiUrl('/stores'), { method: 'POST', body: { name } })
    newStoreName.value = ''
    await refreshStores()
  } catch (error: any) {
    storeError.value = storeErrorMessage(error, 'Could not add the store')
  } finally {
    storeBusy.value = false
  }
}

function startStoreEdit(store: Store) {
  editingStoreId.value = store.id
  editingStoreName.value = store.name
  storeError.value = ''
}

function cancelStoreEdit() {
  editingStoreId.value = null
  editingStoreName.value = ''
}

function storeMergeTarget(store: Store) {
  const key = storeNameKey(editingStoreName.value)
  return (stores.value || []).find(candidate => candidate.id !== store.id && storeNameKey(candidate.name) === key) || null
}

async function saveStore(store: Store) {
  const name = editingStoreName.value.trim()
  if (!name) return
  storeBusy.value = true
  storeError.value = ''
  storeNotice.value = ''
  const mergeTarget = storeMergeTarget(store)
  if (mergeTarget && !confirm(`Merge “${store.name}” into “${mergeTarget.name}”? Receipts from the same dates will be combined and all line items will be kept.`)) {
    storeBusy.value = false
    return
  }
  try {
    const saved = await $fetch<{ name: string, merged: boolean }>(apiUrl(`/stores/${store.id}`), { method: 'PATCH', body: { name } })
    storeNotice.value = saved.merged
      ? `${store.name} was merged into ${saved.name}. Receipts from matching dates were combined.`
      : `${store.name} was renamed to ${saved.name}.`
    cancelStoreEdit()
    await refreshStores()
  } catch (error: any) {
    storeError.value = storeErrorMessage(error, 'Could not rename the store')
  } finally {
    storeBusy.value = false
  }
}

async function deleteStore(store: Store) {
  if (store.uses > 0 || !confirm(`Delete “${store.name}” from the store list?`)) return
  storeBusy.value = true
  storeError.value = ''
  try {
    await $fetch(apiUrl(`/stores/${store.id}`), { method: 'DELETE' })
    await refreshStores()
  } catch (error: any) {
    storeError.value = storeErrorMessage(error, 'Could not delete the store')
  } finally {
    storeBusy.value = false
  }
}

async function mergeItemGroup(group: ItemDuplicateGroup) {
  const target = itemTargets[group.id]
  const sources = group.variants.map(variant => variant.name).filter(name => name !== target)
  if (!target || !sources.length) return
  const affectedEntries = group.variants
    .filter(variant => sources.includes(variant.name))
    .reduce((total, variant) => total + variant.uses, 0)
  if (!confirm(`Merge ${sources.map(source => `“${source}”`).join(', ')} into “${target}”? This will rename ${affectedEntries} historical ${affectedEntries === 1 ? 'entry' : 'entries'}.`)) return

  itemMergeBusy.value = group.id
  itemMergeError.value = ''
  itemMergeNotice.value = ''
  try {
    const result = await $fetch<{ target: string, mergedNames: number, mergedEntries: number }>(apiUrl('/items/merge'), {
      method: 'POST',
      body: { target, sources }
    })
    itemMergeNotice.value = `${result.mergedNames} ${result.mergedNames === 1 ? 'variant was' : 'variants were'} merged into ${result.target}, updating ${result.mergedEntries} historical ${result.mergedEntries === 1 ? 'entry' : 'entries'}.`
    await refreshDuplicateItems()
  } catch (error: any) {
    itemMergeError.value = storeErrorMessage(error, 'Could not merge the item variants')
  } finally {
    itemMergeBusy.value = null
  }
}

async function setItemGroupHidden(group: ItemDuplicateGroup, hidden: boolean) {
  itemReviewBusy.value = group.id
  itemMergeError.value = ''
  itemMergeNotice.value = ''
  try {
    await $fetch(apiUrl('/items/duplicates'), { method: 'PATCH', body: { id: group.id, hidden } })
    itemMergeNotice.value = hidden ? 'The merge suggestion was hidden.' : 'The merge suggestion was restored.'
    await refreshDuplicateItems()
  } catch (error: any) {
    itemMergeError.value = storeErrorMessage(error, hidden ? 'Could not hide the suggestion' : 'Could not restore the suggestion')
  } finally {
    itemReviewBusy.value = null
  }
}

watch(renameItemSource, async (source) => {
  renameItemTarget.value = source
  itemDimensions.value = []
  editPackageDetails.value = false
  dimensionScope.value = ''
  dimensionVariant.value = ''
  replacementSize.value = ''
  replacementUnit.value = ''
  if (!source) return
  itemDimensionsPending.value = true
  try {
    itemDimensions.value = await $fetch<DimensionVariant[]>(apiUrl('/items/dimensions'), { query: { item: source } })
  } catch (error: any) {
    itemMergeError.value = storeErrorMessage(error, 'Could not load package details for this item')
  } finally {
    itemDimensionsPending.value = false
  }
})

watch(selectedDimensionVariant, (variant) => {
  if (!variant) return
  replacementSize.value = variant.size ?? ''
  replacementUnit.value = variant.unit ?? ''
})

async function renameItem() {
  const source = renameItemSource.value
  const target = renameItemTarget.value.trim()
  if (!source || !target || (!nameWillChange.value && !packageWillChange.value)) return
  const uses = duplicateItems.value?.items.find(item => item.name === source)?.uses || 0
  const changes = [
    nameWillChange.value ? `rename all ${uses} ${uses === 1 ? 'instance' : 'instances'} of “${source}” to “${target}”` : '',
    packageWillChange.value ? `change ${packageUpdateCount.value} matching ${packageUpdateCount.value === 1 ? 'entry' : 'entries'} to ${replacementSize.value} ${replacementUnit.value.trim()}` : ''
  ].filter(Boolean).join(' and ')
  if (!confirm(`This will ${changes}. Continue?`)) return
  itemRenameBusy.value = true
  itemMergeError.value = ''
  itemMergeNotice.value = ''
  try {
    const variant = selectedDimensionVariant.value
    const dimensions = packageWillChange.value ? {
      scope: dimensionScope.value,
      matchSize: variant?.size === null ? null : variant?.size,
      matchUnit: variant?.unit ?? null,
      size: replacementSize.value,
      unit: replacementUnit.value
    } : undefined
    const result = await $fetch<{ target: string, renamedEntries: number, updatedEntries: number }>(apiUrl('/items/rename'), {
      method: 'PATCH', body: { source, target, dimensions }
    })
    itemMergeNotice.value = [
      result.renamedEntries ? `${result.renamedEntries} ${result.renamedEntries === 1 ? 'entry was' : 'entries were'} renamed to ${result.target}` : '',
      result.updatedEntries ? `${result.updatedEntries} ${result.updatedEntries === 1 ? 'entry was' : 'entries were'} updated to ${replacementSize.value} ${replacementUnit.value.trim()}` : ''
    ].filter(Boolean).join('; ') + '.'
    renameItemSource.value = ''
    renameItemTarget.value = ''
    await refreshDuplicateItems()
  } catch (error: any) {
    itemMergeError.value = storeErrorMessage(error, 'Could not rename the item')
  } finally {
    itemRenameBusy.value = false
  }
}

function beginDatabaseReset() {
  resetConfirmation.value = ''
  resetError.value = ''
  resetComplete.value = false
  resetConfirming.value = true
}

function cancelDatabaseReset() {
  resetConfirmation.value = ''
  resetError.value = ''
  resetConfirming.value = false
}

async function resetDatabase() {
  if (resetConfirmation.value !== 'RESET') return
  resetBusy.value = true
  resetError.value = ''
  resetComplete.value = false
  try {
    await $fetch(apiUrl('/maintenance/reset'), {
      method: 'POST',
      body: { confirmation: resetConfirmation.value }
    })
    resetConfirmation.value = ''
    resetConfirming.value = false
    resetComplete.value = true
    await refreshStores()
  } catch (error: any) {
    resetError.value = storeErrorMessage(error, 'Could not reset the database')
  } finally {
    resetBusy.value = false
  }
}

function selectFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] || null
  result.value = null
  errorMessage.value = ''
}

async function importFile() {
  if (!file.value) return
  importing.value = true
  errorMessage.value = ''
  result.value = null
  try {
    const records = await parseImportFile(file.value)
    const aggregate = { imported: 0, skipped: 0, errors: [] as string[] }
    for (let offset = 0; offset < records.length; offset += 500) {
      const response = await $fetch<ImportResult>(apiUrl('/import'), {
        method: 'POST',
        body: { records: records.slice(offset, offset + 500) }
      })
      aggregate.imported += response.imported
      aggregate.skipped += response.skipped
      aggregate.errors.push(...response.errors)
    }
    result.value = aggregate
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Import failed'
  } finally {
    importing.value = false
  }
}

function cleanHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_|_$/g, '')
}

function unwrapCell(value: unknown) {
  if (value && typeof value === 'object' && 'result' in value) return (value as { result: unknown }).result
  return value
}

function canonicalRecord(record: Record<string, unknown>) {
  const aliases: Record<string, string> = {
    food_date: 'food_Date', date: 'food_Date', purchase_date: 'food_Date', item: 'Item', location: 'Location', store: 'Location',
    size: 'Size', package_size: 'Size', unit: 'Unit', package_unit: 'Unit', price: 'Price', cost_per_unit: 'Cost_Per_Unit',
    sale_item: 'Sale_Item', sale: 'Sale_Item', on_sale: 'Sale_Item', non_grocery: 'Non_Grocery', notes: 'Notes'
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [aliases[cleanHeader(key)] ?? key, unwrapCell(value)]))
}

async function parseImportFile(source: File) {
  if (source.size > 25 * 1024 * 1024) throw new Error('File must be smaller than 25 MB')
  const extension = source.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') {
    const { parse } = await import('csv-parse/browser/esm/sync')
    const records = parse(await source.text(), { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Record<string, unknown>[]
    return records.map(canonicalRecord)
  }
  if (extension !== 'xlsx') throw new Error('Only CSV and XLSX files are supported')

  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await source.arrayBuffer())
  const worksheet = workbook.worksheets.find((candidate) => {
    const headers = (candidate.getRow(1).values as unknown[]).slice(1).map(cleanHeader)
    return headers.includes('item') && headers.includes('price')
  })
  if (!worksheet) throw new Error('No sheet with Item and Price columns was found')

  const headers = (worksheet.getRow(1).values as unknown[]).slice(1).map(value => String(value ?? ''))
  const records: Record<string, unknown>[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = (row.values as unknown[]).slice(1)
    if (!values.some(value => value !== null && value !== undefined && value !== '')) return
    records.push(canonicalRecord(Object.fromEntries(headers.map((header, index) => [header, values[index]]))))
  })
  return records
}

async function fetchAllEntries() {
  const entries: Entry[] = []
  let total = 1
  while (entries.length < total) {
    const response = await $fetch<{ entries: Entry[], total: number }>(apiUrl('/entries'), {
      query: { limit: 5000, offset: entries.length }
    })
    entries.push(...response.entries)
    total = response.total
    if (!response.entries.length) break
  }
  return entries.reverse()
}

function entryValues(entry: Entry): (string | number | boolean | Date | null)[] {
  const normalized = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
  return [
    entry.purchasedOn, entry.item, entry.location,
    entry.size === null ? null : Number(entry.size), entry.unit, Number(entry.price),
    normalized ? Number(normalized.value.toFixed(6)) : null,
    normalized?.label ?? null,
    entry.saleItem, entry.nonGrocery, entry.notes
  ]
}

function download(blob: Blob, extension: string, basename = `receipt-box-${new Date().toISOString().slice(0, 10)}`) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${basename}.${extension}`
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadCsvTemplate() {
  download(new Blob([entryCsv([])], { type: 'text/csv;charset=utf-8' }), 'csv', 'receipt-box-template')
}

async function exportCsv() {
  exporting.value = 'csv'
  errorMessage.value = ''
  try {
    const entries = await fetchAllEntries()
    const content = entryCsv(entries.map(entryValues))
    download(new Blob([content], { type: 'text/csv;charset=utf-8' }), 'csv')
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Export failed'
  } finally {
    exporting.value = null
  }
}

async function exportXlsx() {
  exporting.value = 'xlsx'
  errorMessage.value = ''
  try {
    const entries = await fetchAllEntries()
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Receipt Box'
    const sheet = workbook.addWorksheet('Purchases', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRow(entryExportHeaders)
    for (const entry of entries) {
      const values = entryValues(entry)
      values[0] = parseCalendarDate(entry.purchasedOn) || entry.purchasedOn
      sheet.addRow(values)
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF295C3B' } }
    sheet.autoFilter = { from: 'A1', to: 'K1' }
    sheet.columns = [
      { width: 15 }, { width: 34 }, { width: 20 }, { width: 15 }, { width: 15 },
      { width: 12 }, { width: 18 }, { width: 20 }, { width: 12 }, { width: 14 }, { width: 38 }
    ]
    sheet.getColumn(1).numFmt = 'yyyy-mm-dd'
    sheet.getColumn(6).numFmt = '$0.00'
    sheet.getColumn(7).numFmt = '$0.0000'
    download(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'xlsx')
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.message || 'Export failed'
  } finally {
    exporting.value = null
  }
}
</script>

<template>
  <div class="content-page">
    <header class="page-heading">
      <p class="eyebrow">Receipt Box settings</p>
      <h1>Manage Receipt Box</h1>
    </header>

    <nav class="manage-sections" aria-label="Receipt Box management sections">
      <UButton
        type="button"
        label="Stores"
        icon="i-lucide-store"
        size="lg"
        :variant="activeSection === 'stores' ? 'solid' : 'ghost'"
        :color="activeSection === 'stores' ? 'primary' : 'neutral'"
        :aria-current="activeSection === 'stores' ? 'page' : undefined"
        @click="activeSection = 'stores'"
      />
      <UButton
        type="button"
        label="Items"
        icon="i-lucide-package-search"
        size="lg"
        :variant="activeSection === 'items' ? 'solid' : 'ghost'"
        :color="activeSection === 'items' ? 'primary' : 'neutral'"
        :aria-current="activeSection === 'items' ? 'page' : undefined"
        @click="selectManageSection('items')"
      />
      <UButton
        type="button"
        label="Import & export"
        icon="i-lucide-arrow-left-right"
        size="lg"
        :variant="activeSection === 'transfer' ? 'solid' : 'ghost'"
        :color="activeSection === 'transfer' ? 'primary' : 'neutral'"
        :aria-current="activeSection === 'transfer' ? 'page' : undefined"
        @click="activeSection = 'transfer'"
      />
      <UButton
        type="button"
        label="Maintenance"
        icon="i-lucide-wrench"
        size="lg"
        :variant="activeSection === 'maintenance' ? 'solid' : 'ghost'"
        :color="activeSection === 'maintenance' ? 'primary' : 'neutral'"
        :aria-current="activeSection === 'maintenance' ? 'page' : undefined"
        @click="activeSection = 'maintenance'"
      />
    </nav>

    <UCard v-if="activeSection === 'stores'" class="data-card store-card" :ui="{ body: 'contents' }">
      <div class="data-icon" aria-hidden="true"><UIcon name="i-lucide-store" /></div>
      <div>
        <h2>Manage stores</h2>
        <p>Add stores before shopping, correct their names, or merge duplicates by renaming one to an existing store. Renaming updates every matching history entry.</p>
        <form class="store-add" @submit.prevent="addStore">
          <UInput v-model="newStoreName" aria-label="New store name" placeholder="New store name" size="lg" />
          <UButton class="touch-target" type="submit" label="Add store" icon="i-lucide-plus" :disabled="!newStoreName.trim()" :loading="storeBusy && !editingStoreId" />
        </form>
        <UAlert v-if="storeError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="storeError" class="notice" />
        <UAlert v-if="storeNotice" color="success" variant="soft" icon="i-lucide-circle-check" :description="storeNotice" class="notice" />
        <p class="store-help">Stores with purchase history can be renamed or merged. Only unused stores can be deleted.</p>
        <ul class="store-list">
          <li v-for="store in stores || []" :key="store.id">
            <form v-if="editingStoreId === store.id" class="store-edit" @submit.prevent="saveStore(store)">
              <UInput v-model="editingStoreName" :aria-label="`Rename ${store.name}`" autofocus />
              <UButton type="submit" :label="storeMergeTarget(store) ? 'Merge' : 'Save'" :icon="storeMergeTarget(store) ? 'i-lucide-git-merge' : undefined" size="sm" :disabled="!editingStoreName.trim()" :loading="storeBusy" />
              <UButton type="button" label="Cancel" size="sm" color="neutral" variant="ghost" @click="cancelStoreEdit" />
            </form>
            <template v-else>
              <div class="store-name"><strong>{{ store.name }}</strong><span>{{ store.uses.toLocaleString() }} {{ store.uses === 1 ? 'entry' : 'entries' }}</span></div>
              <div class="store-actions">
                <UButton class="touch-target" type="button" label="Rename" icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="startStoreEdit(store)" />
                <UButton class="touch-target" type="button" label="Delete" icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" :disabled="store.uses > 0" :title="store.uses > 0 ? 'Rename this store to merge its existing entries before deleting it.' : `Delete ${store.name}`" @click="deleteStore(store)" />
              </div>
            </template>
          </li>
        </ul>
      </div>
    </UCard>

    <UCard v-else-if="activeSection === 'items'" class="data-card item-editor-card" :ui="{ body: 'contents' }">
      <div class="data-icon" aria-hidden="true"><UIcon name="i-lucide-package-search" /></div>
      <div>
        <h2>Edit item history</h2>
        <p>Rename an item everywhere and, when needed, update package details for only the matching entries.</p>

        <form class="item-history-editor" @submit.prevent="renameItem">
          <label class="field">
            <span>Item to edit</span>
            <USelectMenu
              v-model="renameItemSource"
              :items="renameItemOptions"
              value-key="value"
              label-key="label"
              description-key="description"
              placeholder="Choose an item"
              :search-input="{ placeholder: 'Search items…' }"
              virtualize
              size="xl"
            />
          </label>
          <label class="field">
            <span>Item name</span>
            <UInput v-model="renameItemTarget" aria-label="Item name" :disabled="!renameItemSource" size="xl" />
          </label>

          <div v-if="renameItemSource" class="item-package-toggle">
            <UCheckbox v-model="editPackageDetails" label="Also update package quantity and unit" description="Choose exactly which historical package variant should change." />
          </div>

          <div v-if="editPackageDetails" class="item-package-editor">
            <label class="field">
              <span>Update scope</span>
              <USelectMenu
                v-model="dimensionScope"
                :items="dimensionScopeOptions"
                value-key="value"
                label-key="label"
                description-key="description"
                placeholder="Choose which entries to update"
                :loading="itemDimensionsPending"
                size="xl"
              />
            </label>
            <label v-if="dimensionScope === 'variant'" class="field">
              <span>Existing package variant</span>
              <USelectMenu
                v-model="dimensionVariant"
                :items="dimensionVariantOptions"
                value-key="value"
                label-key="label"
                description-key="description"
                placeholder="Choose quantity and unit"
                :loading="itemDimensionsPending"
                size="xl"
              />
            </label>
            <label class="field">
              <span>New quantity</span>
              <UInput v-model="replacementSize" type="number" min="0.001" step="any" inputmode="decimal" placeholder="5" size="xl" />
            </label>
            <UFormField label="New unit" class="field">
              <UnitInput v-model="replacementUnit" />
            </UFormField>
          </div>

          <div v-if="nameWillChange || packageWillChange" class="item-edit-preview">
            <UIcon name="i-lucide-list-checks" />
            <div>
              <strong>Review this change</strong>
              <span v-if="nameWillChange">Rename all {{ selectedItemUses }} {{ selectedItemUses === 1 ? 'entry' : 'entries' }} from “{{ renameItemSource }}” to “{{ renameItemTarget.trim() }}”.</span>
              <span v-if="packageWillChange">Change {{ packageUpdateCount }} matching {{ packageUpdateCount === 1 ? 'entry' : 'entries' }} to {{ replacementSize }} {{ replacementUnit.trim() }}. Normalized prices will be recalculated.</span>
            </div>
          </div>

          <div class="item-edit-action">
            <UButton type="submit" :label="itemEditButtonLabel" icon="i-lucide-pencil" :loading="itemRenameBusy" :disabled="!renameItemSource || !renameItemTarget.trim() || (!nameWillChange && !packageWillChange)" />
          </div>
        </form>

        <div class="item-review-heading">
          <h3>Review likely duplicate names</h3>
          <p>Choose the name to keep for each suggested group.</p>
        </div>

        <UAlert v-if="itemMergeError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="itemMergeError" class="notice" />
        <UAlert v-if="itemMergeNotice" color="success" variant="soft" icon="i-lucide-circle-check" :description="itemMergeNotice" class="notice" />
        <UAlert v-if="duplicateItemsLoadError" color="error" variant="soft" icon="i-lucide-circle-alert" description="Could not check item names for duplicates." class="notice">
          <template #actions><UButton type="button" label="Try again" color="neutral" variant="outline" size="sm" @click="loadDuplicateItems()" /></template>
        </UAlert>

        <div v-if="duplicateItemsPending" class="item-review-state"><UIcon name="i-lucide-loader-circle" class="spinning" /><span>Checking item names…</span></div>
        <div v-else-if="!duplicateItemsLoadError && !duplicateItems?.groups.length && !duplicateItems?.hiddenGroups.length" class="item-review-empty">
          <UIcon name="i-lucide-circle-check-big" />
          <div><strong>No likely duplicates</strong><span>Your item names look consistent.</span></div>
        </div>
        <template v-else-if="!duplicateItemsLoadError">
          <p class="item-review-summary">Showing {{ visibleDuplicateItemGroups.length }} of {{ duplicateItems?.groups.length || 0 }} suggestions, ordered by purchase history.</p>
          <ul class="item-duplicate-list">
          <li v-for="group in visibleDuplicateItemGroups" :key="group.id">
            <div class="item-duplicate-heading">
              <div>
                <strong>{{ group.variants.length }} similar names</strong>
                <span>{{ group.reasons.join(' · ') }}</span>
              </div>
              <UBadge :label="`${group.variants.reduce((total, variant) => total + variant.uses, 0)} entries`" color="neutral" variant="soft" />
            </div>
            <div class="item-variant-list">
              <label v-for="variant in group.variants" :key="variant.name" :class="{ selected: itemTargets[group.id] === variant.name }">
                <input v-model="itemTargets[group.id]" type="radio" :name="`item-target-${group.id}`" :value="variant.name">
                <span><strong>{{ variant.name }}</strong><small>{{ variant.uses }} {{ variant.uses === 1 ? 'entry' : 'entries' }} · last used {{ variant.lastUsed }}</small></span>
                <span class="item-target-label">{{ itemTargets[group.id] === variant.name ? 'Keep this name' : 'Merge this name' }}</span>
              </label>
            </div>
            <div class="item-merge-action">
              <span>The other {{ group.variants.length - 1 }} {{ group.variants.length === 2 ? 'name' : 'names' }} will be replaced throughout purchase history.</span>
              <div class="item-review-actions">
                <UButton type="button" label="Hide suggestion" icon="i-lucide-eye-off" color="neutral" variant="ghost" :loading="itemReviewBusy === group.id" :disabled="itemMergeBusy !== null || itemReviewBusy !== null" @click="setItemGroupHidden(group, true)" />
                <UButton type="button" label="Merge variants" icon="i-lucide-git-merge" :loading="itemMergeBusy === group.id" :disabled="itemMergeBusy !== null || itemReviewBusy !== null" @click="mergeItemGroup(group)" />
              </div>
            </div>
          </li>
          </ul>
          <UButton
            v-if="visibleDuplicateItemGroups.length < (duplicateItems?.groups.length || 0)"
            class="item-show-more"
            type="button"
            label="Show 30 more"
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="outline"
            @click="visibleItemGroupCount += 30"
          />
          <div v-if="duplicateItems?.hiddenGroups.length" class="item-hidden-section">
            <UButton type="button" :label="showHiddenItemGroups ? 'Hide dismissed suggestions' : `Show ${duplicateItems.hiddenGroups.length} hidden ${duplicateItems.hiddenGroups.length === 1 ? 'suggestion' : 'suggestions'}`" :icon="showHiddenItemGroups ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="outline" @click="showHiddenItemGroups = !showHiddenItemGroups" />
            <ul v-if="displayedHiddenItemGroups.length" class="item-hidden-list">
              <li v-for="group in displayedHiddenItemGroups" :key="group.id">
                <span><strong>{{ group.variants.map(variant => variant.name).join(' · ') }}</strong><small>{{ group.variants.reduce((total, variant) => total + variant.uses, 0) }} entries</small></span>
                <UButton type="button" label="Unhide" icon="i-lucide-undo-2" color="neutral" variant="ghost" :loading="itemReviewBusy === group.id" :disabled="itemReviewBusy !== null" @click="setItemGroupHidden(group, false)" />
              </li>
            </ul>
          </div>
        </template>
      </div>
    </UCard>

    <section v-else-if="activeSection === 'transfer'" class="transfer-section" aria-label="Import and export tools">
      <UCard class="data-card" :ui="{ body: 'contents' }">
        <div class="data-icon" aria-hidden="true">↑</div>
        <div>
          <h2>Import spreadsheet</h2>
          <p>Use an XLSX exported from Numbers, a Receipt Box export, or a CSV based on the provided template. Existing entries are left untouched.</p>
          <div class="import-controls">
            <label class="file-picker">
              <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="selectFile">
              <span>{{ file?.name || 'Choose CSV or XLSX' }}</span>
            </label>
            <UButton class="touch-target" type="button" icon="i-lucide-upload" label="Import" :disabled="!file" :loading="importing" @click="importFile" />
          </div>
          <UButton class="touch-target" type="button" label="Download CSV template" icon="i-lucide-download" color="neutral" variant="ghost" @click="downloadCsvTemplate" />
          <UAlert v-if="result" color="success" variant="soft" icon="i-lucide-circle-check" :description="`Imported ${result.imported.toLocaleString()} rows${result.skipped ? `; skipped ${result.skipped}` : ''}.`" class="notice" />
          <UAlert v-if="errorMessage" color="error" variant="soft" icon="i-lucide-circle-alert" :description="errorMessage" class="notice" />
        </div>
      </UCard>

      <UCard class="data-card" :ui="{ body: 'contents' }">
        <div class="data-icon" aria-hidden="true">↓</div>
        <div>
          <h2>Export all data</h2>
          <p>Both formats include one row per purchase in a clean, flat table with consistent field names and self-describing normalized prices.</p>
          <div class="export-buttons">
            <UButton class="touch-target" type="button" label="Download CSV" icon="i-lucide-file-text" color="neutral" variant="outline" :loading="exporting === 'csv'" @click="exportCsv" />
            <UButton class="touch-target" type="button" label="Download XLSX" icon="i-lucide-file-spreadsheet" :loading="exporting === 'xlsx'" @click="exportXlsx" />
          </div>
        </div>
      </UCard>
    </section>

    <section v-else class="transfer-section" aria-label="Maintenance tools">
      <UCard class="data-card maintenance-card" :ui="{ body: 'contents' }">
        <div class="data-icon danger-icon" aria-hidden="true"><UIcon name="i-lucide-database-zap" /></div>
        <div>
          <h2>Reset database</h2>
          <p>Delete every receipt, purchase entry, and store so you can start with a fresh database. This cannot be undone.</p>

          <UAlert v-if="resetComplete" color="success" variant="soft" icon="i-lucide-circle-check" description="The database was reset. Receipt Box is ready for fresh data." class="notice" />
          <UAlert v-if="resetError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="resetError" class="notice" />

          <div v-if="resetConfirming" class="reset-confirmation">
            <label class="field">
              <span>Type <strong>RESET</strong> to confirm</span>
              <UInput v-model="resetConfirmation" autocomplete="off" :spellcheck="false" placeholder="RESET" aria-label="Type RESET to confirm database reset" />
            </label>
            <div class="reset-actions">
              <UButton type="button" label="Cancel" color="neutral" variant="ghost" :disabled="resetBusy" @click="cancelDatabaseReset" />
              <UButton type="button" label="Permanently reset database" icon="i-lucide-trash-2" color="error" :disabled="resetConfirmation !== 'RESET'" :loading="resetBusy" @click="resetDatabase" />
            </div>
          </div>
          <UButton v-else class="reset-button" type="button" label="Reset database" icon="i-lucide-trash-2" color="error" variant="outline" @click="beginDatabaseReset" />
        </div>
      </UCard>
    </section>

  </div>
</template>
