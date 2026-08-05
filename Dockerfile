FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG NUXT_APP_BASE_URL=/
ARG NUXT_PUBLIC_API_BASE
ENV NUXT_APP_BASE_URL=$NUXT_APP_BASE_URL
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
