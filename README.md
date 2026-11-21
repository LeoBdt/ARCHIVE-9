# ARCHIVE-9

Une IA d'archivage pour Discord. Elle observe les salons qu'on lui confie, apprend à connaître chaque membre, garde une fiche sur chacun et parle quand elle le juge utile.

## Structure

```
apps/
  bot/        process Discord
packages/
  core/       types et règles du domaine, sans I/O
  db/         schéma Drizzle, migrations, accès à la base
  config/     tsconfig et ESLint partagés
docker/       Dockerfiles
docs/         architecture et déploiement
```

## Développement

Prérequis : Node 24 ou plus, pnpm, Docker.

```sh
pnpm install
docker run -d --name archive9-pg -e POSTGRES_USER=archive9 -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=archive9 -p 5432:5432 postgres:18-alpine
cp .env.example .env   # renseigner DISCORD_TOKEN et DISCORD_GUILD_ID
pnpm dev:bot
```

| Commande | Rôle |
|---|---|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript sur tous les paquets |
| `pnpm test` | Vitest (les tests de base de données demandent `TEST_DATABASE_URL`) |
| `pnpm test:coverage` | Vitest avec couverture |
| `pnpm db:generate --name <nom>` | Nouvelle migration après une modification du schéma |

Le code TypeScript est exécuté directement par Node, sans étape de build.

## Contribuer

- Commits au format [Conventional Commits](https://www.conventionalcommits.org/fr/).
- `main` est protégée : passage par une PR, avec les jobs `check`, `secrets` et `image` au vert.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Déploiement](docs/DEPLOY.md)

## Crédits

Plusieurs idées viennent de [Jean Pascal](https://github.com/Bluzzi/Discord-AI-Bot), avec l'accord de son auteur.
