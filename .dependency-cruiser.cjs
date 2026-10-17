/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment: 'Domain depends on nothing but itself and the shared kernel — no I/O, no packages.',
      severity: 'error',
      from: { path: '^src/domain/', pathNot: '\\.test\\.ts$' },
      to: { pathNot: '^src/(domain|shared)/' },
    },
    {
      name: 'application-sees-only-domain',
      comment: 'Use cases talk to the outside world only through domain ports.',
      severity: 'error',
      from: { path: '^src/application/', pathNot: '\\.test\\.ts$' },
      to: { pathNot: '^src/(domain|application|shared)/' },
    },
    {
      name: 'infrastructure-not-presentation',
      comment: 'Adapters never reach into the entry points that compose them.',
      severity: 'error',
      from: { path: '^src/infrastructure/' },
      to: { path: '^src/(index\\.ts|bin/)' },
    },
    {
      name: 'shared-kernel-is-leaf',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { pathNot: '^src/shared/' },
    },
    {
      name: 'entry-points-skip-domain-internals',
      comment: 'Entry points call use cases; domain rules are reached through them.',
      severity: 'error',
      from: { path: '^src/(index\\.ts|bin/)' },
      to: { path: '^src/domain/' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
}
