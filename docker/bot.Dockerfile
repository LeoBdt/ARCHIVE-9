# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --prod
COPY . .
RUN pnpm install --offline --prod --frozen-lockfile --filter @archive-9/bot...

FROM node:26-alpine
# Commit of the build, turned into the version name shown by the bot
ARG GIT_SHA=dev
ENV NODE_ENV=production GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Every workspace package, so a new one is never left out of the image
COPY --from=deps --chown=node:node /app/packages ./packages
COPY --from=deps --chown=node:node /app/apps/bot ./apps/bot
# Its own documentation, read by the howIWork tool
COPY --from=deps --chown=node:node /app/docs ./docs
USER node
WORKDIR /app/apps/bot
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "--max-old-space-size=256", "src/main.ts"]
