# syntax=docker/dockerfile:1

FROM node:26-alpine AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter @archive-9/web...
RUN pnpm --filter @archive-9/web build

FROM node:26-alpine AS deps
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --prod
COPY . .
RUN pnpm install --offline --prod --frozen-lockfile --filter @archive-9/web...

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Every workspace package, so a new one is never left out of the image
COPY --from=deps --chown=node:node /app/packages ./packages
COPY --from=deps --chown=node:node /app/apps/web ./apps/web
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "--max-old-space-size=192", "src/server/main.ts"]
