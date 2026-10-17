import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { databaseUrl, seedDokploy, withDatabase } from '../../testing/fixtures.js'
import { PostgresDomainSource } from './postgres-domain-source.js'

describe('PostgresDomainSource against a Dokploy-shaped schema', () => {
  it('reads application and compose domains with their project and service', async () => {
    await seedDokploy([
      {
        projectId: 'p1',
        projectName: 'shop',
        kind: 'application',
        serviceId: 'a1',
        serviceName: 'web',
        domains: [{ domainId: 'd1', host: 'shop.example.com' }],
      },
      {
        projectId: 'p1',
        projectName: 'shop',
        kind: 'compose',
        serviceId: 'c1',
        serviceName: 'api',
        domains: [
          {
            domainId: 'd2',
            host: 'api.example.com',
            https: false,
            path: '/v1',
            middlewares: ['vpn-only@file'],
          },
        ],
      },
    ])

    const domains = await new PostgresDomainSource(databaseUrl()).listDomains()

    assert.deepEqual(domains, [
      {
        domainId: 'd1',
        host: 'shop.example.com',
        isHttps: true,
        path: '/',
        domainType: 'application',
        environmentName: 'production',
        projectId: 'p1',
        projectName: 'shop',
        serviceName: 'web',
        isDefaultEnvironment: true,
        middlewares: [],
      },
      {
        domainId: 'd2',
        host: 'api.example.com',
        isHttps: false,
        path: '/v1',
        domainType: 'compose',
        environmentName: 'production',
        projectId: 'p1',
        projectName: 'shop',
        serviceName: 'api',
        isDefaultEnvironment: true,
        middlewares: ['vpn-only@file'],
      },
    ])
  })

  it('leaves out preview deployments and blank hosts', async () => {
    await seedDokploy([
      {
        projectId: 'p1',
        projectName: 'shop',
        kind: 'application',
        serviceId: 'a1',
        serviceName: 'web',
        domains: [
          { domainId: 'keep', host: 'shop.example.com' },
          { domainId: 'preview', host: 'pr-1.example.com', previewDeploymentId: 'pd1' },
          { domainId: 'blank', host: '   ' },
        ],
      },
    ])

    const domains = await new PostgresDomainSource(databaseUrl()).listDomains()
    assert.deepEqual(
      domains.map((domain) => domain.domainId),
      ['keep'],
    )
  })

  it('gives up on a query stuck behind a lock instead of waiting forever', async () => {
    await withDatabase((sql) =>
      sql.begin(async (transaction) => {
        await transaction`LOCK TABLE domain IN ACCESS EXCLUSIVE MODE`
        await assert.rejects(
          new PostgresDomainSource(databaseUrl(), 500).listDomains(),
          /statement timeout/,
        )
      }),
    )
  })
})
