import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DokployDomain } from '../domain/dokploy-domain.js'
import type { Exclusions } from '../domain/exclusion.js'
import type { HostRule } from '../domain/host-rule.js'
import type { IDomainSource } from '../domain/ports.js'
import { listManagedDomains } from './list-managed-domains.js'

const domain = (overrides: Partial<DokployDomain> = {}): DokployDomain => ({
  domainId: 'dom1',
  host: 'app.example.com',
  isHttps: true,
  path: '/',
  domainType: 'application',
  serviceName: 'api',
  environmentName: 'production',
  isDefaultEnvironment: true,
  projectId: 'p1',
  projectName: 'proj',
  middlewares: [],
  isStopped: false,
  ...overrides,
})

const sourceOf = (domains: DokployDomain[]): IDomainSource => ({
  listDomains: async () => domains,
})

const none: Exclusions = { hosts: [], projects: [], services: [], middlewares: [] }

describe('listManagedDomains', () => {
  it('maps a domain to its monitor url, name and group when grouped', async () => {
    const [dto] = await listManagedDomains(sourceOf([domain()]), true, [], none)
    assert.deepEqual(dto, {
      domainId: 'dom1',
      domainType: 'application',
      url: 'https://app.example.com',
      group: 'proj',
      monitorName: 'api · app.example.com',
      isExcluded: false,
    })
  })

  it('drops the group and prefixes the project when ungrouped', async () => {
    const [dto] = await listManagedDomains(sourceOf([domain()]), false, [], none)
    assert.equal(dto?.group, null)
    assert.equal(dto?.monitorName, 'proj · api · app.example.com')
  })

  it('applies the first matching health path to the url', async () => {
    const rules = [
      { pattern: 'app.*', value: '/healthz' },
      { pattern: '*', value: '/other' },
    ]
    const dtos = await listManagedDomains(
      sourceOf([domain(), domain({ domainId: 'dom2', host: 'web.example.com' })]),
      true,
      rules,
      none,
    )
    assert.deepEqual(
      dtos.map((dto) => dto.url),
      ['https://app.example.com/healthz', 'https://web.example.com/other'],
    )
  })

  it('flags excluded domains without dropping them', async () => {
    const exclusions: Exclusions = { ...none, hosts: ['vpn.*'] }
    const dtos = await listManagedDomains(
      sourceOf([domain({ domainId: 'vpn1', host: 'vpn.example.com' }), domain()]),
      true,
      [],
      exclusions,
    )
    assert.deepEqual(
      dtos.map((dto) => [dto.domainId, dto.isExcluded]),
      [
        ['vpn1', true],
        ['dom1', false],
      ],
    )
  })

  it('returns an empty list when Dokploy has no domains', async () => {
    assert.deepEqual(await listManagedDomains(sourceOf([]), true, [], none), [])
  })
})

describe('listManagedDomains watched only', () => {
  const ids = async (
    domains: DokployDomain[],
    exclusions = none,
    healthPaths: HostRule<string>[] = [],
  ) =>
    (await listManagedDomains(sourceOf(domains), true, healthPaths, exclusions, true)).map(
      (dto) => dto.domainId,
    )

  it('drops excluded domains', async () => {
    const exclusions: Exclusions = { ...none, hosts: ['vpn.*'] }
    const domains = [domain({ domainId: 'vpn1', host: 'vpn.example.com' }), domain()]
    assert.deepEqual(await ids(domains, exclusions), ['dom1'])
  })

  it('drops stopped services', async () => {
    const domains = [
      domain({ domainId: 'off', host: 'off.example.com', isStopped: true }),
      domain(),
    ]
    assert.deepEqual(await ids(domains), ['dom1'])
  })

  it('keeps one domain per endpoint, https first', async () => {
    const domains = [
      domain({ domainId: 'plain', isHttps: false }),
      domain({ domainId: 'secure', isHttps: true }),
    ]
    assert.deepEqual(await ids(domains), ['secure'])
  })

  it('treats a health path that makes endpoints equal as one endpoint', async () => {
    const domains = [
      domain({ domainId: 'root', path: '/' }),
      domain({ domainId: 'sub', path: '/app', isHttps: false }),
    ]
    assert.deepEqual(await ids(domains, none, [{ pattern: 'app.*', value: '/healthz' }]), ['root'])
  })

  it('lists everything when not restricted', async () => {
    const domains = [domain({ domainId: 'plain', isHttps: false }), domain({ isStopped: true })]
    const all = await listManagedDomains(sourceOf(domains), true, [], none)
    assert.equal(all.length, 2)
  })
})
