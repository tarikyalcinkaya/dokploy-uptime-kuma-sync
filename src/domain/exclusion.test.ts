import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DokployDomain } from './dokploy-domain.js'
import { type Exclusions, isExcluded } from './exclusion.js'

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
  ...overrides,
})

const none: Exclusions = { hosts: [], projects: [], services: [], middlewares: [] }

describe('isExcluded', () => {
  it('keeps everything when nothing is excluded', () => {
    assert.equal(isExcluded(domain(), none), false)
  })

  it('excludes by host pattern', () => {
    assert.equal(
      isExcluded(domain({ host: 'autodiscover.mail.io' }), { ...none, hosts: ['autodiscover.*'] }),
      true,
    )
  })

  it('excludes by project and service name', () => {
    assert.equal(isExcluded(domain(), { ...none, projects: ['PROJ'] }), true)
    assert.equal(isExcluded(domain(), { ...none, services: ['api'] }), true)
    assert.equal(isExcluded(domain({ serviceName: null }), { ...none, services: ['*'] }), false)
  })

  it('excludes a domain behind a listed middleware', () => {
    const vpn = domain({ middlewares: ['redirect@file', 'vpn-only@file'] })
    assert.equal(isExcluded(vpn, { ...none, middlewares: ['vpn-only@file'] }), true)
    assert.equal(isExcluded(domain(), { ...none, middlewares: ['vpn-only@file'] }), false)
  })
})
