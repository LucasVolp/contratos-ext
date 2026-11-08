FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/validation packages/validation
RUN pnpm install --frozen-lockfile --filter @contracts/api

# Development: compose.override.yaml mounts the source over this stage.
FROM deps AS dev
WORKDIR /app/apps/api
EXPOSE 4100
# Sync dependencies with the mounted manifests on every start (fast when unchanged).
ENV CI=true
CMD ["sh", "-c", "pnpm install --frozen-lockfile --filter @contracts/api && pnpm db:migrate && pnpm dev"]

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @contracts/api build
WORKDIR /app/apps/api
EXPOSE 4100
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
