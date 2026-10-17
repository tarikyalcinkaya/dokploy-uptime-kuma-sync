import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type DokployDomain, toGroupName, toMonitorName, toMonitorUrl } from './dokploy-domain.js'

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

describe('toMonitorUrl', () => {
  it('drops a root path', () => {
    assert.equal(toMonitorUrl(domain()), 'https://app.example.com')
  })

  it('keeps a sub path and adds the missing slash', () => {
    assert.equal(toMonitorUrl(domain({ path: '/api' })), 'https://app.example.com/api')
    assert.equal(toMonitorUrl(domain({ path: 'api' })), 'https://app.example.com/api')
  })

  it('swaps the domain path for a health path written from the root', () => {
    assert.equal(
      toMonitorUrl(domain({ path: '/app' }), '/health'),
      'https://app.example.com/health',
    )
  })

  it('follows the https flag', () => {
    assert.equal(toMonitorUrl(domain({ isHttps: false, path: null })), 'http://app.example.com')
  })
})

describe('toMonitorName', () => {
  it('names project, service and host when monitors sit in one flat list', () => {
    assert.equal(toMonitorName(domain(), false), 'proj · api · app.example.com')
  })

  it('leaves the project to the group', () => {
    assert.equal(toMonitorName(domain(), true), 'api · app.example.com')
  })

  it('names the environment only when it is not the default one', () => {
    const staging = domain({ environmentName: 'staging', isDefaultEnvironment: false })
    assert.equal(toMonitorName(staging, true), 'api · staging · app.example.com')
  })

  it('falls back to the bare host without context', () => {
    const bare = domain({ projectName: null, serviceName: null })
    assert.equal(toMonitorName(bare, false), 'app.example.com')
  })
})

describe('toGroupName', () => {
  it('uses the project name, then its id', () => {
    assert.equal(toGroupName(domain()), 'proj')
    assert.equal(toGroupName(domain({ projectName: null })), 'p1')
  })
})
