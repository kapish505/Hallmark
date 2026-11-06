# Static web app. VITE_* values are baked in at build time (they are public, not secrets).
FROM node:22.11.0-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
ARG VITE_GATEWAY_URL
ARG VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
RUN cd packages/web && npx vite build

FROM caddy:2.8.4-alpine
COPY --from=build /app/packages/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
