# Node services (gateway, operator, challenger) from the pnpm workspace. One image; the command picks the service.
FROM node:22.11.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --filter "!@hallmark/web"
ENV NODE_ENV=production
# e.g. command: ["npx", "tsx", "packages/gateway/src/main.ts"]
CMD ["npx", "tsx", "packages/gateway/src/main.ts"]
