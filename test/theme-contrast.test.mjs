import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

function tokens(selector) {
  const block = stylesheet.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{\\n([\\s\\S]*?)\\n\\}`))
  assert.ok(block, `missing ${selector} token block`)
  return Object.fromEntries([...block[1].matchAll(/--([a-z-]+): (#[0-9a-f]{6});/g)].map(([, name, hex]) => [name, hex]))
}

// Aliases such as --chart-series: var(--accent-fill) resolve within each theme.
function aliases(selector) {
  const block = stylesheet.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{\\n([\\s\\S]*?)\\n\\}`))
  return Object.fromEntries([...block[1].matchAll(/--([a-z-]+): var\(--([a-z-]+)\);/g)].map(([, name, target]) => [name, target]))
}
function resolve(hexes, links) {
  const out = { ...hexes }
  for (const [name, target] of Object.entries(links)) if (out[target]) out[name] = out[target]
  return out
}
const light = resolve(tokens(':root'), aliases(':root'))
const themes = { light, dark: resolve({ ...light, ...tokens('.dark') }, { ...aliases(':root'), ...aliases('.dark') }) }

function channels(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Nuxt UI draws soft badges and buttons as the color at 10% over the surface.
function tint(color, surface) {
  const c = channels(color)
  const s = channels(surface)
  return `#${c.map((v, i) => Math.round(v * 0.1 + s[i] * 0.9).toString(16).padStart(2, '0')).join('')}`
}

for (const [name, t] of Object.entries(themes)) {
  const backgrounds = [t.bg, t.surface, t['surface-muted']]

  test(`${name} theme text tokens meet WCAG AAA (7:1) on every background`, () => {
    for (const token of ['ink', 'muted', 'accent', 'accent-strong', 'danger', 'success', 'warning']) {
      const own = [tint(t[token], t.surface)]
      if (token === 'accent') own.push(t['accent-soft'])
      if (token === 'danger') own.push(t['danger-soft'])
      for (const bg of [...backgrounds, ...own]) {
        assert.ok(contrast(t[token], bg) >= 7, `${token} on ${bg} is ${contrast(t[token], bg).toFixed(2)}:1`)
      }
    }
    assert.ok(contrast(t['on-accent-fill'], t['accent-fill']) >= 7)
    assert.ok(contrast(t['on-accent-fill'], t['accent-fill-hover']) >= 7, 'hover and pressed fill')
    assert.ok(contrast(t.surface, t.danger) >= 7, 'danger button text')
  })

  test(`${name} theme placeholders meet AA and control edges meet 3:1`, () => {
    for (const bg of backgrounds) {
      assert.ok(contrast(t.placeholder, bg) >= 4.5, `placeholder on ${bg}`)
      assert.ok(contrast(t['line-control'], bg) >= 3, `line-control on ${bg}`)
    }
  })
}

test('contrast helper matches known WCAG values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00')
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48')
  assert.ok(contrast('#767676', '#ffffff') >= 4.5)
})

test('a failing token is caught', () => {
  assert.ok(contrast('#9aa3ad', '#ffffff') < 7, 'old light-mode muted value would fail AAA')
})

test('text sizes come only from the type scale', async () => {
  const { readdir } = await import('node:fs/promises')
  const files = (await readdir(new URL('../app', import.meta.url), { recursive: true })).filter((f) => f.endsWith('.vue'))
  for (const file of files) {
    const source = await readFile(new URL(`../app/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /text-\[(\d|clamp)/, `${file} uses an arbitrary text size`)
    assert.doesNotMatch(source, /(?<![\w-])text-(lg|xl|[2-9]xl)(?![\w-])/, `${file} uses a size outside the scale`)
  }
  // The stat-card icon is sized with font-size, so it is the one pixel value allowed.
  const pixelSizes = [...stylesheet.matchAll(/^(.*)font-size: \d+px/gm)].map(([, rule]) => rule)
  assert.deepEqual(pixelSizes.filter((rule) => !rule.startsWith('.stat-card .iconify')), [])
  assert.match(stylesheet, /--text-title: 1\.25rem;[\s\S]*--text-heading: 1\.625rem;[\s\S]*--text-display: clamp\(2\.125rem, 3\.5vw, 2\.5rem\);/)
  assert.doesNotMatch(stylesheet, /^(html|body) \{[^}]*font-size: \d+px/m)
})

test('inputs share one 2.75rem (44px) height with text-base at every width', async () => {
  const appConfig = await readFile(new URL('../app/app.config.ts', import.meta.url), 'utf8')
  assert.match(appConfig, /const inputBase = '[^']*\bmin-h-11\b[^']*\btext-base\b/)
  assert.match(appConfig, /const inputTextBase = \{ fixed: false, class: 'md:text-base' \}/)
  for (const component of ['input', 'inputMenu', 'textarea', 'select', 'selectMenu']) {
    assert.match(appConfig, new RegExp(`\\b${component}: \\{ slots: \\{ base: inputBase \\}, compoundVariants: \\[inputTextBase\\] \\}`))
  }
  // An unlayered font reset on form controls would override their utility text sizes.
  // A global button reset would also beat Nuxt UI's size utilities. Scoped table-header rules are not global resets, so they don't match.
  const unlayeredFontReset = /(^|,\s*)(button|input|select|textarea)\b[^{]*\{[^}]*font: inherit/m
  assert.doesNotMatch(stylesheet, unlayeredFontReset)
  assert.match('button:not([role="combobox"]) { font: inherit; }', unlayeredFontReset, 'the matcher catches the old global button reset')
  assert.doesNotMatch('.history-table th button { font: inherit; }', unlayeredFontReset)
  const { readdir } = await import('node:fs/promises')
  for (const file of (await readdir(new URL('../app', import.meta.url), { recursive: true })).filter((f) => f.endsWith('.vue'))) {
    const source = await readFile(new URL(`../app/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /min-h-\[52px\]|:ui="\{[^"]*min-h-/, `${file} overrides the input height`)
  }
  assert.doesNotMatch(stylesheet, /min-height: (52px|3\.25rem)/)
})

for (const [name, t] of Object.entries(themes)) {
  test(`${name} theme chart marks meet 3:1 against chart surfaces`, () => {
    for (const mark of ['chart-series', 'sale-mark']) {
      for (const bg of [t.bg, t.surface, t['surface-muted']]) {
        assert.ok(contrast(t[mark], bg) >= 3, `${mark} on ${bg} is ${contrast(t[mark], bg).toFixed(2)}:1`)
      }
    }
  })
}

test('chart marks follow the design doc weights and never rely on color alone', async () => {
  const highlights = await readFile(new URL('../app/pages/highlights.vue', import.meta.url), 'utf8')
  const item = await readFile(new URL('../app/pages/items/[item].vue', import.meta.url), 'utf8')
  for (const page of [highlights, item]) {
    assert.doesNotMatch(page, /<polyline[^>]*stroke-3/, 'lines are 2px')
    assert.match(page, /<polyline[^>]*stroke-2/)
  }
  // Index points: 10px visible dot inside a 2px surface ring, with a 32px hover target.
  assert.match(highlights, /<circle class="fill-transparent" :cx="point\.x" :cy="point\.y" r="16" \/><circle class="fill-\(--chart-series\) stroke-\(--surface\) stroke-2" :cx="point\.x" :cy="point\.y" r="6" \/>/)
  // Item points: regular prices are circles, sale prices are diamonds.
  assert.match(item, /<path v-if="point\.saleItem" class="fill-sale-mark stroke-surface stroke-2"/)
  assert.match(item, /<circle v-else class="fill-chart-series stroke-surface stroke-2" :cx="point\.x" :cy="point\.y" r="6" \/>/)
  assert.match(item, /<i class="[^"]*rotate-45 bg-sale-mark" \/>Sale/)
})

test('receipt date and store fields use the shared field spacing', async () => {
  const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
  // The container gap owns the spacing, so help and error drop Nuxt UI's own mt-2 instead of adding to it.
  assert.match(form, /const fieldSpacing = \{ container: 'mt-1\.5 grid gap-2', help: 'mt-0', error: 'mt-0' \}/)
  for (const field of ['date-field', 'receipt-store-field']) {
    const tag = form.match(new RegExp(`<UFormField[^>]*${field}[^>]*>`))[0]
    assert.match(tag, /:ui="fieldSpacing"/)
    assert.doesNotMatch(tag, /\bgap-\[/, `${field} sets its own gap`)
  }
})

test('receipt editor actions are not outlined and the sticky footer is solid', async () => {
  const form = await readFile(new URL('../app/components/ReceiptEntryForm.vue', import.meta.url), 'utf8')
  for (const label of ['Return to selected day', 'Add another line', 'Cancel split', 'Delete receipt', 'Export receipt', 'Split receipt']) {
    // Match the whole line: these buttons have arrow functions in their attributes.
    const tag = form.split('\n').find((line) => line.includes('<UButton') && line.includes(`label="${label}"`))
    assert.ok(tag, `${label} button exists`)
    assert.match(tag, /variant="ghost"/, `${label} is ghost`)
  }
  const footer = form.match(/<footer[^>]*receipt-entry-footer[^>]*>/)[0]
  assert.match(footer, /\[background:var\(--surface\)\]/)
  assert.doesNotMatch(footer, /backdrop-blur|transparent_/)
})

test('number inputs hide steppers and ask phones for a decimal keyboard', async () => {
  assert.match(stylesheet, /input\[type="number"\] \{ -moz-appearance: textfield; appearance: textfield; \}/)
  assert.match(stylesheet, /input\[type="number"\]::-webkit-inner-spin-button, input\[type="number"\]::-webkit-outer-spin-button \{ margin: 0; -webkit-appearance: none; \}/)
  const { readdir } = await import('node:fs/promises')
  for (const file of (await readdir(new URL('../app', import.meta.url), { recursive: true })).filter((f) => f.endsWith('.vue'))) {
    const source = await readFile(new URL(`../app/${file}`, import.meta.url), 'utf8')
    for (const tag of source.match(/<UInput[^>]*type="number"[^>]*>/g) || []) assert.match(tag, /inputmode="decimal"/, `${file}: ${tag}`)
  }
})

for (const [name, t] of Object.entries(themes)) {
  test(`${name} theme focus ring is opaque and meets 3:1 on every surface`, () => {
    for (const bg of [t.bg, t.surface, t['surface-muted']]) {
      assert.ok(contrast(t.accent, bg) >= 3, `focus ring on ${bg}`)
    }
  })
}

test('interaction states use their own tokens instead of opacity on text-bearing fills', async () => {
  assert.match(stylesheet, /--focus-ring: var\(--accent\);/)
  assert.doesNotMatch(stylesheet, /--focus-ring: color-mix/)
  const appConfig = await readFile(new URL('../app/app.config.ts', import.meta.url), 'utf8')
  assert.match(appConfig, /hover:bg-\(--accent-fill-hover\) active:bg-\(--accent-fill-hover\)/)
  assert.doesNotMatch(appConfig, /bg-\(--accent-fill\)\/\d/)
  // rounded-(--radius-input), not rounded-input: tailwind-merge only replaces Nuxt UI's rounded-md with a class it recognizes.
  assert.match(appConfig, /const inputBase = '[^']*rounded-\(--radius-input\)/)
  assert.match(stylesheet, /^:is\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible \{\n  outline: 3px solid var\(--focus-ring\);/m)
  assert.doesNotMatch(stylesheet, /--gold:/, 'the unused gold token stays removed')
  assert.match(stylesheet, /\.core-sparkline polyline \{[^}]*stroke-width: 2;/)
})

test('dark mode charts use the fill tone, and light mode charts use the accent', () => {
  assert.equal(themes.dark['chart-series'], themes.dark['accent-fill'])
  assert.equal(themes.light['chart-series'], themes.light.accent)
  // Shape tells sale from regular prices; a lightness gap helps too. It was 1.09:1 before the dark palette change.
  assert.ok(contrast(themes.dark['chart-series'], themes.dark['sale-mark']) >= 1.3)
})

