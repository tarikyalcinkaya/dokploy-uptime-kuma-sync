export interface HostRule<T> {
  pattern: string
  value: T
}

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

// `*` spans any run of characters, dots included, so `mta-sts.*` covers every zone.
export const matchesPattern = (pattern: string, host: string): boolean =>
  new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i').test(host)

export const findHostRule = <T>(rules: readonly HostRule<T>[], host: string): T | null =>
  rules.find((rule) => matchesPattern(rule.pattern, host))?.value ?? null
