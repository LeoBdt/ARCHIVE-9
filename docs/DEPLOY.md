# Déploiement

Cible : un serveur Linux amd64 avec Docker, et Portainer ou `docker compose`.

## 1. Application Discord

1. Créer une application sur le [portail développeur Discord](https://discord.com/developers/applications).
2. Onglet **Bot** : générer le token (`DISCORD_TOKEN`) et activer les intents privilégiés **Server Members** et **Message Content**.
3. Onglet **OAuth2 > URL Generator** : scopes `bot` et `applications.commands`, puis les permissions :
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History
   - Add Reactions
   - Embed Links
4. Ouvrir l'URL générée pour inviter le bot sur le serveur.

Ne jamais accorder au rôle du bot : Administrator, Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Server, Manage Roles avec des permissions sensibles.

`DISCORD_GUILD_ID` s'obtient en activant le mode développeur de Discord, puis clic droit sur le serveur > Copier l'identifiant.

## 2. Image

La CI publie `ghcr.io/<owner>/archive-9-bot` à chaque push sur `main`. Après la première publication, passer le paquet en **public** dans les réglages du paquet sur GitHub. Sinon, il faut configurer un accès au registre dans Portainer et dans WUD.

## 3. Variables

Partir de [`.env.example`](../.env.example).

| Variable | Rôle |
|---|---|
| `BOT_IMAGE` | image du bot, par exemple `ghcr.io/<owner>/archive-9-bot:latest` |
| `DISCORD_TOKEN` | token du bot |
| `DISCORD_GUILD_ID` | ID du serveur |
| `KNOWN_AI_BOT_IDS` | ID des autres bots IA, séparés par des virgules |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | base de données ; le mot de passe ne contient que des lettres et des chiffres, car il est inséré dans une URL |
| `BACKUP_KEEP_DAYS` | durée de conservation des sauvegardes (7 par défaut) |
| `WUD_PORT` | port de l'interface WUD (3000 par défaut) |
| `WUD_ADMIN_USER`, `WUD_ADMIN_PASSWORD` | compte admin de WUD |
| `WUD_SESSION_SECRET` | 32 caractères aléatoires minimum (`openssl rand -hex 32`) |
| `LOG_LEVEL` | `info` par défaut |

## 4. Portainer

1. **Stacks > Add stack**, nom `archive-9`.
2. Coller le contenu de [`docker-compose.yml`](../docker-compose.yml) dans l'éditeur web.
3. Dans **Environment variables**, passer en mode avancé et coller les variables.
4. **Deploy the stack**.

Au premier démarrage, le bot applique les migrations, puis se connecte à Discord.

## 5. Mises à jour

WUD surveille uniquement les conteneurs qui portent le label `wud.watch=true`, c'est-à-dire `bot`. Une nouvelle image `latest` sur GHCR entraîne la recréation automatique du conteneur.

`postgres` n'est jamais mis à jour automatiquement. Un changement de version majeure se fait à la main, par sauvegarde puis restauration.

L'interface de WUD (port `WUD_PORT`) a accès au socket Docker : elle ne doit pas être exposée sur Internet.

## 6. Sauvegardes

Les dumps sont dans le volume `backups`, au format `archive9-AAAA-MM-JJ.dump`.

Restauration :

```sh
docker cp archive9-2026-01-01.dump archive-9-postgres-1:/tmp/restore.dump
docker exec archive-9-postgres-1 pg_restore -U archive9 -d archive9 --clean --if-exists /tmp/restore.dump
```

Copier régulièrement ce volume hors du serveur.
