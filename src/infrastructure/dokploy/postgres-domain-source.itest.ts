import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { databaseUrl, seedDokploy } from '../../testing/fixtures.js'
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
        domains: [{ domainId: 'd2', host: 'api.example.com', https: false, path: '/v1' }],
      },
    ])

    const domains = await new PostgresDomainSource(databaseUrl()).listDomains()

    assert.deepEqual(
      domains.map(({ domainId, host, isHttps, path, projectName, serviceName }) => ({
        domainId,
        host,
        isHttps,
        path,
        projectName,
        serviceName,
      })),
      [
        {
          domainId: 'd1',
          host: 'shop.example.com',
          isHttps: true,
          path: '/',
          projectName: 'shop',
          serviceName: 'web',
        },
        {
          domainId: 'd2',
          host: 'api.example.com',
          isHttps: false,
          path: '/v1',
          projectName: 'shop',
          serviceName: 'api',
        },
      ],
    )
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
})
