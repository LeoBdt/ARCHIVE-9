# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --prod
COPY . .
RUN pnpm install --offline --prod --frozen-lockfile --filter @archive-9/bot...

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/packages/core ./packages/core
COPY --from=deps --chown=node:node /app/packages/db ./packages/db
COPY --from=deps --chown=node:node /app/apps/bot ./apps/bot
USER node
WORKDIR /app/apps/bot
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "--max-old-space-size=256", "src/main.ts"]
