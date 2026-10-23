# Clearline Design System

## Purpose

Clearline is the visual system for Receipt Box. Surfaces are neutral, one petrol accent marks actions and selection, in the same hue in both themes, and the signal colors have fixed meanings: amber means sale, red means destructive or a price increase, and green means a price decrease. In dark mode, green and amber share one chroma level so they read as a set; red holds as much color as a 7:1 light red can. Light and dark themes use the same token names, so a new view picks up both themes by using those names, not by picking colors. Each theme still needs its own check; see [Accessibility](#accessibility).

## Where values live

- `app/assets/css/main.css` defines the theme tokens as CSS custom properties, with light and dark values. An `@theme inline` block after the imports exposes them to Tailwind. The same file defines the radius names, the font stacks (in a plain `@theme` block), and the `label` utility.
- `app/app.config.ts` sets the Nuxt UI color aliases: primary is teal and neutral is slate, the closest stock palettes. These only supply fallback shades; `main.css` points Nuxt UI's `--ui-*` variables (primary, error, success, warning, text, background, border) at the theme tokens. The solid primary button and the shared input style are also set there. Other Nuxt UI components and variants are checked when they are first used; do not assume the aliases make every variant meet the contrast targets.
- `nuxt.config.ts` loads Figtree from Bunny Fonts.

Token names are stable. Change a value in `main.css`; do not rename a token to suit one screen. Components never hardcode a color for one theme.

This document never repeats hex values. Read the token in `main.css` when you need one.

## Color roles

Use the utility, not a raw value.

| Token | Utility | Use for |
|---|---|---|
| `bg` | `bg-bg` | Page background behind all content. |
| `surface` | `bg-surface` | Cards, inputs, menus, and other raised panels. |
| `surface-muted` | `bg-surface-muted` | Table headers and subtle fills. |
| `ink` | `text-ink` | Primary text. |
| `muted` | `text-muted` | Secondary text, metadata, and labels. |
| `line` | `border-line` | Dividers and card edges. Decorative only. |
| `line-control` | `border-line-control` | Edges of inputs, selects, and other controls, where the border is how you find the control. |
| `placeholder` | `text-placeholder` | Placeholder text. Nuxt UI uses it as its dimmed text color. |
| `accent` | `text-accent` | Accent text: links, active labels, and icons. |
| `accent-strong` | `text-accent-strong` | Emphasis text and totals. |
| `accent-soft` | `bg-accent-soft` | Selected rows and soft fills. |
| `accent-fill` | `bg-accent-fill` | Solid fills: primary buttons and the selected calendar day. |
| `accent-fill-hover` | `bg-accent-fill-hover` | Hover and pressed state of `accent-fill`. |
| `on-accent-fill` | `text-on-accent-fill` | Text and icons on `accent-fill` and `accent-fill-hover`. |
| `focus-ring` | `outline-(--focus-ring)` | Keyboard focus outline. Opaque, so it keeps 3:1 on every surface. |
| `chart-series` | `fill-chart-series`, `stroke-chart-series`, `bg-chart-series` | The main data series in charts: lines, points, bars, and sparklines. In light mode it is `accent`; in dark mode it is the fill tone, because the 7:1 text accent is too pale and glares as large bars. |
| `sale-mark` | `fill-sale-mark` | Sale prices in charts. Darker than a chip fill in light mode, so the mark keeps 3:1. |
| `danger` | `bg-danger`, `text-danger` | Destructive actions and price increases. |
| `danger-soft` | `bg-danger-soft` | Fill behind destructive and increase states. |
| `success` | `text-success` | Success text and price decreases. Nuxt UI's `success` color reads it. |
| `warning` | `text-warning` | Warning text and the sale chip. Nuxt UI's `warning` color reads it. |

Menus and modals take their shadow from the `--shadow` token through `var(--shadow)`. There is no shadow utility.

Retired names exist only so older code keeps working: `surface-strong` (use `surface`), `surface-soft` (use `surface-muted`), and `error` (use `danger`). Do not use them in new code.

## Units

Sizes are written in rem, so text, controls, and spacing grow with the text size a person sets in their browser. Pixel values ignore that setting, while page zoom scales both. Relative units help but do not by themselves guarantee that a page survives large text; see [Accessibility](#accessibility) for the checks.

- **rem** for font sizes, the type scale, control heights, spacing, widths, corner radii, and grid tracks. This is the default.
- **em** for values that should follow the text they sit in rather than the root size: letter-spacing, an icon sized to its label, and padding inside a chip.
- **px** only for hairlines and effects that should stay fixed at any text size: border and outline widths, focus-ring width and offset, shadows, and SVG stroke widths.
- **Chart geometry** (point radius, line width, hit targets) is in SVG user units. Charts size their viewBox to the rendered width, so one unit is one CSS pixel. Check the rendered size if you change that.
- The display title also uses `vw` so it can shrink on narrow screens.
- `html` and `body` never set a pixel font size. The root stays at the browser default.
- Breakpoints still use px. They move to Tailwind's rem breakpoints during the per-area cleanup.

This document gives a value as rem with its pixel equivalent at the default 16px in brackets, such as 2.75rem (44px). The rem is the rule; the pixel figure is for reading.

## Accessibility

The baseline is **WCAG 2.2 level AA**. On top of that, the app adopts named AAA targets for text contrast and a few comfort sizes. Decided October 2026.

### Contrast

Contrast is computed with the WCAG relative-luminance formula. `test/theme-contrast.test.mjs` checks this matrix in both themes, and fails if a value slips:

| Foreground | Backgrounds | Target |
|---|---|---|
| `ink`, `muted`, `accent`, `accent-strong`, `danger`, `success`, `warning` | `bg`, `surface`, `surface-muted`, and the token's own soft fill or Nuxt UI 10% tint | 7:1 (AAA, WCAG 1.4.6) |
| `ink` | `accent-soft`, `danger-soft` | 7:1 |
| `muted` | `accent-soft`, `danger-soft` | 4.5:1 (AA). It falls below 7:1 on these tinted fills in the light theme, so sentences on them use `ink`, as the receipt editor's confirmations and split bar do. |
| `on-accent-fill` | `accent-fill` and `accent-fill-hover` | 7:1 |
| Text on danger buttons | `danger` | 7:1 |
| `placeholder` | `bg`, `surface`, `surface-muted` | 4.5:1 (AA, WCAG 1.4.3) |
| `line-control`, `focus-ring`, chart marks (`chart-series`, `sale-mark`) | `bg`, `surface`, `surface-muted` | 3:1 (AA, WCAG 1.4.11) |

When you add a token, a pair, or an interaction state that is not in this matrix, add it to the test before you merge. States never use opacity on a fill that carries text, because the result is not in the matrix; give the state its own token instead, as `accent-fill-hover` does.

### Decisions and their reasons

- **Text meets 7:1.** Prices are scanned for small differences, so the app aims above the AA minimum. This applies to headings too, which is stricter than WCAG requires.
- **Placeholders meet 4.5:1, not 7:1.** At 7:1 a placeholder is harder to tell apart from typed text. That is a product choice, not a WCAG rule. Every field still has a visible label, and placeholders only hold optional examples, never instructions or the field's name.
- **Control edges meet 3:1** (WCAG 1.4.11). `line-control` outlines inputs, selects, checkboxes, and the file picker. Dividers and card edges use the fainter `line`, because they don't identify a control. Checked, selected, and focused states must also be visible at 3:1.
- **Accent text and accent fills are separate tokens.** In dark mode, accent text has to be very light to reach 7:1. The fill is a mid-tone petrol with near-black `on-accent-fill` text, so buttons stay a solid color instead of a pale wash. Both dark tokens share one muted, slightly green-leaning petrol hue, so they read as the light-mode petrol under low light. In light mode both tokens resolve to the same deep petrol. `--ui-primary` maps to the text accent; `app.config.ts` overrides solid primary buttons to use the fill tokens.
- **Muted text sits close to body text in light mode.** At AAA, `muted` is about 2:1 from `ink`. Secondary text is set apart by size and weight as well as color.
- **Text spacing.** The app does not adopt the AAA presentation defaults in WCAG 1.4.8, such as 1.5 line spacing everywhere. It does meet WCAG 1.4.12 (AA): nothing is cut off or overlaps when a person overrides line height to 1.5, paragraph spacing to 2em, letter spacing to 0.12em, and word spacing to 0.16em.
- **Disabled controls are exempt** from contrast requirements (WCAG 1.4.3). They use reduced opacity. When the reason a control is disabled is not obvious, say why in nearby text.

### Interaction baseline

- **Focus.** Every interactive element shows a visible focus outline in `focus-ring`, 3px wide with a 2px offset (WCAG 2.4.7). A sticky bar or menu never fully hides the focused element (WCAG 2.4.11). Do not remove an outline without replacing it.
- **Keyboard.** Everything works with the keyboard alone. Menus, comboboxes, and dialogs follow the WAI-ARIA Authoring Practices patterns that Nuxt UI implements: dialogs take focus when they open, keep it inside, close on Escape, and return focus to the control that opened them.
- **Names.** Actions are buttons; navigation is links. Icon-only buttons have an accessible name. Decorative icons are hidden from assistive technology.
- **Labels.** Every field has a visible label that stays visible while typing. Placeholders never replace labels.
- **Errors.** An error names the field and says how to fix it, in text next to the field and tied to it programmatically, which Nuxt UI's form field does through its `error` prop (WCAG 3.3.1, 3.3.3). Never clear what a person typed because of an error.
- **Status.** Saving, autosave results, and other background changes are announced without moving focus, with a `role="status"` live region (WCAG 4.1.3). Destructive actions ask for confirmation in place, as the receipt delete does.
- **Links.** Links inside running text are underlined at rest, not only on hover, because the accent is close to body text in lightness (WCAG 1.4.1). Navigation and table row links can rely on position and context instead.
- **Motion.** Transitions are short and only respond to something the person did. Animations that loop or move on their own are turned off with Tailwind's `motion-reduce:` variant. Loading spinners are the exception: they show that work is in progress, which WCAG 2.3.3 counts as essential.
- **Themes.** The app follows the system light or dark setting until the person picks one with the header toggle, which is remembered. Check new work in both themes, including focus, selected states, and charts.
- **Primary target: 1024×640.** Our main user works on a laptop at this viewport. Key pages fit their main content and actions without sideways scrolling, and the most important content shows without scrolling down. The 640px height is the tight constraint: check sticky headers and footers, chart heights, and modals against it.
- **Checks before merging visual work.** Look at the change at 1024×640 first, then in both themes, at 200% text size, at a 320px-wide viewport (WCAG 1.4.4 and 1.4.10), and with keyboard only. Data tables may scroll sideways; the controls around them must still reflow.

The app does not claim full AAA conformance. The W3C does not recommend requiring AAA for a whole site.

### Known gaps

None. Every rule above is met; new work meets it from the start.

## State

Never signal a state with color alone. Each price annotation is a chip with a word, a signed figure, or an icon.

- Sale: `warning` soft badge with the label "Sale" and a tag icon (`i-lucide-tag`).
- Price movement: the `PriceChange` component, used everywhere a price goes up or down (history, highlights, recipes). Do not build one by hand.
  - Increase: `error` soft badge, `i-lucide-trending-up`, and a plus sign, such as "+12%" or "+$0.40". Red is the `danger` token, which the contrast test holds to 7:1 on the badge tint in both themes. Amber stays reserved for sale, so a price that rose and is on sale never reads as one signal.
  - Decrease: `success` soft badge, `i-lucide-trending-down`, and a true minus sign (U+2212), such as "−6%" or "−$0.40".
  - No change: `neutral` soft badge, `i-lucide-minus`, and the words "No change", only when the value is exactly zero. A move that rounds away at the shown precision, such as $0.40 in a whole-dollar total, shows the unsigned figure ("$0") on the same neutral badge. A missing comparison shows "—". A caller that treats small moves as flat (Highlights uses under 2%) passes `flat`: it keeps the signed figure and the neutral badge.
  - The figure comes from `formatSignedCurrency()` or `formatSignedPercent()` in `shared/utils/money.ts`. An amount that rounds to zero carries no sign.
  - The glyph is decorative (`aria-hidden`) and the visible figure is hidden from screen readers, which instead hear "up $0.40", "down 6%", "flat, +1.2%", "no change", or "no comparison". The direction therefore never depends on color or on the glyph alone (WCAG 1.4.1).
  - Plain-text figures inside a sentence, such as "+1.2% avg.", use the same formatters without the chip.

Chips use the `chip` radius. Other states, such as loading, errors, and selection, follow the [Interaction baseline](#interaction-baseline), not this chip pattern.

## Typography

| Role | Font | Use for |
|---|---|---|
| Display | `font-display` (Figtree, 600 and 700) | Page and section headings. |
| Body | `font-sans` (Figtree, 400 to 700) | All other UI text. This is the default. |
| Label | `label` utility | Short uppercase captions above fields and columns. The utility sets size, weight, tracking, and the muted color. |
| Price | `tabular-nums` | Every price, in the body font. |

Visual size and heading level are separate. Use the heading element the page structure needs, then the size the design needs.

Table cells use `text-base`, the same size as body text. Secondary lines inside a cell, such as a date, store, or note under the main value, use `text-sm` with `text-muted`. Column headers and phone-width card labels stay as small uppercase labels. Keep uppercase to a few words.

Hero prices (the receipt total, and an item's latest, low, and high price) use the `MoneyAmount` component: dollars at the figure's size with slightly tight tracking, and the cents smaller and muted, sized with `text-cents` (0.7em of the figure). Prices are the product, so they carry the app's typographic character instead of a second typeface.

Prices use `tabular-nums` everywhere, so digits line up when prices sit in a column. In table columns and totals they are right-aligned. In phone-width card layouts, where each value sits under its own label, they align with their label instead. Format money with `formatCurrency()` and `formatSignedCurrency()` from `shared/utils/money.ts`, never by hand.

- **Prices and receipt totals show cents**, such as "$2.29" or "$111.49". A single purchase is exact.
- **Aggregates across many purchases show whole dollars** with `{ whole: true }`, such as a period's total spend ("$6,794"), monthly spend, its month-to-month change, store totals, and chart axis ticks. Cents there are noise in an overview number.
- Signed changes use an explicit plus and a true minus, such as "−$3" or "+$12.50".
- Unit prices name their unit, such as "$0.50 per 100 g".
- Stat tiles use an icon that names what is counted, such as a wallet for spend, not a "$" that repeats the currency symbol in the figure. There is no monospace face; a second family for numbers was rejected as a generic data-UI default.

### Type scale

Use only these sizes. This is a project scale; the first three steps are Tailwind's defaults.

| Utility | Size | Line height | Use for |
|---|---|---|---|
| `text-xs` | 0.75rem (12px) | 1rem | Labels, column headers, chips, and fine print. |
| `text-sm` | 0.875rem (14px) | 1.25rem | Secondary lines, metadata, and compact controls. |
| `text-base` | 1rem (16px) | 1.5rem | Body text and table cells. |
| `text-title` | 1.25rem (20px) | 1.3 | Card and dialog titles. |
| `text-heading` | 1.625rem (26px) | 1.2 | Section headings, stat figures, and the receipt total. |
| `text-display` | 2.125rem to 2.5rem (34px to 40px), fluid | 1.05 | Page titles only. Keep them short; check that a wrapped title stays readable. |
| `text-cents` | 0.7em of its parent | inherited | Only the cents inside `MoneyAmount`. |

Do not add arbitrary sizes such as `text-[0.8125rem]`. In custom CSS, use `var(--text-sm)` and the other scale variables, not pixel values. If a size is missing, change the scale here first.

The family keeps a real fallback stack, defined in the `@theme` block in `main.css`. `nuxt.config.ts` only loads the font files.

## Radius

| Token | Utility | Use for |
|---|---|---|
| `chip` | `rounded-chip` | State chips. 0.1875rem (3px). |
| `control` | `rounded-control` | Buttons. 0.375rem (6px). |
| `input` | `rounded-input` | Form fields. 0.5rem (8px). The shared input style already uses it. |
| `card` | `rounded-card` | Cards and panels. 0.75rem (12px). |

Some components still use older arbitrary radii. Those are migration debt, cleaned up area by area. New code uses these names.

## Inputs

- Single-line inputs and selects are at least 2.75rem (44px) tall. Textareas start at that height and grow with their content. The minimum is set once in the shared input style in `app.config.ts` as `min-h-11`.
- That size is a comfort choice for touch. It is above WCAG 2.5.8's 24px minimum (AA) and meets 2.5.5's 44px target (AAA).
- Input text is `text-base`. iOS Safari zooms the page when a focused field's text is smaller than 16px, and Nuxt UI otherwise drops to 14px on wider screens. Never disable page zoom to avoid this.
- Pages do not override the input height. If a layout seems to need a taller or shorter field, fix the layout instead.
- Price and size inputs hide the browser's stepper arrows and set `inputmode="decimal"`, which asks phones for a numeric keyboard with a decimal point. `inputmode` is only a hint, so the field still validates its value. Count fields, where stepping by one is useful, may keep their steppers.

### Field spacing

- Label to control: 0.375rem (6px).
- Control to anything attached below it, such as help text, an error, or an option checkbox: 0.5rem (8px). This matches the spacing Nuxt UI uses for help and error text.
- Set it on the form field's `ui` prop: `{ container: 'mt-1.5 grid gap-2', help: 'mt-0', error: 'mt-0' }`. The container's gap owns the spacing, so help and error lose their own top margin; otherwise the two add up to 16px. Do not put a gap on the field's root.
- Separate fields in a form are 1rem (16px) apart.

## Buttons and borders

Borders mark things you can type into. Actions use fill, or nothing at all.

Use Nuxt UI `UButton`, not a native button. Pick the variant from this table, top to bottom; the first row that fits wins.

| Role | Props | Use for |
|---|---|---|
| Main action | `variant="solid" color="primary"` | The one main action in a view, such as "Save and add another". A view has at most one. |
| Paired secondary | `variant="outline" color="neutral"` | A secondary choice shown directly beside the main action, such as Cancel next to Save in a dialog. |
| Destructive | `variant="ghost" color="error"` | Delete and remove. Confirm in place before acting. |
| Tool toggle | `variant="soft" color="primary"` when active, `variant="ghost" color="neutral"` otherwise | Filters and view switches that stay selected. |
| Everything else | `variant="ghost" color="neutral"` | Other actions, including navigation styled as a button, such as "Back to Sep 1, 2026". |

Rules:

- Inputs, selects, and textareas keep their `line-control` border. On a card the input fill matches the surface, so the border is the only edge that shows where the field is.
- Ghost buttons have no border or fill at rest. They rely on a clear label and an icon, and show their shape on hover and focus.
- Leading icons from Lucide (`icon="i-lucide-*"`) are the default for actions. Leave the icon out when it adds no meaning or makes the label wrap.
- Button text size comes from the `size` prop, never from surrounding text. In this version of Nuxt UI, `xs` and `sm` are 0.75rem (12px), `md` and `lg` are 0.875rem (14px), and `xl` is 1rem (16px). Never set a font size on a button or on a parent to resize its text.
- Real controls use `md` or larger. The only exceptions are table sort headers (`xs`) and inline row links such as Edit (`sm`).
- Primary toolbar actions, such as the receipt footer, use `xl` for 16px text. `lg` renders at 14px, the same as `md`.
- Target size: every button is at least 24px in both directions (WCAG 2.5.8). Buttons used often on phones add the `touch-target` class for a 2.75rem (44px) minimum height.
- A button that submits the single input next to it matches the input's height so the two read as one control. In a grid row with the default `align-items: stretch` this happens on its own; do not set a fixed height on the button.
- Buttons use the `control` radius.
- Sticky bars use a solid surface. A translucent bar lets content scroll visibly through it.
- **Action pickers.** A menu that acts as soon as you pick from it, such as "Merge into…" on a category, is an action, not a field. Use `USelectMenu` with `variant="ghost"` and style its trigger like the ghost buttons beside it: same size, no border, `control` radius. Any confirmation still happens after the pick. This is the only place a select may differ from the shared input style.

### Choosing between rows

When the choice is between whole rows, such as which name to keep in a duplicate group:

- Make each row a `<label>` that contains a visible radio, so the whole row is the click target.
- Give the selected row the `accent-soft` fill and its name `accent-strong`. The fill alone is under 3:1 against the card, so the radio is what shows the selection (WCAG 1.4.11); the fill only reinforces it.
- State what each choice will do, in text on the row, such as "Keep this name" and "Merge this name".
- Hover uses a lighter `accent-soft` tint, so it never looks the same as selected.

## Layout and styling

Place controls by what they act on:

- Page-wide controls, such as a period picker or a view switcher, go in the page header.
- Actions that add to a list, such as "New recipe" or "Add receipt", go in the toolbar directly above that list, beside its search or paging controls. Don't put them in the page header, where on a wide screen they end up far from the content they affect.
- When a page has several lists, each list gets its own toolbar.
- The visual order matches the DOM order, so keyboard focus moves in the same order people read (WCAG 1.3.2, 2.4.3).

Data tables use a `<caption>` or a heading tied to them, `th` cells with `scope`, and `aria-sort` on sortable columns. At phone width they become cards; each value keeps its column name as a visible label.

Follow the Interface components rules in `AGENTS.md`:

- Prefer Nuxt UI components over native HTML controls or custom replacements.
- Put Tailwind utilities on the element at the use site. Do not create composite CSS classes that bundle several utilities.
- Keep custom CSS for theme tokens in `main.css`, keyframes, complex selectors, and styling that utilities cannot express cleanly.

`label` is the one deliberate exception: a reusable typography primitive, defined with `@utility` so Tailwind treats it like any other utility. Do not add more composite classes; if another pattern repeats, raise it as a change to this document first.

## Charts

Charts follow the tidyverse and ggplot2 approach: map data to visual properties deliberately, keep the theme quiet, and let the data carry the ink. Where a rule below is stricter than ggplot2's own defaults, it is this app's rule.

### Form

- Lines show change over time. Bars show amounts and always start at zero. Points mark individual observations.
- A line chart may zoom to the data's range rather than start at zero. When the series has a meaningful reference, such as an index's base of 100, show it, and say in the subtitle what the base is.
- Never use two y-axes. This is stricter than ggplot2, which allows a secondary axis that is a fixed transformation of the first. Two measures on different scales get two charts, or are indexed to a common base.

### Theme

- A quiet theme inspired by ggplot2's `theme_minimal()`: horizontal major gridlines only, in `line`. No minor grid, chart border, or axis box. Gridlines are decorative; never let one carry information a reader needs.
- Axis text uses `text-xs` in `muted`, with tabular numerals. Text never takes its color from a series.
- Each chart has a title that names the measure and its unit, and a subtitle that defines it when the title alone is not enough. A caption carries data notes such as coverage or sample size, when there are any. This follows ggplot2's `labs(title, subtitle, caption)`.
- Colors come from theme tokens, so charts switch theme with the rest of the app. Check marks, focus, and overlapping points in both themes.

### Scales

- Numeric axis breaks fall on round numbers: steps of 1, 2, or 5 times a power of ten, such as $0.20 or 5 index points. This is the sequence R's `pretty()` uses. It is a local rule, not ggplot2's default for every scale. Never split a range into equal parts that land on values like $0.36.
- The axis extends to the first break at or beyond the data on each side, so the highest and lowest values sit inside the labeled range. Bar charts start at zero instead of at a break below the data.
- A flat series, where every value is the same, gets room of 10% of the value's size, with a minimum of 0.05, on each side. This is this app's own rule; ggplot2 instead expands a continuous range by 5% of the range.
- Use `prettyScale()` from `shared/utils/chart-scale.ts` for numeric axes. It aims for about four intervals. Date axes use calendar-aware ticks (days, weeks, months), not `prettyScale()`.
- Format ticks with the same precision as the data, and never show two ticks with the same label.

### Marks

- Lines, including sparklines, are 2px with round joins and caps.
- Points have a 10px visible diameter on a 2px line. Points that sit on a line get a 2px ring in the surface color so they separate from it.
- Every interactive mark has a hit target of at least 32px, larger than the mark itself. That is above WCAG 2.5.8's 24px minimum.
- Data marks use `chart-series`, never `accent` directly. Marks meet 3:1 contrast against the chart surface in both themes (WCAG 1.4.11).

### Encoding

- Never encode a category with color alone. Pair color with shape, as ggplot2 does by mapping `shape` and `colour` to the same variable. Sale prices are `sale-mark` diamonds; regular prices are `chart-series` circles.
- A chart with a categorical encoding, such as sale versus regular, always has a legend that shows the same shapes and colors as the marks.
- A chart with one series and no categories needs no legend; its title names it.

### Missing data and interaction

- Purchases are irregular, so a price chart connects consecutive purchases; a week without a purchase is not missing data.
- Aggregated series, such as the monthly price index, have one expected value per period. When a period has no value, break the line instead of interpolating across it, and keep the x-axis covering the full selected period.
- Every data point has a tooltip on hover, keyboard focus, and tap, giving its date, value with unit, and status, such as sale. Tooltips stay open while hovered, and close on Escape (WCAG 1.4.13).
- Arrow-key movement between points is not provided. Each point is a Tab stop, Escape dismisses the readout, and the data table is the accessible alternative where the page has one.
- The same numbers are available in a table on the page, and the chart's subtitle or caption states the main trend in words.
