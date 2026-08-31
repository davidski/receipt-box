# Receipt Box

Receipt Box is a small, self-hosted receipt tracker designed for quick entry on an iPad. It turns grocery receipts into searchable purchase history, normalized price comparisons, data highlights, and portable CSV/XLSX exports.

## Disclaimer

Receipt Box is a vibe-coded personal project, developed iteratively with AI assistance. It is provided as-is. Review the code, configuration, security assumptions, and backup plan before relying on it.

## Overview

The interface is a client-rendered Nuxt application built with Nuxt UI.

A small Nitro API handles data server operations:

- entry list, create, edit, and delete
- item, store, and unit suggestions
- validated JSON batches used during import
- database health checks and startup migrations

CSV/XLSX parsing, formatting, and file generation happen in the browser. The browser talks to the API for data operations. In the default single-container deployment, Nitro also serves the generated static files; a reverse proxy can cache them normally.

## Features

- Compact multi-line receipt entry with a shared date and store
- One receipt per store and day, with later entry and imports appended to the existing receipt
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

- Node.js 26 or Docker
- pnpm 11.18
- PostgreSQL 17

The database role needs permission to connect and create tables and indexes in its schema. On first start, the app creates its tables and indexes automatically.

## Installation

### Complete local Docker stack

Start the app and a PostgreSQL 17 test instance:

```sh
docker compose -f compose.local.yaml up -d --build
```

Open `http://localhost:3000`. Compose uses the `receipt-box` project name, and PostgreSQL data is retained in the `pricebook-postgres` named volume. Set `POSTGRES_PORT` or `APP_PORT` before running Compose if either default port is occupied.

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

The production Compose file does not publish a host port. It joins an existing external Docker network named `traefik` by default so Traefik can route to the container's exposed port 3000. Set `TRAEFIK_NETWORK` in `.env` if the proxy network has another name.

> **Security note:** Authentication is disabled by default. Do not expose an unauthenticated deployment directly to the public internet. Use the optional OIDC mode described below, a private network, a VPN, or authentication at the reverse proxy.

### Optional OIDC authentication

Receipt Box can require authentication from an OpenID Connect provider such as Pocket ID. OIDC is optional and disabled by default; the same container image can be switched between modes at runtime.

Set these variables on the application container:

```dotenv
AUTH_MODE=oidc
NUXT_SESSION_PASSWORD=replace-with-at-least-32-random-characters
NUXT_OAUTH_OIDC_CLIENT_ID=receipt-box
NUXT_OAUTH_OIDC_CLIENT_SECRET=replace-with-the-oidc-client-secret
NUXT_OAUTH_OIDC_OPENID_CONFIG=https://auth.example.com/application/o/receipt-box/.well-known/openid-configuration
NUXT_OAUTH_OIDC_REDIRECT_URL=https://receiptbox.example.com/receiptbox/auth/oidc
```

Register the exact redirect URL with the OIDC provider. Receipt Box requests the `openid`, `profile`, and `email` scopes.

When OIDC mode is enabled, all Receipt Box data API routes require a sealed application session. The OIDC callback, session-management endpoint, authentication-status endpoint, and `/api/health` remain unauthenticated so login, logout, and container health checks can function. Protect the entire public `/receipt-box` prefix at the reverse proxy if the health endpoint should not be externally visible.

If `AUTH_MODE=oidc` is set without the required session password, client ID, client secret, or discovery URL, the application exits during startup with a configuration error. Set `AUTH_MODE=disabled` or omit it to retain the default unauthenticated behavior.

### Portainer without a container registry

When the image will not be pushed to a registry, build it on the same Docker host that Portainer manages. Use a versioned tag so that each deployment identifies an exact local image:

```sh
docker build \
  --tag receipt-box:latest \
  --build-arg NUXT_APP_BASE_URL=/receipt-box/ \
  --build-arg NUXT_PUBLIC_API_BASE=/receipt-box/api \
  .
```

Use that tag in the Portainer stack and set `pull_policy: never`. This example includes a dedicated PostgreSQL 17 Alpine container and follows the bind-mount, UID, checksum, logging, and backup conventions used by the other PostgreSQL stack:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    user: "1000:1000"
    shm_size: 1g
    environment:
      POSTGRES_DB: pricebook
      POSTGRES_USER: pricebook
      POSTGRES_PASSWORD: ${PGPASS}
      TZ: ${TZ}
      POSTGRES_INITDB_ARGS: --data-checksums
    healthcheck:
      test: ["CMD-SHELL", "PGPASSWORD=$$POSTGRES_PASSWORD psql -h 127.0.0.1 -U $$POSTGRES_USER -d $$POSTGRES_DB -c 'SELECT 1' >/dev/null 2>&1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    logging:
      driver: local
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - ${DOCKER_DIR}/pantry-pricebook/postgresql_db:/var/lib/postgresql/data
      - ${DOCKER_DIR}/pantry-pricebook/pg_socket:/var/run/postgresql
      - /etc/passwd:/etc/passwd:ro
    network_mode: none
    labels:
      traefik.enable: "false"
    restart: unless-stopped

  receiptbox:
    image: receipt-box:latest
    pull_policy: never
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://pricebook:${PGPASS}@localhost:5432/pricebook
      DATABASE_SOCKET_PATH: /var/run/postgresql/.s.PGSQL.5432
      AUTH_MODE: ${AUTH_MODE:-disabled}
      NUXT_SESSION_PASSWORD: ${NUXT_SESSION_PASSWORD:-}
      NUXT_OAUTH_OIDC_CLIENT_ID: ${NUXT_OAUTH_OIDC_CLIENT_ID:-}
      NUXT_OAUTH_OIDC_CLIENT_SECRET: ${NUXT_OAUTH_OIDC_CLIENT_SECRET:-}
      NUXT_OAUTH_OIDC_OPENID_CONFIG: ${NUXT_OAUTH_OIDC_OPENID_CONFIG:-}
      NUXT_OAUTH_OIDC_REDIRECT_URL: ${NUXT_OAUTH_OIDC_REDIRECT_URL:-}
    volumes:
      - ${DOCKER_DIR}/pantry-pricebook/pg_socket:/var/run/postgresql
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pricebook.entrypoints=${TRAEFIK_ENTRYPOINT:-websecure}"
      - "traefik.http.routers.pricebook.rule=Host(`${EXT_HOSTNAME}`) && PathPrefix(`/receipt-box`)"
      - "traefik.http.routers.pricebook.tls=true"
      - "traefik.http.routers.pricebook.tls.certresolver=${TRAEFIK_CERTRESOLVER:-myResolver}"
      - "traefik.http.routers.pricebook.service=pricebook"
      - "traefik.http.services.pricebook.loadbalancer.server.port=3000"
    depends_on:
      postgres:
        condition: service_healthy

networks:
  default:
    name: ${TRAEFIK_NETWORK:-traefik}
    external: true
```

Add `PGPASS`, `TZ`, `DOCKER_DIR`, and `EXT_HOSTNAME` as Portainer stack environment variables before deploying. Add the OIDC variables only when enabling authentication. If needed, override `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, or `TRAEFIK_CERTRESOLVER`; their defaults are `traefik`, `websecure`, and `myResolver`. Use a strong URL-safe value for `PGPASS` because the same value is interpolated into the PostgreSQL connection URL. `DOCKER_DIR` is the host directory beneath which the `pantry-pricebook/postgresql_db` and `pantry-pricebook/pg_socket` directories will be stored; create those directories and make them writable by UID/GID `1000:1000` before the first deployment.

The router matches `https://${EXT_HOSTNAME}/pricebook/*`. Do not add a strip-prefix middleware: this image is built with `NUXT_APP_BASE_URL=/pricebook/`, and both the static app and API expect that prefix.

The application and PostgreSQL containers share the `pg_socket` bind mount. `DATABASE_SOCKET_PATH` makes Postgres.js connect through that Unix socket; the hostname and port in `DATABASE_URL` are retained only so the URL can provide the database name and credentials. PostgreSQL uses `network_mode: none` and does not publish port 5432 or join a Docker network. Its health check deliberately queries the final server over container-local TCP, which is unavailable from the temporary initialization server.

The `never` policy applies to the locally built application image and tells Compose to fail rather than contact a registry when that exact tag is missing. The PostgreSQL image continues to pull normally from its registry.

For an update:

1. Build the new source on the managed Docker host with a new tag, such as `pantry-pricebook:2026-08-05-3`.
2. Change the stack's `image` value to the new tag.
3. Redeploy the stack.


The repository's `compose.yaml` contains a `build` section for command-line Compose. For the Portainer no-registry workflow, use the image-only stack pattern above so that `pull_policy: never` and the prebuilt tag are explicit.

## Configuration

The application uses these settings:

| Setting | Applied | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | At container start | Private PostgreSQL connection string used only by the server |
| `DATABASE_SOCKET_PATH` | At container start | Optional full Unix socket filename that overrides the URL host and port |
| `AUTH_MODE` | At container start | Optional authentication mode: `disabled` by default or `oidc` |
| `NUXT_SESSION_PASSWORD` | At container start | Secret of at least 32 characters used to seal OIDC sessions |
| `NUXT_OAUTH_OIDC_CLIENT_ID` | At container start | OIDC relying-party client identifier |
| `NUXT_OAUTH_OIDC_CLIENT_SECRET` | At container start | OIDC relying-party client secret |
| `NUXT_OAUTH_OIDC_OPENID_CONFIG` | At container start | Full URL of the provider's OpenID configuration document |
| `NUXT_OAUTH_OIDC_REDIRECT_URL` | At container start | Optional explicit public callback URL; recommended behind a reverse proxy |
| `APP_PORT` | At container start | Host port used only by the local test stack |
| `TRAEFIK_NETWORK` | At deployment | Existing external Docker network used by Traefik; defaults to `traefik` |
| `TRAEFIK_ENTRYPOINT` | At deployment | Traefik HTTPS entrypoint; defaults to `websecure` |
| `TRAEFIK_CERTRESOLVER` | At deployment | Traefik certificate resolver; defaults to `myResolver` |
| `EXT_HOSTNAME` | At deployment | Public hostname matched by the Traefik router |
| `NUXT_APP_BASE_URL` | At image build | Public path where the app is mounted; must start and end with `/` |
| `NUXT_PUBLIC_API_BASE` | At image build | URL used by the browser for API requests; may be a path or full URL |

For a typical subpath deployment, use:

```dotenv
NUXT_APP_BASE_URL=/receipt-box/
NUXT_PUBLIC_API_BASE=/receipt-box/api
```

Nuxt embeds both public URL values in the client at build time. Changing either one requires rebuilding the image; changing only the running container environment will not update the static client.

In the normal single-container deployment, Nuxt mounts both the generated app and Nitro beneath `/receipt-box/`. Forward the reverse proxy's `/receipt-box/*` location to the container without stripping the prefix. If `NUXT_PUBLIC_API_BASE` is omitted, the build derives it from `NUXT_APP_BASE_URL`.

If the reverse proxy exposes the API at the origin root, use:

```dotenv
NUXT_APP_BASE_URL=/receipt-box/
NUXT_PUBLIC_API_BASE=/api
```

Then forward public `/api/*` requests to the container's `/receipt-box/api/*`. To use another API origin, provide a full URL and allow the app origin in that API proxy's CORS policy.

## Importing existing Numbers history

1. Open `Food_History.numbers` in Apple Numbers.
2. Choose **File → Export To → Excel**.
3. Select **One Per Table** when Numbers asks how to organize the export.
4. Open **Manage → Import & export** in Receipt Box and import the `.xlsx` file.

The importer recognizes the original columns:

`food_Date`, `Item`, `Location`, `Size`, `Unit`, `Price`, `Cost_Per_Unit`, `Sale_Item`, `Non_Grocery`, and `Notes`.

Legacy `Unit_Price` columns are ignored. Import adds rows and never deletes existing data. Rows for the same store and date are appended to one receipt, but importing the same workbook twice still duplicates its line items.

## Export and backup

**Manage → Import & export** exports the complete history as a single flat CSV or XLSX table with these columns:

`purchase_date`, `item`, `store`, `package_size`, `package_unit`, `price`, `normalized_price`, `normalized_basis`, `on_sale`, `non_grocery`, and `notes`.

Dates use `YYYY-MM-DD`, flags use true/false values, and `normalized_basis` identifies values such as `Per 100 g`, `Per 100 mL`, or `Each`. The importer also accepts these headings.

## Development commands

```sh
pnpm dev        # development server
pnpm typecheck  # Vue and TypeScript checks
pnpm build      # production build
pnpm generate   # static client-only route output
pnpm start      # run the production build
```
