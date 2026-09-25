import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { csvCell, entryCsv, entryExportHeaders, entryValues } from '../app/utils/csv-export.ts'

describe('entry CSV export', () => {
  test('uses the columns accepted by the Import screen', () => {
    assert.deepEqual(entryExportHeaders, [
      'purchase_date', 'item', 'category', 'store', 'package_size', 'package_unit', 'price',
      'normalized_price', 'normalized_basis', 'on_sale', 'non_grocery', 'notes'
    ])
  })

  test('exports the item category in the shared CSV and XLSX row mapping', () => {
    assert.deepEqual(entryValues({
      purchasedOn: '2023-08-08', item: 'Peaches', category: 'Produce', location: 'Whole Foods',
      size: null, unit: null, price: '2.49', costPerUnit: null,
      saleItem: true, nonGrocery: false, notes: null
    }), ['2023-08-08', 'Peaches', 'Produce', 'Whole Foods', null, null, 2.49, null, null, true, false, null])
  })

  test('escapes commas, quotes, and line breaks while preserving simple values', () => {
    assert.equal(csvCell('Peaches'), 'Peaches')
    assert.equal(csvCell(null), '')
    assert.equal(csvCell('Fresh, "ripe"\nfruit'), '"Fresh, ""ripe""\nfruit"')
  })

  test('creates a BOM-prefixed importable document with boolean fields', () => {
    const content = entryCsv([['2023-08-08', 'Peaches', 'Produce', 'Whole Foods', null, null, 2.49, null, null, true, false, null]])
    assert.ok(content.startsWith(`\uFEFF${entryExportHeaders.join(',')}\r\n`))
    assert.ok(content.endsWith('2023-08-08,Peaches,Produce,Whole Foods,,,2.49,,,true,false,'))
  })
})
