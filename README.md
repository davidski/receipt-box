# Receipt Box

[![Docker Image](https://img.shields.io/badge/ghcr.io-receipt--box-blue?logo=docker)](https://ghcr.io/davidski/receipt-box)

Receipt Box is a self-hosted receipt tracker designed for quick browser
entry. It turns grocery receipts into searchable purchase history,
normalized price comparisons, and data highlights.

## Disclaimer

Receipt Box is a personal project, developed with AI assistance. Review the
code, configuration, security assumptions, and have a backup plan before
relying on it.

## License

Receipt Box is licensed under the [MIT License](LICENSE).

## Overview

Receipt Box is a self-hosted web app with a browser interface and an
application server. The app server stores receipt data in a PostgreSQL
database. The included local Docker Compose setup runs the app server and
database server in separate containers; you can also connect the app to an
existing PostgreSQL server. CSV and XLSX import and export are handled in the
browser.

## Features

- Multi-line receipt entry with shared date and store, item suggestions, and reused item details
- Purchases grouped by store and day, with later entries and imports appended
- Searchable, sortable, editable history with sale and previous-price comparisons
- Normalized price comparisons and per-item history graphs
- Highlights for totals, price changes, stores, categories, and sales
- Store and category management
- CSV and XLSX import and export

## Requirements

- Node.js 26 or Docker
- pnpm 11.18
- PostgreSQL 17

The database role needs permission to connect and create tables and indexes,
which are created automatically on first start.

## Installation

### Complete local Docker stack

Start the app and a database instance:

```sh
docker compose up -d --build
```

Open `http://localhost:3000`.

### Local development

Start only PostgreSQL:

```sh
docker compose up -d postgres
```

Create the local environment file:

```sh
cp .env.example .env
```

Use this connection string in `.env`:

```dotenv
DATABASE_URL=postgres://receiptbox:local-receipt-box-only@127.0.0.1:5432/receiptbox
```

Install the dependencies and start Nuxt:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

## Deployment

Use the repository's `compose.yaml` to run the app server and PostgreSQL
database together. It publishes both services on loopback by default; see
[Reverse proxy](#reverse-proxy) to route public traffic to the app.

> **Security note:** Authentication is disabled by default. Do not expose an
> unauthenticated deployment directly to the public internet. Use the
> optional OIDC mode described below, a private network, a VPN, or authentication
> at the reverse proxy.

### Optional OIDC authentication

While not enabled by default, an OIDC provider such as [Pocket ID](https://pocket-id.org/) can be used to auth users.

A user-set `NUXT_SESSION_PASSWORD` is used to seal Receipt Box's
session cookies. This can be generated with `openssl rand -base64 48`, after which it
should be treated as a secret.

Assign the command's output to `NUXT_SESSION_PASSWORD` in `.env`, then set the
OIDC variables on the application container:

```dotenv
AUTH_MODE=oidc
NUXT_SESSION_PASSWORD=replace-with-at-least-32-random-characters
NUXT_OAUTH_OIDC_CLIENT_ID=receipt-box
NUXT_OAUTH_OIDC_CLIENT_SECRET=replace-with-the-oidc-client-secret
NUXT_OAUTH_OIDC_OPENID_CONFIG=https://auth.example.com/application/o/receipt-box/.well-known/openid-configuration
NUXT_OAUTH_OIDC_REDIRECT_URL=https://receiptbox.example.com/receipt-box/auth/oidc
```

Register the exact redirect URL with the OIDC provider. Receipt Box requests
the `openid`, `profile`, and `email` scopes.

When OIDC mode is enabled, all Receipt Box data API routes require auth. The
OIDC callback, session-management endpoint, authentication-status endpoint,
and `/api/health` remain unauthenticated.

## Configuration

The application uses these settings:

| Setting | Applied | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | At container start | Private PostgreSQL connection string used only by the server |
| `DATABASE_SOCKET_PATH` | At container start | Optional full Unix socket filename that overrides the URL host and port |
| `AUTH_MODE` | At container start | Optional authentication mode: `disabled` by default or `oidc` |
| `NUXT_SESSION_PASSWORD` | At container start | Secret of at least 32 characters used to seal app session cookies; required for OIDC sign-in |
| `NUXT_OAUTH_OIDC_CLIENT_ID` | At container start | OIDC relying-party client identifier |
| `NUXT_OAUTH_OIDC_CLIENT_SECRET` | At container start | OIDC relying-party client secret |
| `NUXT_OAUTH_OIDC_OPENID_CONFIG` | At container start | Full URL of the provider's OpenID configuration document |
| `NUXT_OAUTH_OIDC_REDIRECT_URL` | At container start | Optional explicit public callback URL; recommended behind a reverse proxy |
| `APP_PORT` | At container start | Host loopback port used to reach the app server |
| `NUXT_APP_BASE_URL` | At image build | Public path where the app is mounted; must start and end with `/` |
| `NUXT_PUBLIC_API_BASE` | At image build | URL used by the browser for API requests; may be a path or full URL |

## Reverse proxy

The Compose setup binds the app server to `127.0.0.1:3000` by default. Configure
your reverse proxy to forward public requests to that address. If the proxy
runs in another container, connect it to a Docker network shared with the app
and forward requests to the app service on port `3000`.

For a deployment under a path prefix such as `/receipt-box/`, build the app
with matching public URL settings:

```dotenv
NUXT_APP_BASE_URL=/receipt-box/
NUXT_PUBLIC_API_BASE=/receipt-box/api
```

These public URL settings are embedded in the app image at build time. Rebuild
the image after changing either setting.

Configure the proxy to forward the `/receipt-box/` path to the app without
stripping the prefix. If `NUXT_PUBLIC_API_BASE` is omitted, it defaults to the
API path under `NUXT_APP_BASE_URL`.

If the reverse proxy exposes the API at the origin root, use:

```dotenv
NUXT_APP_BASE_URL=/receipt-box/
NUXT_PUBLIC_API_BASE=/api
```

In this setup, configure the proxy to forward public `/api/*` requests to the
app's `/receipt-box/api/*` path. To use another API origin, provide a full URL
and allow the app origin in that API's CORS policy.

## Export and backup

**Manage → Import & export** exports the complete history as a single flat CSV or XLSX table with these columns:

`purchase_date`, `item`, `category`, `store`, `package_size`, `package_unit`, `price`, `normalized_price`, `normalized_basis`, `on_sale`, `non_grocery`, and `notes`.

## Development commands

```sh
pnpm dev        # development server
pnpm typecheck  # Vue and TypeScript checks
pnpm build      # production build
pnpm generate   # static client-only route output
pnpm start      # run the production build
```
