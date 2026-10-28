import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import type { ILogger } from '../application/logger.js'
import { PushHeartbeatSink } from './heartbeat.js'

const PUSH_URL = 'https://kuma.example.com/api/push/abc123'
const beat = { status: 'up', message: 'created=0', durationMs: 12 } as const

const warnings: string[] = []
const logger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: (message: unknown, extra?: unknown) => warnings.push(String(extra ?? message)),
  error: () => {},
}

const stubFetch = (impl: () => Promise<Response>) => mock.method(globalThis, 'fetch', impl)

describe('PushHeartbeatSink', () => {
  afterEach(() => {
    mock.restoreAll()
    warnings.length = 0
  })

  it('is configured only with a push URL', () => {
    assert.equal(new PushHeartbeatSink(PUSH_URL, logger).isConfigured, true)
    assert.equal(new PushHeartbeatSink(undefined, logger).isConfigured, false)
  })

  it('pings the push URL with the heartbeat', async () => {
    const fetchStub = stubFetch(async () => new Response('ok'))
    await new PushHeartbeatSink(PUSH_URL, logger).send(beat)

    assert.equal(fetchStub.mock.callCount(), 1)
    const called = `${fetchStub.mock.calls[0]?.arguments[0] as string}`
    assert.match(
      called,
      /^https:\/\/kuma\.example\.com\/api\/push\/abc123\?status=up&msg=created%3D0/,
    )
  })

  it('does nothing without a push URL', async () => {
    const fetchStub = stubFetch(async () => new Response('ok'))
    await new PushHeartbeatSink(undefined, logger).send(beat)
    assert.equal(fetchStub.mock.callCount(), 0)
  })

  it('warns instead of throwing when Kuma rejects the ping or the call fails', async () => {
    stubFetch(async () => new Response('no', { status: 404 }))
    await new PushHeartbeatSink(PUSH_URL, logger).send(beat)
    mock.restoreAll()
    stubFetch(async () => {
      throw new Error('network down')
    })
    await new PushHeartbeatSink(PUSH_URL, logger).send(beat)

    assert.deepEqual(warnings, [
      'Kuma rejected the heartbeat — is KUMA_PUSH_URL the right push token?',
      'could not send heartbeat',
    ])
  })
})
