import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const [receiptForm, historyPage] = await Promise.all([
  readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8'),
  readFile(new URL('../app/components/HistoryPage.vue', import.meta.url), 'utf8')
])

describe('entry notes character limit', () => {
  test('shows the Nuxt UI trailing counter and enforces maxlength in every notes editor', () => {
    const fields = [
      [receiptForm.match(/<UInput :data-line-notes="line\.key"[\s\S]*?<\/UInput>/)?.[0], 'line.notes.length'],
      [historyPage.match(/<UTextarea id="edit-notes"[\s\S]*?<\/UTextarea>/)?.[0], 'editingNotes.length']
    ]

    for (const [field, count] of fields) {
      assert.ok(field)
      assert.match(field, /:maxlength="maxEntryNotesLength"/)
      assert.match(field, /<template #trailing>/)
      assert.match(field, /aria-live="polite"/)
      assert.ok(field.includes('{{ ' + count + ' }}/{{ maxEntryNotesLength }}'))
    }
  })
})
