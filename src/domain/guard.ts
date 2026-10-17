import type { ReconcilePlan } from './reconcile-plan.js'

const MIN_RETIRE_ALLOWANCE = 1

// A plan that looks like a bad read rather than a real change must not run: one partial
// database read would otherwise retire every monitor we manage.
export const findGuardViolation = (plan: ReconcilePlan, maxRetireRatio: number): string | null => {
  if (plan.domainCount === 0 && plan.managedCount > 0) {
    return 'Dokploy returned zero domains while managed monitors exist — refusing to retire everything'
  }

  const allowance = Math.max(MIN_RETIRE_ALLOWANCE, Math.floor(plan.managedCount * maxRetireRatio))
  if (plan.retire.length > allowance) {
    return `Plan would retire ${plan.retire.length} of ${plan.managedCount} managed monitors (allowance ${allowance}) — refusing as a safety measure`
  }

  return null
}
