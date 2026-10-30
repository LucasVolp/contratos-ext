FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @contracts/api
COPY apps/api apps/api
RUN pnpm --filter @contracts/api build
WORKDIR /app/apps/api
EXPOSE 4100
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
