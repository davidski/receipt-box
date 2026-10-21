// Phone-width table-to-card layout for data tables: each row becomes a card and each cell shows its
// column name from `data-label`. Spell the classes out whole so Tailwind finds them.
export const cardTable = 'max-sm:grid max-sm:gap-3 max-sm:[&_tbody]:grid max-sm:[&_tbody]:gap-3 max-sm:[&_thead]:hidden'
export const cardRow = 'max-sm:grid max-sm:gap-2.5 max-sm:rounded-card max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-4 max-sm:shadow-(--shadow)'
export const cardCell = 'max-sm:grid max-sm:gap-0.5 max-sm:border-0 max-sm:p-0 max-sm:before:label max-sm:before:content-[attr(data-label)]'
// A cell with no column name, such as a row's action link.
export const cardCellBare = 'max-sm:block max-sm:border-0 max-sm:p-0'

// Desktop table chrome shared by the history tables. A column's alignment and width go beside it at the use site.
export const tableHead = 'label bg-surface-muted px-4 py-3'
export const tableCell = 'border-t border-line px-4 py-3.75 align-middle'
export const tableRow = 'hover:bg-surface-muted/55 focus:outline-2 focus:-outline-offset-2 focus:outline-accent'
