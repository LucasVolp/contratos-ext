FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @contracts/web
COPY apps/web apps/web
RUN pnpm --filter @contracts/web build
WORKDIR /app/apps/web
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
EXPOSE 3100
CMD ["pnpm", "start"]
