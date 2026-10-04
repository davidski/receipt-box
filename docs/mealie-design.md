# Receipt Box ↔ Mealie Recipe Costing Design

## Goal

Add recipe costing to Receipt Box using:

- **Mealie** as the source of truth for recipes, foods, aliases, and recipe units.
- **Receipt Box** as the source of truth for retail grocery products, package sizes, purchase history, and prices.
- Receipt Box-owned mappings between grocery products and Mealie foods.

Do not modify Mealie. Receipt Box only reads from Mealie, using the server-side URL and token. Recipe costing runs entirely inside Receipt Box: it fetches the recipe read-only, joins ingredients against Receipt Box's cached foods, mappings and purchase history, and computes the result. Nothing is written back to Mealie.

---

## Core Ownership Rule

**Mealie owns culinary semantics:**

- recipes
- foods
- aliases
- recipe units

**Receipt Box owns economic data:**

- grocery products
- stores
- package quantities
- purchases
- prices

**Receipt Box owns the integration bridge:**

- grocery product → Mealie food
- food-specific unit conversions
- recipe costing

---

## Architecture

```text
Mealie
  recipes
  foods + aliases
  units
      │
      │ periodic sync
      ▼
Receipt Box
  cached Mealie foods/units
      │
      │ item → food mapping
      ▼
  grocery items (name text)
      │
      │ purchase history
      ▼
  package quantity + price
      │
      ▼
  recipe cost engine
```

Mealie may be unavailable temporarily without breaking Receipt Box price/history functionality.

---

## Scope Decisions

- **Item identity stays text-keyed.** `grocery_entries.item TEXT` remains the product identity, as it is for `grocery_item_categories`. A stable `grocery_items` table is deferred (see Later work). Mappings therefore key on the item name and must be carried through rename and merge (see Mapping).
- **Each entry is one package.** A `grocery_entries` row is one package of `size unit` at `price`. There is no per-entry quantity.
- **Mapping is per item name.** Every size variant under one name inherits the same food. A name that genuinely spans two foods must be split; variant-level mapping is a non-goal.
- **Costing is prorated.** Ingredient cost is the quantity used times the price per base unit, not the price of the whole package.
- **Mealie is optional.** If `MEALIE_URL` or `MEALIE_API_TOKEN` is unset, all Mealie features are hidden (Manage → Mealie section, recipe cost UI), startup sync is skipped, and `GET /api/mealie/status` returns `configured: false`. Existing installs see no change.
- **Costing needs Mealie online.** Recipes are not cached. If Mealie is unreachable, a cost request fails with a clear error.
- **Auth.** New endpoints use the existing auth middleware with no special cases. Mappings are household-wide.

---

## Mealie Configuration

Server-only:

```dotenv
MEALIE_URL=https://mealie.example.com
MEALIE_API_TOKEN=...
```

Never expose the API token to the browser.

Create a dedicated Mealie client module responsible for:

- authentication
- base URL
- pagination
- timeout/error handling

---

## Cache Mealie Foods

```sql
mealie_foods
------------
id UUID PRIMARY KEY
name TEXT NOT NULL
plural_name TEXT
description TEXT
extras JSONB NOT NULL DEFAULT '{}'
active BOOLEAN NOT NULL DEFAULT TRUE
mealie_created_at TIMESTAMPTZ
mealie_updated_at TIMESTAMPTZ
last_seen_at TIMESTAMPTZ NOT NULL
synced_at TIMESTAMPTZ NOT NULL
```

Aliases:

```sql
mealie_food_aliases
-------------------
food_id UUID REFERENCES mealie_foods(id) ON DELETE CASCADE
alias TEXT NOT NULL
PRIMARY KEY (food_id, alias)
```

Mealie aliases are not independent entities. They exist only to identify the canonical food.

Never map grocery products to aliases directly.

---

## Cache Mealie Units

```sql
mealie_units
------------
id UUID PRIMARY KEY
name TEXT NOT NULL
plural_name TEXT
abbreviation TEXT
plural_abbreviation TEXT
standard_quantity NUMERIC
standard_unit TEXT
active BOOLEAN NOT NULL DEFAULT TRUE
last_seen_at TIMESTAMPTZ NOT NULL
synced_at TIMESTAMPTZ NOT NULL
```

Unit aliases are not synced; nothing consumes them.

A unit without `standard_quantity`/`standard_unit` cannot be normalized and yields `UNSTANDARDIZED_UNIT` when costing.

Relevant Mealie standardized dimensions:

```text
mass:
  gram
  kilogram
  ounce
  pound

volume:
  milliliter
  liter
  fluid_ounce
  cup
```

Mealie explicitly does not convert volume ↔ mass without food-specific density.

---

## Sync Behavior

Idempotent snapshot sync, atomic per run.

On sync:

1. Fetch **all pages** of Mealie foods and units into memory. If any request or page fails, abort with no database writes.
2. In a single transaction: upsert foods, replace aliases for each food, upsert units.
3. Set `last_seen_at` on everything seen.
4. Mark previously cached but unseen foods and units `active = false`.

Guard: refuse to deactivate more than a set share of cached foods in one sync unless forced. A partial or narrowed response must not flood Problems with false breakage.

Do **not** delete missing foods or units.

Mealie supports merging foods. Receipt Box cannot reliably know the replacement UUID from a disappeared UUID alone.

Mappings referencing inactive foods must be flagged for reconciliation.

Concurrency: a sync takes a Postgres advisory lock (as migrations do). A second concurrent sync is skipped.

Startup: run sync fire-and-forget after migration. A failure is logged and never blocks boot. Manual sync is always available. No scheduler in V1.

Support:

```text
POST /api/mealie/sync
GET  /api/mealie/status    -- configured, lastSyncedAt, lastError, counts
```

---

## Grocery Item → Mealie Food Mapping

```sql
grocery_item_food_mapping
-------------------------
item TEXT PRIMARY KEY
mealie_food_id UUID NOT NULL
mapping_source TEXT NOT NULL
mapped_at TIMESTAMPTZ NOT NULL
```

Initial relationship:

```text
many grocery items → one Mealie food
one grocery item   → one Mealie food
```

Examples:

```text
TJ Organic Garbanzo Beans ─┐
Goya Chick Peas            ├──> Mealie: Chickpeas
Bush Garbanzo Beans        ┘
```

Do not decompose prepared foods into their constituent ingredients.

```text
Rao's Marinara → Mealie food "Marinara sauce"
```

### Rename and merge

Because the key is the item name, `renameItemVariants` must carry the mapping, following the existing category flow in the same transaction:

- Rename: move the mapping to the new name.
- Merge: if source and target map to the same food, or only one is mapped, keep it. If they map to different foods, respond 409 with the conflicting foods and accept a resolution (choose one, or clear), exactly as categories do today. Do not write a second conflict mechanism.

---

## Mapping Suggestions

Search against:

1. canonical food name
2. plural name
3. aliases

Suggestion priority:

```text
exact name
exact alias
normalized name
fuzzy name/alias
```

Fuzzy matching uses the Postgres `pg_trgm` extension (`similarity()`), enabled by `CREATE EXTENSION IF NOT EXISTS pg_trgm` in the migration. The extension is required: it ships with the `postgres:17-alpine` image used in `compose.yaml`; an external Postgres must have it enabled by a role permitted to create it.

Initially require human confirmation for every mapping. Fuzzy matches must remain suggestions. Only exact matches may eventually support automatic assignment.

Do not add retailer-specific product names as Mealie aliases.

---

## Unit Normalization

Receipt Box already supports:

```text
g kg mL L oz fl oz lb pt qt gal tsp tbsp cup ea
```

Normalize quantities internally to:

```text
mass   → grams
volume → milliliters
count  → each
```

Use the same conversion constants as Mealie where applicable:

```text
1 oz    = 28.349523125 g
1 lb    = 453.59237 g

1 fl oz = 29.5735295625 mL
1 cup   = 236.5882365 mL

1 tsp   = 4.92892159375 mL
1 tbsp  = 14.78676478125 mL
1 pt    = 473.176473 mL
1 qt    = 946.352946 mL
1 gal   = 3785.411784 mL

1 kg    = 1000 g
1 L     = 1000 mL
```

Do not reproduce Mealie's special backend heuristic that sometimes treats `ounce` as `fluid_ounce`. Receipt Box costing should preserve mass and volume distinctions.

Do not add a general-purpose unit library. The required unit domain is small enough for explicit, tested conversions.

---

## Normalize Mealie Recipe Quantities

Mealie units expose:

```text
standard_quantity
standard_unit
```

Normalize recipe quantities as:

```text
normalized quantity
  = recipe quantity
  × unit.standard_quantity
  × standardized-unit base factor
```

Example:

```text
2 tbsp
standard_quantity = 0.5
standard_unit = fluid_ounce

2 × 0.5 × 29.5735295625
≈ 29.57 mL
```

Do not depend on Mealie's frontend conversion logic at runtime.

Count units: a recipe line with no unit, or with the Mealie unit `piece` or `whole`, counts as `ea` and is costed against a purchase in `ea` (same dimension, no conversion). Example: 2 eggs from a 12 ea carton at $4 costs $0.67. Any other count-like unit (`clove`, `can`, `bunch`, `stalk`, `pinch`, `package`, `head`, ...) is `UNSTANDARDIZED_UNIT` until food-specific conversions exist.

---

## Price Normalization

Eligible purchases exclude `non_grocery` entries and entries with a null/non-positive `size` or null `unit`.

```text
price_per_base_unit =
  price / normalized_package_quantity
```

Example:

```text
5 lb flour = 2267.96185 g
price = $4.79

price_per_g = 4.79 / 2267.96185
```

Existing `cost_per_unit` is a display convenience (note it is per 100 for `g`/`mL`), not the canonical representation.

---

## Price Selection

Several grocery items may map to one Mealie food. The price used is the **latest** eligible purchase across all mapped items, preferring non-sale:

1. latest eligible non-sale purchase (`sale_item = false`)
2. otherwise the latest eligible purchase, with `usedSalePrice: true` in the provenance

This is a constant, not a setting. A per-food preferred item and other price policies (median, average) are later work.

Every recipe-cost result must expose the exact purchase observation used.

---

## Recipe Cost Calculation

Cost is **prorated**: the quantity the recipe uses times the price per base unit. A recipe using 2 tbsp of a $6 spice jar costs pennies, not $6.

Fetch the requested recipe from Mealie. Cost it at its stored quantities; there is no scaling parameter in V1.

For every ingredient:

```text
ingredient
  ↓
references a sub-recipe?
  yes → SUBRECIPE_UNSUPPORTED

food UUID exists?
  no → NO_FOOD

known Mealie food?
  no → UNKNOWN_FOOD
  inactive → INACTIVE_MEALIE_FOOD

mapped grocery item?
  no → NO_PRODUCT_MAPPING

eligible price observation?
  no → NO_PRICE / NO_PACKAGE_SIZE

recipe quantity usable (non-null, > 0)?
  no → NO_QUANTITY
recipe unit standardized (or count rule above)?
  no → NO_UNIT / UNSTANDARDIZED_UNIT

normalize recipe quantity
normalize purchased package quantity

same dimension?
  yes → calculate

different dimension?
  food-specific conversion exists?
    yes → calculate
    no  → DIMENSION_MISMATCH
```

Formula:

```text
ingredient_cost =
  normalized_recipe_quantity
  × product_price
  / normalized_package_quantity
```

Recipe total:

```text
recipe_cost = Σ ingredient_cost
```

Servings: use Mealie's `recipeServings` (a number that defaults to 0) when it is positive, then `cost_per_serving = recipe_cost / servings`. Otherwise `cost_per_serving` is null. Never parse the free-text `recipeYield`; ignore `recipeYieldQuantity` in V1.

Partial coverage: the total and cost per serving understate the real cost when any ingredient is uncosted. Show them as "≥ $X" whenever coverage is below 100%, always alongside the coverage. No coverage threshold hides the number.

---

## Food-Specific Conversions

Do not guess across dimensions.

```text
recipe:   2 cups flour
purchase: 5 lb flour
```

requires a flour-specific volume→mass conversion.

```sql
food_conversions
----------------
mealie_food_id UUID NOT NULL
from_dimension TEXT NOT NULL   -- 'volume' | 'count'
to_dimension TEXT NOT NULL     -- 'mass'
factor NUMERIC NOT NULL        -- base `to` units per base `from` unit
updated_at TIMESTAMPTZ NOT NULL
PRIMARY KEY (mealie_food_id, from_dimension, to_dimension)
```

Only two directions are stored, volume→mass (g per mL, the density) and count→mass (g per each). The reverse is computed by division at cost time.

```text
1 onion ≈ 170 g
1 garlic clove ≈ 4 g
```

Until this exists, unsupported `each`, `bunch`, `clove`, etc. stay uncosted.

---

## Cost Status / Provenance

Do not return only a total.

Each ingredient should report:

```text
food
recipe quantity/unit
normalized quantity
selected grocery item
selected purchase observation (including usedSalePrice)
normalized package quantity
calculated cost
status
failure reason if applicable
```

Statuses:

```text
exact
unit_converted
food_conversion
estimated_count
uncosted
```

Failure reasons:

```text
NO_FOOD
UNKNOWN_FOOD
INACTIVE_MEALIE_FOOD
NO_PRODUCT_MAPPING
NO_PRICE
NO_PACKAGE_SIZE
NO_QUANTITY
NO_UNIT
UNSTANDARDIZED_UNIT
DIMENSION_MISMATCH
SUBRECIPE_UNSUPPORTED
```

Recipe summary:

```text
Estimated cost (≥ when coverage < 100%)
Cost per serving
Ingredients costed / total
Coverage %
Uncosted ingredients with reasons
```

Avoid arbitrary numeric confidence scores.

---

## Receipt Box API

```text
GET  /api/mealie/status
POST /api/mealie/sync

GET  /api/mealie/foods
GET  /api/mealie/foods/:id

GET    /api/items/food?item=<name>
PUT    /api/items/food
DELETE /api/items/food

GET /api/food-mappings/unmapped
GET /api/food-mappings/problems

GET /api/mealie/recipes
GET /api/mealie/recipes/:slug/cost
```

Item names are free text, so item mapping endpoints take the name in the query/body rather than the path.

Later:

```text
GET /api/mealie/foods/:id/conversions
PUT /api/mealie/foods/:id/conversions
```

---

## UI

Add under Manage (hidden when Mealie is not configured):

```text
Manage
├── Items
├── Categories
├── Stores
├── Mealie
│   ├── Integration
│   ├── Food mappings
│   ├── Conversions
│   └── Problems
└── Import/export
```

Follow the repository's interface rules: Nuxt UI components and Tailwind utilities at the use site.

Food mapping screen should support:

```text
All | Mapped | Unmapped | Broken
```

Example workflow:

```text
TJ Organic Garbanzo Beans

Suggested food:
Chickpeas

Reason:
Matched Mealie alias "Garbanzo beans"

[Accept] [Choose another]
```

Problems view covers only what is computable from cached data:

- mappings to inactive/deleted Mealie foods
- mappings whose item no longer has any entries
- unmapped items
- items without a usable package size

Unsupported conversions are shown inside a single recipe's cost view, where the recipe is already fetched. A cross-recipe problem report is later work.

---

## Recipe Cost UI

Keep it simpler than Mealie's recipe interface.

```text
Chickpea Curry

Estimated cost          ≥ $8.73
6 servings              ≥ $1.46 / serving
Coverage                14 / 16

Ingredient              Cost
-----------------------------
Chickpeas               $1.32
Coconut milk            $2.49
Onion                   $0.74
Tomatoes                $1.18
Cilantro                   —
Salt                       —
```

Ingredient details should expose the pricing calculation and allow mapping/conversion fixes.

---

## Mealie Food Merge Handling

If cached UUID A disappears:

```text
mapping → UUID A
```

do not delete or silently remap.

Mark food inactive and mapping broken.

Suggest replacement based on current food names/aliases.

Require explicit confirmation.

---

## Offline Behavior

With cached foods/units:

```text
receipt entry         works
price history         works
food mappings         work
food search           works
quantity conversions  work
```

Mealie connectivity is required only for:

```text
sync
recipe retrieval
recipe costing (fails with a clear error when Mealie is unreachable)
```

---

## Code Organization

Suggested:

```text
server/
  utils/
    mealie/
      client.ts
      sync.ts
      foods.ts
      units.ts
      recipes.ts

    costing/
      units.ts
      prices.ts
      conversions.ts
      recipe-cost.ts

shared/
  types/
    mealie.ts
    costing.ts

  utils/
    units.ts
```

---

## Work Cards

Each card is an independently workable issue. Tests listed under a card belong to that card. `just test`, `just codecov`, `pnpm typecheck` and `pnpm build` gate every card.

```text
A quantity engine (pure TS)                         — none
B Mealie client + config gating                     — none
C catalog tables + sync + status                    — B
D mapping table + API + rename/merge handling       — C
E suggestions (exact/alias/fuzzy, pg_trgm)          — C, D
F Manage → Mealie UI                                — D, E
G price selection                                   — A
H recipe cost engine + endpoint                     — A, C, D, G
I recipe cost UI                                    — H
J food_conversions + conversions UI                 — H
```

### A — Quantity engine

- canonical mass/volume/count conversion with the constants above
- normalize package quantities; eligibility rules (null size/unit, `non_grocery`)
- Mealie `standard_quantity`/`standard_unit` normalization

Tests:

```text
1 lb  → 453.59237 g          16 oz → 453.59237 g
1 cup → 236.5882365 mL       16 tbsp → 236.5882365 mL
1 kg → 1000 g                1 L → 1000 mL

quantity 2, standard_quantity 0.5, standard_unit fluid_ounce
→ 29.5735295625 mL
```

### B — Mealie client + config gating

- `MEALIE_URL`/`MEALIE_API_TOKEN` handling; absent means Mealie is disabled
- auth header, base URL, pagination, timeout, error mapping
- token never reaches the browser

Verified against the OpenAPI schema of Mealie v3.28.0 (`/openapi.json`, public):

- Endpoints: `GET /api/foods`, `GET /api/units`, `GET /api/recipes`, `GET /api/recipes/{slug}`. All need a Bearer token.
- List endpoints paginate with `page`/`perPage` and return `{ page, per_page, total, total_pages, items, next, previous }` (mixed casing).
- JSON keys are camelCase (`pluralName`, `standardQuantity`, `standardUnit`, `recipeServings`); the cache columns are snake_case.
- Foods carry `aliases: [{ name }]`, units carry `aliases` too. Foods have no active/deleted flag, so inactivity is inferred only from absence in a sync.
- `standardUnit` is a free string in the schema, so its allowed values (`gram`, `cup`, ...) are not confirmed. Check them against real units in card A, and treat unknown values as `UNSTANDARDIZED_UNIT`.
- A recipe ingredient has `quantity`, `unit`, `food`, `referencedRecipe`, `note`. `unit` and `food` may be unlinked "create" objects with no `id`; treat those as `NO_FOOD`/`UNKNOWN_FOOD`.
- There is no `disableAmount` field in this version.
- Observed on the home instance (44 units, 706 foods; `perPage=200` fits all units, foods need several pages): standardized `standardUnit` values are `gram`, `kilogram`, `ounce`, `pound`, `liter`, `milliliter`, `cup`, `fluid_ounce`. Units are not always defined in their own dimension: `milligram` = 0.001 gram, `tablespoon` = 0.5 fluid_ounce, `teaspoon` = 1/6 fluid_ounce, `gallon` = 16 cup, `quart` = 4 cup, `pint` = 2 cup. Always normalize through `standardQuantity × standardUnit`, never by unit name.
- Unit names are not unique (`Cup` and `cup` both exist); key on `id`.
- Count-like units (`piece`, `whole`, `clove`, `can`, `bunch`, `stalk`, `pinch`, ...) have no standardization. There is no unit named "each".

### C — Catalog sync

- food/unit/alias tables, sync, `POST /api/mealie/sync`, `GET /api/mealie/status`
- startup fire-and-forget sync, advisory lock, atomic transaction, deactivation guard

Tests: new food; renamed food; alias added/removed; disappeared food; food reappears; unit definition changes; failed/incomplete request leaves the previous cache intact; concurrent sync is skipped; deactivation guard trips.

### D — Mapping

- mapping table, mapping API, unmapped/problems endpoints
- rename/merge carry the mapping; 409 conflict resolution reusing the category flow
- broken-mapping (inactive food) handling
- add the new tables to the truncate list in `server/utils/database-reset.ts` so a reset leaves no dangling mappings
- a mapping whose item no longer has any entries is left in place and listed in Problems

### E — Suggestions

- `pg_trgm` extension in the migration
- exact name → exact alias → normalized → fuzzy

Tests: exact food name → suggestion; exact alias → suggestion; fuzzy match → suggestion only, never auto-accepted.

### F — Manage → Mealie UI

- Integration, Food mappings (All/Mapped/Unmapped/Broken), Problems
- hidden when Mealie is not configured

Browser-verify every flow end to end before closing.

### G — Price selection

- latest eligible non-sale purchase across mapped items, falling back to latest with `usedSalePrice`
- returns the exact observation used

### H — Recipe cost engine + endpoint

- recipe retrieval, same-dimension costing, `ea` rule, provenance, summary and coverage
- servings from `recipeServings` only

Tests: cup flour vs lb flour without density → `DIMENSION_MISMATCH`; "bunch" parsley → `UNSTANDARDIZED_UNIT`; ingredient without Mealie food → `NO_FOOD`; null/zero quantity → `NO_QUANTITY`; sub-recipe → `SUBRECIPE_UNSUPPORTED`; sale fallback sets `usedSalePrice`; Mealie unreachable → clear error.

### I — Recipe cost UI

- summary with "≥" under partial coverage, ingredient table, calculation details, fix links

### J — Food-specific conversions

- `food_conversions`, density and count→mass, management UI, `food_conversion`/`estimated_count` statuses

---

## Later Work

- stable `grocery_items` table and `item_id` references (backfill from item names, repoint mapping tables)
- per-food preferred grocery item; other price policies
- recipe scaling
- sub-recipe costing
- cross-recipe problem report
- historical recipe cost
- store-specific recipe cost
- shopping-list cost
- recipe price trends
- cost-per-serving analytics
