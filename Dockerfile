# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Build stage: full pnpm workspace install + build the API bundle.
# ---------------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy the whole monorepo (the API bundle pulls in workspace libs at build time).
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

# ---------------------------------------------------------------------------
# Runtime stage: tiny image, just Node + the self-contained API bundle.
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/artifacts/api-server/dist ./dist
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

# ---------------------------------------------------------------------------
# Migrate stage: keeps the full workspace so `drizzle-kit push` can read the
# Drizzle schema. Run as a one-off ECS task before each deploy.
# ---------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /app/lib/db
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@workspace/db", "run", "push-force"]
