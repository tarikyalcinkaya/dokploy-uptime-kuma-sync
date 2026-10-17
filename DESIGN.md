# Design notes

Why this is built the way it is. For installation and usage, see the [README](README.md).

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
created solely over Socket.IO, authenticated with the account's username and password. Kuma has
no multi-user support either, so the credentials in `.env` are full admin access. That is a property
of Kuma, not a choice made here.

**No wrapper library.** `uptime-kuma-api` is the obvious candidate and it is not used: its last
release was September 2023 and it documents support only up to Kuma 1.23.2. Speaking a handful of Socket.IO
events directly is less surface to break than a dependency that is already outside its own
compatibility range.

**Kuma 2.x only.** 2.x changed two things that matter here: `editMonitor` assigns every column from
the payload, so a partial payload nulls out whatever it omits, and `deleteMonitor` gained a
`deleteChildren` argument. Updates therefore send Kuma's own copy of the monitor back with only the
managed fields replaced. Pin the Kuma image to an exact tag; a major bump is a one-way migration.

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

## Monitor organisation: one group per Dokploy project

Each Dokploy project becomes a Kuma group monitor, and every domain sits under its project's group,
named `service · host`. With `GROUP_BY_PROJECT=false` monitors stay in one flat list named
`project · service · host`. The environment is named only when it is not the project's default one:
Dokploy creates a "production" environment with every project, so naming it would be noise on every
monitor. Organisations are never shown.

Groups are the roughest part of Kuma, and each rule below answers one of its known problems:

- **Notifications go on children only.** A group reports down when any child is down
  ([#3937](https://github.com/louislam/uptime-kuma/issues/3937)); with a notification on the group
  too, one outage would alert twice.
- **Groups are owned like monitors:** the description carries `dokploy:projectId=<id>`, so a group
  made by hand is never touched, and a renamed project renames its group instead of making a new one.
- **A group is deleted only when nothing hangs under it any more.** A paused child keeps its history
  under the group, and a monitor someone put into our group by hand keeps its parent. The delete
  itself passes `deleteChildren=false`, so even a stale view can never take children with it.
- **Groups are never paused.** Kuma ignores paused children when it computes a group's status, so a
  group whose children are all paused stays quiet; pausing it would instead hide its children's own
  state behind `forceInactive`.

Orphaned `monitor_group` rows after a delete ([#7526](https://github.com/louislam/uptime-kuma/issues/7526))
are Kuma's to fix and do not affect what this reads.

## Relationship to Dokploy

Reading Dokploy's Postgres directly is the weakest part of the design — it couples this to an
internal schema that is free to change.

[Dokploy#4938](https://github.com/Dokploy/dokploy/issues/4938) proposes domain lifecycle triggers for
Dokploy's existing notification system. If that lands, the sync can consume a webhook instead: the
database read disappears and the reconcile interval stops being the reaction time. The reconcile loop
stays regardless — webhooks drift, and a periodic full comparison is what makes the result correct.
