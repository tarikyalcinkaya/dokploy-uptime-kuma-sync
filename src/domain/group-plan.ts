import { type DokployDomain, toGroupName } from './dokploy-domain.js'
import type { GroupSpec, Monitor } from './monitor.js'
import { describeGroupOwnership, readOwnedProjectId } from './ownership.js'

export interface PlannedGroup {
  key: string
  spec: GroupSpec
}

export interface GroupChange extends PlannedGroup {
  group: Monitor
}

export interface GroupPlan {
  create: PlannedGroup[]
  update: GroupChange[]
  retire: Monitor[]
  existingIds: ReadonlyMap<string, number>
}

export const groupKeyOf = (domain: DokployDomain, isGrouped: boolean): string | null =>
  isGrouped ? domain.projectId : null

export const findManagedGroups = (monitors: Monitor[]): Map<string, Monitor> => {
  const groups = new Map<string, Monitor>()
  for (const monitor of monitors) {
    const projectId = monitor.isGroup ? readOwnedProjectId(monitor) : null
    if (projectId && !groups.has(projectId)) {
      groups.set(projectId, monitor)
    }
  }
  return groups
}

export const buildGroupPlan = (
  domains: DokployDomain[],
  groups: Map<string, Monitor>,
  isGrouped: boolean,
  intervalSeconds: number,
): Omit<GroupPlan, 'retire'> => {
  const wanted = new Map<string, GroupSpec>()
  for (const domain of domains) {
    const key = groupKeyOf(domain, isGrouped)
    if (key && !wanted.has(key)) {
      wanted.set(key, {
        name: toGroupName(domain),
        description: describeGroupOwnership(key),
        intervalSeconds,
      })
    }
  }

  const plan: Omit<GroupPlan, 'retire'> = {
    create: [],
    update: [],
    existingIds: new Map([...groups].map(([key, group]) => [key, group.id])),
  }
  for (const [key, spec] of wanted) {
    const group = groups.get(key)
    if (!group) {
      plan.create.push({ key, spec })
    } else if (group.name !== spec.name) {
      plan.update.push({ key, spec, group })
    }
  }
  return plan
}

// A group goes only once nothing hangs under it any more: paused children keep their history
// there, and a monitor someone added to our group by hand must not lose its parent.
export const findRetiredGroups = (
  groups: Map<string, Monitor>,
  wantedKeys: ReadonlySet<string>,
  survivingChildParents: ReadonlySet<number>,
): Monitor[] =>
  [...groups]
    .filter(([key, group]) => !wantedKeys.has(key) && !survivingChildParents.has(group.id))
    .map(([, group]) => group)
