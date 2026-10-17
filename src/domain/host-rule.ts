export interface HostRule<T> {
  pattern: string
  value: T
}

// A linear wildcard matcher: a RegExp of several `.*` backtracks exponentially on a long host.
export const matchesPattern = (pattern: string, text: string): boolean => {
  const glob = pattern.toLowerCase()
  const value = text.toLowerCase()
  let g = 0
  let v = 0
  let star = -1
  let resume = 0
  while (v < value.length) {
    if (g < glob.length && glob[g] === '*') {
      star = g++
      resume = v
    } else if (g < glob.length && glob[g] === value[v]) {
      g++
      v++
    } else if (star >= 0) {
      g = star + 1
      v = ++resume
    } else {
      return false
    }
  }
  while (g < glob.length && glob[g] === '*') {
    g++
  }
  return g === glob.length
}

export const findHostRule = <T>(rules: readonly HostRule<T>[], host: string): T | null =>
  rules.find((rule) => matchesPattern(rule.pattern, host))?.value ?? null
