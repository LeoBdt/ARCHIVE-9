# Deployment

Target: a Linux amd64 server with Docker, and Portainer or `docker compose`.

## 1. Discord application

1. Create an application in the [Discord developer portal](https://discord.com/developers/applications).
2. **Bot** tab: generate the token (`DISCORD_TOKEN`) and enable the **Server Members** and **Message Content** privileged intents.
3. **OAuth2 > URL Generator** tab: scopes `bot` and `applications.commands`, then these permissions:
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History
   - Add Reactions
   - Embed Links
4. Open the generated URL to invite the bot to the server.

Never grant the bot's role: Administrator, Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Server, or Manage Roles with sensitive permissions.

To get `DISCORD_GUILD_ID`, enable Discord's developer mode, then right-click the server > Copy Server ID.

## 2. Image

The CI publishes `ghcr.io/<owner>/archive-9-bot` on every push to `main`. After the first publish, set the package to **public** in its GitHub settings. Otherwise, registry credentials must be configured in Portainer and WUD.

## 3. Variables

Start from [`.env.example`](../.env.example).

| Variable | Description |
|---|---|
| `BOT_IMAGE` | bot image, e.g. `ghcr.io/<owner>/archive-9-bot:latest` |
| `DISCORD_TOKEN` | bot token |
| `DISCORD_GUILD_ID` | server ID |
| `KNOWN_AI_BOT_IDS` | IDs of the other AI bots, comma separated |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | database; the password must only contain letters and digits since it goes into a URL |
| `BACKUP_KEEP_DAYS` | backup retention (default 7) |
| `WUD_PORT` | WUD web UI port (default 3000) |
| `WUD_ADMIN_USER`, `WUD_ADMIN_PASSWORD` | WUD admin account |
| `WUD_SESSION_SECRET` | at least 32 random characters (`openssl rand -hex 32`) |
| `LOG_LEVEL` | defaults to `info` |

## 4. Portainer

1. **Stacks > Add stack**, name it `archive-9`.
2. Paste [`docker-compose.yml`](../docker-compose.yml) into the web editor.
3. Under **Environment variables**, switch to advanced mode and paste the variables.
4. **Deploy the stack**.

On first start, the bot applies migrations, then logs in to Discord.

## 5. Updates

WUD only watches containers labelled `wud.watch=true`, i.e. `bot`. A new `latest` image on GHCR makes it recreate the container automatically.

`postgres` is never updated automatically. Major version upgrades are done by hand, through a backup and restore.

The WUD UI (port `WUD_PORT`) has access to the Docker socket: never expose it to the internet.

## 6. Backups

Dumps live in the `backups` volume, named `archive9-YYYY-MM-DD.dump`.

Restore:

```sh
docker cp archive9-2026-01-01.dump archive-9-postgres-1:/tmp/restore.dump
docker exec archive-9-postgres-1 pg_restore -U archive9 -d archive9 --clean --if-exists /tmp/restore.dump
```

Copy this volume off the server regularly.
