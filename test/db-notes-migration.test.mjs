import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const db = await readFile(new URL('../server/utils/db.ts', import.meta.url), 'utf8')

describe('notes database migration', () => {
  test('truncates legacy notes before adding a database length constraint', () => {
    assert.match(db, /notes TEXT CONSTRAINT grocery_entries_notes_length_check\s+CHECK \(notes IS NULL OR char_length\(notes\) <= 100\)/)
    const truncate = db.indexOf('UPDATE grocery_entries\n        SET notes = left(notes, ${maxEntryNotesLength})')
    const addConstraint = db.indexOf('ADD CONSTRAINT grocery_entries_notes_length_check')

    assert.notEqual(truncate, -1)
    assert.ok(truncate < addConstraint)
    assert.match(db, /WHERE char_length\(notes\) > \$\{maxEntryNotesLength\}/)
    assert.match(db, /WHERE conname = 'grocery_entries_notes_length_check'/)
  })
})
