# dokploy-uptime-kuma-sync

Keeps Uptime Kuma's HTTP monitors in sync with the domains Dokploy serves.

Adding a domain in Dokploy creates the monitor. Removing it pauses the monitor, which is the half
that actually matters: a deleted domain otherwise leaves a monitor alerting forever, and false alarms
train you to ignore real ones.

## Why it works this way

Uptime Kuma has **no write REST API.** Its REST surface is read-only (badges, status pages, the push
endpoint, `/metrics`) and API keys only authenticate `/metrics` and push monitors. Creating a monitor
is only possible over Socket.IO, authenticated with the account's username and password.

So this talks Socket.IO directly, speaking just six events — `login`, `monitorList`, `add`,
`editMonitor`, `pauseMonitor`/`resumeMonitor`, `deleteMonitor`. No wrapper library: the maintained
Python one (`uptime-kuma-api`) last shipped in September 2023 and documents support only up to Kuma
1.23.2, so it would be a dependency that adds risk rather than removing it.

**Verified against the Kuma 1.23.x event names. Kuma 2.x is a different major and is not supported** —
note that the Docker tag `latest` still points at the 1.x line; 2.x lives under `2` / `2.4.0` / `next`.

Domains are read straight from Dokploy's Postgres. That couples this to Dokploy's internal schema,
which is the weakest part of the design. If
[Dokploy#4938](https://github.com/Dokploy/dokploy/issues/4938) lands upstream, this switches to
receiving webhooks and the database read goes away.

More on the reasoning behind all of this in [DESIGN.md](DESIGN.md).

## Setup

```bash
npm install
cp .env.example .env   # fill in Kuma credentials + DATABASE_URL
npm test               # reconcile logic, no network needed
```

A read-only Postgres role is enough and is what you want:

```sql
CREATE ROLE kuma_sync LOGIN PASSWORD 'change-me';
GRANT CONNECT ON DATABASE dokploy TO kuma_sync;
GRANT USAGE ON SCHEMA public TO kuma_sync;
GRANT SELECT ON domain, application, compose, environment, project TO kuma_sync;
```

Then walk up in three steps, each one safe:

```bash
npm run domains   # DATABASE_URL only — what would be managed? No Kuma contact at all.
npm run inspect   # + Kuma credentials — login works? Prints notification ids. Read-only.
npm run dev       # full reconcile, DRY_RUN=true by default — prints the plan, changes nothing.
```

`npm run inspect` is also how you find `KUMA_NOTIFICATION_IDS`: Kuma's UI never shows notification
ids, but it pushes them over the socket after login.

Once the plan looks right, set `DRY_RUN=false`.

## Running it

**This has to run on the Dokploy server.** Dokploy publishes Postgres on the host only when
`NODE_ENV=development` (`packages/server/src/setup/postgres-setup.ts`), so on a production install the
database is reachable *only* from inside `dokploy-network`. There is no port to tunnel to from a
laptop.

**Run it as a long-lived container** — `RUN_MODE=loop` with a restart policy, which is what
`docker-compose.yml` sets up:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

**Do not run it from cron with `docker run --rm`.** Dokploy's Docker Cleanup executes
`docker image prune --all --force`, and `--all` deletes every image *not referenced by a container* —
not just dangling ones. A one-shot `--rm` container leaves no reference between runs, so the image
gets deleted and the next cron run dies with `pull access denied`. A long-running container holds a
reference, so prune cannot touch it.

The one-off commands are still the right way to work through the setup ladder above, they just should
not be what runs on a schedule.

## How reconciliation works

Ownership is marked in each monitor's `description` field as `dokploy:domainId=<id>`. Monitors
without that marker are never touched, so anything you created by hand in Kuma is safe. Matching on
`domainId` rather than URL means renaming a host edits the existing monitor instead of orphaning it.

Each cycle opens a fresh Kuma session, because Kuma pushes the monitor list once per connection —
reconnecting is cheaper than tracking incremental updates and cannot go subtly stale.

Preview-deployment domains are excluded. (They are GitHub-only in Dokploy today, but the filter keeps
this correct if that changes — otherwise every pull request would add a monitor that dies in days.)

### Safety guards

Both refuse the whole run rather than doing partial damage:

- Dokploy returning zero domains while managed monitors exist → abort. One failed read must not
  retire everything.
- A plan retiring more than `MAX_RETIRE_RATIO` (default half) of the managed monitors → abort.
  A single removal is always allowed, so normal deletions are never blocked.

`ON_REMOVE=pause` (default) keeps the monitor and its history. `delete` is available but permanent.

### Watching the watcher

If the sync silently stops — broken cron, deleted image, rotated password — new domains stop getting
monitors and nothing tells you. It becomes the blind spot in your own alerting.

`KUMA_PUSH_URL` closes that loop with the tool you already run. Create a **Push** monitor in Kuma, set
its heartbeat interval comfortably above your cron interval (cron every 15 min → heartbeat 1800s),
and put the push URL in `.env`. Every applied cycle pings it with a summary
(`created=2 updated=0 retired=1`); a failed cycle pings `status=down` with the error, so you hear
about it immediately instead of waiting for the timeout. If Kuma itself is what is unreachable the
ping fails too — and the missed heartbeat alerts you anyway.

Heartbeats are **skipped while `DRY_RUN=true`**. A dry run applies nothing, so reporting it as healthy
would let a forgotten `DRY_RUN=true` look green forever while no monitor is ever created.

## Configuration

See `.env.example`. Worth calling out:

| Variable | Note |
| --- | --- |
| `KUMA_NOTIFICATION_IDS` | **Set this.** Without it monitors are created but nothing alerts you. |
| `KUMA_PUSH_URL` | **Set this too.** Kuma push monitor that tells you when the sync itself dies. |
| `KUMA_TOTP_SECRET` | Only if 2FA is on the Kuma account. A cron job cannot type a code, so the base32 secret is needed to generate one. |
| `DRY_RUN` | Defaults to `true`. |
| `MONITOR_TIMEOUT_SECONDS` | Must stay below `MONITOR_INTERVAL_SECONDS`; Kuma rejects the monitor otherwise. |

## Troubleshooting

**`Invalid URL` / `could not read domains`** — `DATABASE_URL` did not parse. Two causes, both common:
quotes (`docker run --env-file` keeps them, unlike Node's `--env-file`), or special characters in the
password that need percent-encoding (`@` → `%40`, `#` → `%23`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`).
Quotes are stripped defensively now, so in practice this means the password.

**`getaddrinfo ENOTFOUND <something odd>`** — an unencoded `@` in the password split the connection
string early, so the driver is resolving a fragment of your password as the hostname. Percent-encode
it.

**`ECONNREFUSED`** — the URL is fine but nothing is listening. Check you are on `dokploy-network`
(`docker run --network dokploy-network …`) and that the host is `dokploy-postgres`, not `localhost`.

**`Kuma requires a 2FA token`** — set `KUMA_TOTP_SECRET` to the account's base32 secret.

**`Kuma rejected monitor: <msg>`** — the `add` payload was refused. The message names the field.

## What has been exercised

Running against a live Kuma 1.23.17 alongside a production Dokploy install: login (including the
notification-id lookup), reading domains, the dry run, creating monitors with notifications attached,
and the push heartbeat.

The paths that unit tests cover but a live server has not yet exercised: `editMonitor` (a host
rename), retirement via `pauseMonitor`, `ON_REMOVE=delete`, and the guards actually firing. If Kuma
refuses something it surfaces as `Kuma rejected monitor: <msg>`, and that message names the field.

## Known limitations
- Kuma tags are not used; ownership lives in the description instead, which avoids the separate tag
  API entirely. Tags could be added later if grouping in the Kuma UI becomes useful.
- No monitor deletion on `ON_REMOVE=pause` means paused monitors accumulate. Prune them by hand, or
  switch to `delete` once you trust the guards.
