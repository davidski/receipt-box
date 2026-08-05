# Pantry Pricebook

Pantry Pricebook is a small, self-hosted grocery price tracker designed for quick receipt entry on an iPad. It replaces a Numbers workbook with searchable history, normalized price comparisons, data highlights, and CSV/XLSX import and export.

## Disclaimer

Pantry Pricebook is a vibe-coded personal project, developed iteratively with AI assistance. It is provided as-is. Review the code, configuration, security assumptions, and backup plan before relying on it.

## Overview

The interface is a client-rendered Nuxt application built with Nuxt UI. Its route shells and assets are generated as static files at build time, so opening or navigating between pages does not invoke PostgreSQL or server-side rendering.

A small Nitro API handles only the operations that require the server:

- entry list, create, edit, and delete
- item, store, and unit suggestions
- validated JSON batches used during import
- database health checks and startup migrations

CSV/XLSX parsing, formatting, and file generation happen in the browser. The browser talks to the API for data operations. In the default single-container deployment, Nitro also serves the generated static files; a reverse proxy can cache them normally.

## Features

- Fast “save and add another” receipt entry flow
- Nuxt UI autocomplete that suggests prior values while accepting new items
- Reuse of the latest store, size, and unit when an existing item is selected
- Automatic normalized cost per item or per 100 weight/volume units
- Searchable, sortable, and editable price history
- Sale indicators, previous-purchase comparisons, and price-change filters
- Highlights for recent activity, price moves, totals, stores, and sale frequency
- Item-level normalized price history graphs
- Store catalog with add, rename/merge, and safe deletion controls
- CSV and XLSX import and export using a clean, single-table schema
- System-aware light and dark modes
- Responsive iPad, phone, and desktop layouts
- PostgreSQL 17 storage

## Requirements

- Node.js 22 or Docker
- pnpm 11.18 or Corepack
- PostgreSQL 17

The database role needs permission to connect and create tables and indexes in its schema. On first start, the app creates its tables and indexes automatically.

## Installation

### Complete local Docker stack

Start the app and a PostgreSQL 17 test instance:

```sh
docker compose -f compose.local.yaml up -d --build
```

Open `http://localhost:3000`. PostgreSQL data is retained in the `pricebook-postgres` named volume. Set `POSTGRES_PORT` or `APP_PORT` before running Compose if either default port is occupied.

### Local development

Start only PostgreSQL:

```sh
docker compose -f compose.local.yaml up -d postgres
```

Create the local environment file:

```sh
cp .env.example .env
```

Use this connection string in `.env`:

```dotenv
DATABASE_URL=postgres://pricebook:local-pricebook-only@127.0.0.1:5432/pricebook
```

Install the dependencies and start Nuxt:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

## Deployment

### Docker Compose

Create `.env` from `.env.example`, then set `DATABASE_URL` and the public URL values described under [Configuration](#configuration). Build and start the app:

```sh
docker compose up -d --build
```

The included Compose file binds the app to `127.0.0.1:3000` by default. Point an HTTPS reverse proxy at that address, or set `APP_PORT` in `.env` to use another port.

> **Security note:** The app intentionally has no built-in user accounts. Do not expose it directly to the public internet. Use a private network, VPN, or authentication at the reverse proxy.

### Portainer without a container registry

When the image will not be pushed to a registry, build it on the same Docker host that Portainer manages. Use a versioned tag so that each deployment identifies an exact local image:

```sh
docker build \
  --tag pantry-pricebook:2026-08-05-1 \
  --build-arg NUXT_APP_BASE_URL=/pricebook/ \
  --build-arg NUXT_PUBLIC_API_BASE=/pricebook/api \
  .
```

Use that tag in the Portainer stack and set `pull_policy: never`:

```yaml
services:
  pricebook:
    image: pantry-pricebook:2026-08-05-1
    pull_policy: never
    restart: unless-stopped
    environment:
      DATABASE_URL: ${DATABASE_URL}
    ports:
      - "3000:3000"
```

Add `DATABASE_URL` as a Portainer stack environment variable before deploying. The `never` policy tells Compose to use only the image already present on the Docker host; deployment fails instead of trying a registry when that exact tag is missing.

For an update:

1. Build the new source on the managed Docker host with a new tag, such as `pantry-pricebook:2026-08-05-2`.
2. Change the stack's `image` value to the new tag.
3. Redeploy the stack.
4. Remove old images only after confirming the new container works.

Every Docker node that might run the service must have the tagged image. If the image is built on another computer, transfer it to the managed host and load it before deploying:

```sh
docker save pantry-pricebook:2026-08-05-1 | gzip > pantry-pricebook-2026-08-05-1.tar.gz
gunzip -c pantry-pricebook-2026-08-05-1.tar.gz | docker load
```

The repository's `compose.yaml` contains a `build` section for command-line Compose. For the Portainer no-registry workflow, use the image-only stack pattern above so that `pull_policy: never` and the prebuilt tag are explicit.

## Configuration

The application uses these settings:

| Setting | Applied | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | At container start | Private PostgreSQL connection string used only by the server |
| `APP_PORT` | At container start | Host port used by the supplied Compose files |
| `NUXT_APP_BASE_URL` | At image build | Public path where the app is mounted; must start and end with `/` |
| `NUXT_PUBLIC_API_BASE` | At image build | URL used by the browser for API requests; may be a path or full URL |

For a typical subpath deployment, use:

```dotenv
NUXT_APP_BASE_URL=/pricebook/
NUXT_PUBLIC_API_BASE=/pricebook/api
```

Nuxt embeds both public URL values in the client at build time. Changing either one requires rebuilding the image; changing only the running container environment will not update the static client.

In the normal single-container deployment, Nuxt mounts both the generated app and Nitro beneath `/pricebook/`. Forward the reverse proxy's `/pricebook/*` location to the container without stripping the prefix. If `NUXT_PUBLIC_API_BASE` is omitted, the build derives it from `NUXT_APP_BASE_URL`.

If the reverse proxy exposes the API at the origin root, use:

```dotenv
NUXT_APP_BASE_URL=/pricebook/
NUXT_PUBLIC_API_BASE=/api
```

Then forward public `/api/*` requests to the container's `/pricebook/api/*`. To use another API origin, provide a full URL and allow the app origin in that API proxy's CORS policy.

## Importing existing Numbers history

1. Open `Food_History.numbers` in Apple Numbers.
2. Choose **File → Export To → Excel**.
3. Select **One Per Table** when Numbers asks how to organize the export.
4. Open **Manage → Import & export** in Pantry Pricebook and import the `.xlsx` file.

The importer recognizes the original columns:

`food_Date`, `Item`, `Location`, `Size`, `Unit`, `Price`, `Cost_Per_Unit`, `Sale_Item`, `Non_Grocery`, and `Notes`.

Legacy `Unit_Price` columns are ignored. Import adds rows and never deletes existing data, so import the workbook once to avoid duplicating its history.

## Export and backup

**Manage → Import & export** exports the complete history as a single flat CSV or XLSX table with these columns:

`purchase_date`, `item`, `store`, `package_size`, `package_unit`, `price`, `normalized_price`, `normalized_basis`, `on_sale`, `non_grocery`, and `notes`.

Dates use `YYYY-MM-DD`, flags use true/false values, and `normalized_basis` identifies values such as `Per 100 g`, `Per 100 mL`, or `Each`. The importer also accepts these headings.

PostgreSQL remains the source of truth. Include the database in the host's regular backup routine rather than treating spreadsheet exports as the only backup.

## Development commands

```sh
pnpm dev        # development server
pnpm typecheck  # Vue and TypeScript checks
pnpm build      # production build
pnpm generate   # static client-only route output
pnpm start      # run the production build
```
