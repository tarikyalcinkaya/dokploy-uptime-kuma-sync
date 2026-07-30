# Design notes

Why kuma-sync is built the way it is. For installation and usage, see the [README](README.md).

## Shape

A stateless reconciler. It holds no state of its own: every cycle reads the domains Dokploy serves,
reads the monitors Uptime Kuma has, compares them, and applies the difference. Running it twice
changes nothing the second time.

```
src/
  index.ts        entry — once | loop mode, graceful shutdown, heartbeat wiring
  config.ts       env validation (loadConfig / loadDatabaseConfig)
  constants.ts    timeouts, monitor defaults, the ownership marker
  dokploy.ts      the domain query, plus URL and name derivation
  kuma.ts         Socket.IO client (login, monitorList, add, edit, pause, resume, delete)
  reconcile.ts    buildPlan / findGuardViolation / applyPlan
  heartbeat.ts    push ping, so Kuma watches the sync itself
  bin/domains.ts  print the domains only — needs DATABASE_URL, never contacts Kuma
  bin/inspect.ts  log in to Kuma and print notification ids and managed monitors — read-only
```

`buildPlan` and `findGuardViolation` are pure functions, which is why the whole decision layer is
unit tested without a network.

## Constraints that shaped it

**Uptime Kuma has no write REST API.** Its REST surface is read-only — badges, status pages, the push
endpoint, `/metrics` — and API keys authenticate only `/metrics` and push monitors. Monitors can be
created solely over Socket.IO, authenticated with the account's username and password. Kuma 1.x has
no multi-user support either, so the credentials in `.env` are full admin access. That is a property
of Kuma, not a choice made here.

**No wrapper library.** `uptime-kuma-api` is the obvious candidate and it is not used: its last
release was September 2023 and it documents support only up to Kuma 1.23.2. Speaking six Socket.IO
events directly is less surface to break than a dependency that is already outside its own
compatibility range.

**Kuma 1.23.x only.** The event names target that line. Kuma 2.x is a different major. Note that the
Docker tag `latest` still points at 1.x; 2.x lives under `2`, `2.4.0` and `next`. Pin the tag — if
`latest` is ever repointed, an automatic pull becomes a one-way database migration.

**It has to run on the Dokploy host.** Dokploy publishes Postgres on the host only when
`NODE_ENV=development`, so on a production install the database is reachable exclusively from inside
`dokploy-network`. There is no port to tunnel to.

**Do not schedule it with `docker run --rm`.** Dokploy's Docker Cleanup runs
`docker image prune --all --force`, and `--all` removes every image no container references — not
just dangling ones. A one-shot container leaves no reference between runs, so the image is deleted
and the next run fails with `pull access denied`. A long-lived container holds a reference and
survives. This is why the compose file uses `RUN_MODE=loop` with a restart policy.

## Invariants

**Ownership is explicit.** Every managed monitor carries `dokploy:domainId=<id>` in its description.
Monitors without the marker are never read as ours and never touched, so anything created by hand in
Kuma is safe. Matching on `domainId` rather than on the URL means renaming a host edits the existing
monitor instead of orphaning it and creating a duplicate.

**Guards abort the run; they never apply half of it.** Two conditions stop everything: Dokploy
returning zero domains while managed monitors exist, and a plan that would retire more than
`MAX_RETIRE_RATIO` of the managed set. One failed database read must not be able to retire every
monitor. A single removal is always permitted, so ordinary deletions are never blocked.

**Removal pauses, it does not delete.** `ON_REMOVE=pause` keeps the monitor and its history.
`delete` exists and is permanent.

**Every external call has a timeout** (`constants.ts`); Socket.IO calls use `socket.timeout().emit()`.

**Each cycle opens a fresh Kuma session.** Kuma pushes the monitor list once per connection, so
reconnecting is both cheaper than tracking incremental `updateMonitorIntoList` events and impossible
to get subtly stale.

**The heartbeat never fails a cycle.** If the ping cannot get through it warns and moves on — Kuma's
push timeout produces the same alert anyway. It is skipped entirely while `DRY_RUN=true`, because a
run that applies nothing must not report itself healthy; otherwise a forgotten `DRY_RUN` would look
green forever while no monitor is ever created.

**Preview-deployment domains are excluded.** They are created and destroyed with pull requests and
would fill Kuma with monitors that die within days.

## Deferred: how to organise monitors in Kuma

**Status:** deferred. Monitors are a flat list named `project/service · host`.

Dokploy models organisation → project → environment → service → domain, and a flat list does not
reflect that. The hierarchy is shallower than it looks, though: Dokploy creates a "production"
environment automatically with every project, so unless extra environments exist, every monitor would
carry the same environment name — noise, not information. With a single organisation the same applies
one level up. The levels that actually distinguish anything are **project and service**.

The rule worth keeping: show a level only when it discriminates.

| Option | Gives | Cost | Risk |
| --- | --- | --- | --- |
| Naming only (current) | alphabetical clustering, search | none | none |
| Tags (`project:x`) | filtering, coloured badges | moderate — create tags, map name→id, extend the payload | low; tags are metadata |
| Group monitors (`parent`) | a real tree in the sidebar | high — groups must be reconciled too: create, rename, delete when empty, mark ownership | high |

Groups are the roughest part of Kuma today. A group reports fully down when any single child is down
([#3937](https://github.com/louislam/uptime-kuma/issues/3937)), so attaching notifications to a group
double-alerts. Deleting a monitor leaves orphaned `monitor_group` rows
([#7526](https://github.com/louislam/uptime-kuma/issues/7526)). Deleting a group affects its children,
which is exactly the history the guards exist to protect.

If this is revisited, tags plus better naming is the way in; groups can be layered on later, while
unwinding them is painful. A reasonable trigger to reconsider: somewhere past ~50 domains, or the
first non-production environment.

## Relationship to Dokploy

Reading Dokploy's Postgres directly is the weakest part of the design — it couples this to an
internal schema that is free to change.

[Dokploy#4938](https://github.com/Dokploy/dokploy/issues/4938) proposes domain lifecycle triggers for
Dokploy's existing notification system. If that lands, kuma-sync can consume a webhook instead: the
database read disappears and the reconcile interval stops being the reaction time. The reconcile loop
stays regardless — webhooks drift, and a periodic full comparison is what makes the result correct.
