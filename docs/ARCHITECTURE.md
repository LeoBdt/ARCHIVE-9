# Architecture

## Services

```mermaid
flowchart LR
  D[Discord] <-->|gateway| BOT[bot]
  BOT --> PG[(postgres)]
  BOT -->|reply, analysis, reflection| OR[OpenRouter · DeepSeek]
  BOT -->|triage, fallback| G[Groq]
  BK[backup] -->|daily pg_dump| PG
```

| Service | Image | `mem_limit` | Role |
|---|---|---|---|
| `postgres` | `postgres:18-alpine` | 1 GB | database, on an internal network with no internet access |
| `bot` | `ghcr.io/<owner>/archive-9-bot` | 384 MB | Discord process |
| `backup` | `postgres:18-alpine` | 64 MB | `pg_dump` at startup then every 24 h, keeps `BACKUP_KEEP_DAYS` days |

Deployment is pull-based: the host checks `main` every minute, pulls the `bot` image only and runs `docker compose up -d --remove-orphans`, which recreates only what changed. Nothing on the host is reachable from the internet. `postgres` and `backup` are updated by hand.

Postgres settings: `shared_buffers=256MB`, `effective_cache_size=640MB`, `work_mem=4MB`, `maintenance_work_mem=64MB`, `max_connections=30`.

## Packages

| Package | Content |
|---|---|
| `core` | pure domain logic: ingress decision, bot loop guard, debouncer, transcript formatting, name matching, conversation grouping, relationship caps, self state limits, job schedules |
| `ai` | provider setup, fallback runtime with cooldowns, triage, reply, analysis, summary and reflection tasks, prompts |
| `db` | Drizzle schema, migrations and repositories |
| `config` | shared tsconfig and ESLint |

Dependencies flow one way: `apps → packages`. `core` depends on no other package. `db` is the only one that runs SQL.

Each package exports its `.ts` sources directly. Node runs them through type stripping, which requires erasable TypeScript syntax (`erasableSyntaxOnly`): no `enum`, no `namespace`.

## Bot startup

1. Environment variables are read and validated with zod. The process exits if one is missing.
2. Pending Drizzle migrations are applied.
3. The bot logs in to Discord.
4. A health server listens on `HEALTH_PORT`: `GET /health` returns 200 when Discord is connected and the database responds, 503 otherwise. Docker uses it as the healthcheck.

## Message flow

```mermaid
flowchart TD
  M[messageCreate] --> S[(messages)]
  M --> F{ingress decision}
  F -->|self, paused, opted out, unlistened, foreign bot, emoji only| X[ignored]
  F -->|known AI bot| L{loop guard}
  L -->|blocked| X
  L -->|allowed, addressed| R
  L -->|allowed| O
  F -->|mention, name, reply, DM| R
  F -->|other| O{spontaneity > 0, active conversation<br/>or weak name?}
  O -->|no| X
  O -->|yes| DB[debounce per channel]
  DB --> T[triage]
  T -->|addressed| R[reply]
  T -->|not addressed| B{interest ≥ threshold<br/>and hourly budget left?}
  B -->|no| X
  B -->|yes| R
  R --> OUT[send tools]
```

- Messages from listened channels (and their threads) are stored, along with edits, deletions and reaction counts. DMs are answered but never stored. Opted-out members are never stored.
- A message is **addressed** to ARCHIVE-9 without AI when it mentions it, contains a strong name (`BOT_ALIASES`, ignored after an apostrophe), replies to one of its messages, is a DM, or comes from the person it just answered within 2 minutes with nobody else speaking in between.
- A weak name (`BOT_SOFT_ALIASES`, e.g. « archive », also a common verb) sends the message to triage instead.
- In observer mode, messages still go to triage for 3 minutes after ARCHIVE-9 spoke in the channel.
- **Triage** gets the last 10 messages and a note computed by the code (whether ARCHIVE-9 is in the conversation, who it answered, who wrote since, who the message replies to, weak name match), and returns `{ addressed, interest, reason, toolPacks }`, validated with zod. `addressed` means the message is for ARCHIVE-9; `interest` (0–10) is the value of an unprompted intervention. Within a burst, the last human message stays the target even if a bot answers right after.
- Transcripts show who each reply is for (`↪ à Dave`).
- **Reply** gets the last 20 messages, the participants' profile summaries and relationships, and the current self state, all built by the code. The model speaks only by calling `sendReply` or `sendMessage`; no call means silence. Tools are bound to the current channel and target message.
- The bot loop guard allows at most 3 consecutive replies to bots in a channel without a human, one reply to a bot per 30 s, and 40 per day.
- While the reply is being generated, the typing indicator is shown.

### AI providers

Each task has an ordered chain of `provider:model`, overridable with `AI_ROUTE_*`:

| Task | Default chain |
|---|---|
| `triage` | `groq:openai/gpt-oss-20b` → `openrouter:openrouter/free` |
| `reply` | `openrouter:deepseek/deepseek-v4.1-flash` → `groq:openai/gpt-oss-120b` |
| `analysis` | `openrouter:deepseek/deepseek-v4.1-flash` |
| `reflection` | `openrouter:deepseek/deepseek-v4.1-flash` |

- OpenRouter requests use `data_collection: "deny"`, fp8 or better quantisation, and the upstream order from `OPENROUTER_PROVIDER_ORDER`.
- A model is skipped while it cools down after a 429 (`retry-after` or Groq reset headers), a 402, a 5xx or a network error, or when its remaining minute token budget is below the request estimate.
- When a fallback model answers, `-# noyau-<model>` is appended to the message (`/config mention-secours`).
- When every model fails and the bot was addressed, it answers with a pre-written line, without AI.
- Every call is stored in `ai_usage` with tokens, cost, upstream provider and the Discord messages it produced.

## Learning

Background jobs run in the bot process every 5 minutes.

```mermaid
flowchart LR
  M[(messages)] -->|pending, settled 10 min| G[group into conversations]
  G --> B[batches of ≤ 120 messages]
  B --> A[analysis · DeepSeek]
  A --> S{sanitise}
  S --> F[(profile_facts)]
  S --> R[(relationships)]
  F --> P[summary · DeepSeek]
  P --> PS[(profile_summaries)]
  M --> RF[evening reflection]
  F --> RF
  R --> RF
  RF --> SS[(self_state_versions)]
```

### Analysis

- Runs when the oldest pending message is 4 hours old, or when a member has 25 pending messages. Messages younger than 10 minutes wait for the next run, their conversation may still be going.
- Pending messages are grouped into conversations (same channel, no silence longer than 15 minutes). Small conversations share a batch; long ones are split. Each conversation comes with up to 6 earlier, already analysed messages as context.
- The model gets the participants (summary, relationship, up to 20 current facts with short references `F1`, `F2`…) and the transcripts with reactions, and returns facts, retractions and relationship changes as JSON validated with zod.
- The output is sanitised by the code before anything is written: facts must be about a listed participant, other than ARCHIVE-9 and not opted out, and cite messages of the batch; a self-declared `fact` cited from someone else's message becomes `reported`, with its reporter; a correction can only replace a fact of the same member; at most 20 facts per batch.
- Relationship changes are capped at ±5 per batch and ±15 per member over 24 hours, counted from when the conversation happened. Relationship rows created by the analysis don't count as an introduction.
- A batch is written in one transaction, which also marks its messages as analysed. Then each member whose facts changed gets a new summary (≤ 700 characters, read by the reply prompt) and a tagline (one line in ARCHIVE-9's voice, shown in `/mafiche`). A member with no fact left loses their summary.
- Utility bots get no profile. Known AI bots do.
- Analysis spending is capped by `ANALYSIS_DAILY_BUDGET_USD` over the last 24 hours. A failed batch stays pending and is retried an hour later. A Postgres advisory lock keeps two processes from analysing at once.
- After each run, `pg_notify('archive9', …)` announces the change.

### Reflection

Once a day from `REFLECTION_HOUR` (local time), after a last analysis, ARCHIVE-9 rereads the last 24 hours: up to 150 messages, conversations it took part in first, plus the facts learned and the relationship changes of the day. It returns a new mood, notes, and additions and removals for its opinions and running jokes. The code allows at most 2 additions and 2 removals per list and per day, and 10 entries per list. Each reflection is a new row in `self_state_versions`. Nothing happened in 24 hours: no reflection. A failure is retried an hour later, otherwise the next day.

### Purge

Every 6 hours, raw messages older than `MESSAGE_RETENTION_DAYS` (30 by default) are deleted. Facts, summaries and relationships are kept.

### History backfill

`src/backfill.ts` reads the history of the listened channels (and their active threads) through the Discord REST API, stores the messages that are missing and analyses them. It skips opted-out members and command answers, and never goes further back than the retention period.

```sh
docker compose exec bot node src/backfill.ts --days 30 --dry-run    # counts and estimates the cost
docker compose exec bot node src/backfill.ts --days 30 --max-cost 0.5
docker compose exec bot node src/backfill.ts --days 30 --max-cost 0.1 --channel <id>
```

It holds the analysis lock for the whole run. When `--max-cost` is reached, the remaining backfilled messages are kept but marked as analysed, so the bot doesn't analyse them on its own budget. Useful at first start, after adding a channel, or after the bot was offline.

## Commands

| Command | Who | Effect |
|---|---|---|
| `/archive-9` | everyone | introduction |
| `/mafiche` | everyone | own profile, ephemeral: tagline, summary, relationship, latest facts with their nature; offers to opt back in when opted out |
| `/oublie-moi` | everyone | deletes the member's messages, facts, summary and relationship after confirmation, then opts them out |
| `/pause`, `/reprendre` | Manage Server | stop or resume all replies |
| `/config etat \| ecoute \| spontaneite \| mention-secours` | Manage Server | show settings, toggle the current channel, spontaneity level, fallback tag |
| Diagnostic (message menu) | everyone | model, provider, triage reason, tokens, cost and latency behind one of ARCHIVE-9's messages |

### Spontaneity

Unprompted interventions depend on `/config spontaneite`:

| Level | Interest threshold | Max per channel per hour |
|---|---|---|
| 0 · observateur | — | 0 |
| 1 · discret (default) | 8 | 2 |
| 2 · normal | 6 | 5 |
| 3 · bavard | 4 | 12 |

The hourly budget is enforced by the code. Unprompted interventions don't show the typing indicator, since they may end in silence.

## Data

Discord IDs are stored as `text`. Dates are `timestamptz`.

| Table | Content |
|---|---|
| `members` | members and bots seen on the server, nickname history, opt-out |
| `messages` | raw messages from listened channels, with reactions and analysis status |
| `profile_facts` | one learned fact per row: category, nature, confidence, sources, reporter; a correction replaces a row through `superseded_by` |
| `profile_summaries` | short summary of each profile, used in replies, and a tagline |
| `relationships` | ARCHIVE-9's affinity (−100 to 100), trust (0 to 100) and feeling toward each member |
| `relationship_events` | history of relationship changes |
| `self_state_versions` | ARCHIVE-9's evolving state, one version per row |
| `skills` | durable behaviour rules created by members |
| `actions_log` | attempted Discord actions, refusals, previous values, undos |
| `ai_usage` | AI calls: task, model, provider, tokens, cost, duration, triage reason or tools used, produced messages |
| `settings` | settings editable at runtime |

Deleting a member cascades to their messages, facts, summary and relationship.

The schema is in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) and migrations in [`packages/db/migrations`](../packages/db/migrations).

## CI

| Job | Trigger | Steps |
|---|---|---|
| `check` | PRs and pushes to `main` | install, lint, typecheck, tests with coverage against Postgres 18 |
| `secrets` | PRs and pushes to `main` | gitleaks over the full history |
| `image` | after `check` and `secrets` | `linux/amd64` build, pushed to GHCR (`latest` and SHA) from `main` only |

Coverage threshold: 80% on `packages/core` and `packages/ai`.
