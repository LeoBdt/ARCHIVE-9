# ARCHIVE-9

An archiving AI for Discord. It watches the channels it is given, gets to know each member, keeps a profile on everyone and speaks when it sees fit.

## Structure

```
apps/
  bot/        Discord process
packages/
  core/       domain types and rules, no I/O
  ai/         AI providers, tasks and prompts
  db/         Drizzle schema, migrations, database access
  config/     shared tsconfig and ESLint
docker/       Dockerfiles
docs/         architecture
```

## Development

Requirements: Node 24+, pnpm, Docker.

```sh
pnpm install
docker run -d --name archive9-pg -e POSTGRES_USER=archive9 -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=archive9 -p 5432:5432 postgres:18-alpine
cp .env.example .env   # set DISCORD_TOKEN and DISCORD_GUILD_ID
pnpm dev:bot
```

| Command | Description |
|---|---|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` | Vitest (database tests need `TEST_DATABASE_URL`) |
| `pnpm test:coverage` | Vitest with coverage |
| `pnpm db:generate --name <name>` | New migration after a schema change |
| `pnpm dev:web` | Site server (API); `pnpm --filter @archive-9/web dev:client` serves the client with Vite |
| `pnpm backfill --days 30 --dry-run` | Count and price the history of the listened channels (`--max-cost <usd>` to analyse it) |

TypeScript runs directly on Node, with no build step.

## Contributing

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- `main` is protected: changes go through a PR, with the `check`, `secrets` and `image` jobs passing.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
