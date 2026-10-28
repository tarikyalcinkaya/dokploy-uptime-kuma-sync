# Architecture

A stateless reconcile loop: every cycle reads Dokploy and Kuma from scratch, computes a plan and
applies it. The layers keep the decision logic free of I/O so it can be tested without a network.

```
src/
  domain/          pure rules — no packages, no I/O
  application/     use cases; reach the world only through domain ports
  infrastructure/  adapters: Postgres, Kuma Socket.IO, heartbeat, config, logger
  shared/          tiny kernel (error formatting)
  index.ts, bin/   composition roots — the only place adapters and the Postgres client are constructed;
                   they consume application DTOs, never domain types
```

Dependencies point inwards only. `pnpm arch` (dependency-cruiser) fails the build otherwise.

## Ports

| Port                  | Adapter                  | Purpose                                   |
| --------------------- | ------------------------ | ----------------------------------------- |
| `IDomainSource`       | `PostgresDomainSource`   | domains Dokploy currently serves          |
| `IMonitorReader`      | `KumaMonitorReader`      | monitors Kuma pushes after login          |
| `IMonitorWriter`      | `KumaMonitorWriter`      | create, update, describe                  |
| `IMonitorLifecycle`   | `KumaMonitorLifecycle`   | pause, resume, delete                     |
| `IHeartbeatSink`      | `PushHeartbeatSink`      | push-monitor ping after each cycle        |
| `IGroupWriter`        | `KumaGroupWriter`        | project groups: create, rename, delete    |
| `INotificationSource` | `KumaNotificationSource` | notification ids, for `pnpm inspect` only |

The Kuma adapters share one `KumaSession` per cycle: Kuma pushes its lists once per connection,
so a fresh session is what keeps the view current.

## Use cases

- `reconcileMonitors` — plan, guard, then dry-run report or apply; returns a `ReconcileReportDto`.
- `runMonitoredCycle` — wraps one cycle with the heartbeat: no ping on a dry run, `down` on failure.
- `listManagedDomains` — what `pnpm domains` prints.
- `inspectKuma` — what `pnpm inspect` prints.

## Invariants

- **Ownership:** only monitors whose description carries `dokploy:domainId=<id>`, and groups whose
  description carries `dokploy:projectId=<id>`, are touched.
- **Groups first, empty groups last:** a run creates missing groups before the monitors that go in
  them, and deletes a group only after its last child is gone.
- **Guards abort, never trim:** zero domains with managed monitors present, or a retire count above
  `MAX_RETIRE_RATIO`, aborts the whole run before anything is sent.
- **Applying can stop halfway.** Changes are sent one by one; if one fails the cycle ends and the
  next cycle recomputes the remaining work. Every step is idempotent, so this converges.
- **Validation at the edge:** Postgres rows and Kuma payloads are parsed with Zod in the adapters;
  the domain assumes clean data.
