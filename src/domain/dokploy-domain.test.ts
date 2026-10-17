import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type DokployDomain, toMonitorName, toMonitorUrl } from './dokploy-domain.js'

const domain = (overrides: Partial<DokployDomain> = {}): DokployDomain => ({
  domainId: 'dom1',
  host: 'app.example.com',
  isHttps: true,
  path: '/',
  domainType: 'application',
  serviceName: 'api',
  environmentName: 'production',
  projectName: 'proj',
  ...overrides,
})

describe('toMonitorUrl', () => {
  it('drops a root path', () => {
    assert.equal(toMonitorUrl(domain()), 'https://app.example.com')
  })

  it('keeps a sub path and adds the missing slash', () => {
    assert.equal(toMonitorUrl(domain({ path: '/api' })), 'https://app.example.com/api')
    assert.equal(toMonitorUrl(domain({ path: 'api' })), 'https://app.example.com/api')
  })

  it('follows the https flag', () => {
    assert.equal(toMonitorUrl(domain({ isHttps: false, path: null })), 'http://app.example.com')
  })
})

describe('toMonitorName', () => {
  it('prefixes the host with project and service', () => {
    assert.equal(toMonitorName(domain()), 'proj/api · app.example.com')
  })

  it('falls back to the bare host without context', () => {
    assert.equal(toMonitorName(domain({ projectName: null, serviceName: null })), 'app.example.com')
  })
})
