# Architecture

A stateless reconcile loop: every cycle reads Dokploy and Kuma from scratch, computes a plan and
applies it. The layers keep the decision logic free of I/O so it can be tested without a network.

```
src/
  domain/          pure rules — no packages, no I/O
  application/     use cases; reach the world only through domain ports
  infrastructure/  adapters: Postgres, Kuma Socket.IO, heartbeat, config, logger
  shared/          tiny kernel (error formatting)
  index.ts, bin/   composition roots — the only place adapters are constructed
```

Dependencies point inwards only. `pnpm arch` (dependency-cruiser) fails the build otherwise.

## Ports

| Port                  | Adapter                  | Purpose                                   |
| --------------------- | ------------------------ | ----------------------------------------- |
| `IDomainSource`       | `PostgresDomainSource`   | domains Dokploy currently serves          |
| `IMonitorReader`      | `KumaMonitorReader`      | monitors Kuma pushes after login          |
| `IMonitorWriter`      | `KumaMonitorWriter`      | create, update, pause, resume, delete     |
| `INotificationSource` | `KumaNotificationSource` | notification ids, for `pnpm inspect` only |

The Kuma adapters share one `KumaSession` per cycle: Kuma pushes its lists once per connection,
so a fresh session is what keeps the view current.

## Use cases

- `reconcileMonitors` — plan, guard, then dry-run report or apply.
- `listManagedDomains` — what `pnpm domains` prints.
- `inspectKuma` — what `pnpm inspect` prints.

## Invariants

- **Ownership:** only monitors whose description carries `dokploy:domainId=<id>` are touched.
- **Guards abort, never trim:** zero domains with managed monitors present, or a retire count above
  `MAX_RETIRE_RATIO`, aborts the whole run before anything is sent.
- **Applying can stop halfway.** Changes are sent one by one; if one fails the cycle ends and the
  next cycle recomputes the remaining work. Every step is idempotent, so this converges.
- **Validation at the edge:** Postgres rows and Kuma payloads are parsed with Zod in the adapters;
  the domain assumes clean data.
