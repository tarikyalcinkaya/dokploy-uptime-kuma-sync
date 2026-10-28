import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Heartbeat, IHeartbeatSink } from '../domain/ports.js'
import type { ILogger } from './logger.js'
import type { ReconcileReportDto } from './reconcile-report.js'
import { runMonitoredCycle } from './run-monitored-cycle.js'

const report: ReconcileReportDto = {
  domainCount: 5,
  managedCount: 4,
  create: [{ host: 'a.example.com', name: 'a', monitorId: null }],
  update: [],
  revive: [],
  suspend: [],
  retire: [
    { host: null, name: 'b', monitorId: 2 },
    { host: null, name: 'c', monitorId: 3 },
  ],
  expire: [],
  stopped: [],
  groups: { create: [], update: [], retire: [] },
}

class RecordingSink implements IHeartbeatSink {
  readonly sent: Heartbeat[] = []

  constructor(readonly isConfigured = true) {}

  async send(heartbeat: Heartbeat): Promise<void> {
    this.sent.push(heartbeat)
  }
}

const debugMessages: string[] = []
const logger: ILogger = {
  debug: (message: unknown, extra?: unknown) => debugMessages.push(String(extra ?? message)),
  info: () => {},
  warn: () => {},
  error: () => {},
}

const ticks = () => {
  let now = 1000
  return () => (now += 250)
}

describe('runMonitoredCycle', () => {
  it('reports up with the plan counts and the elapsed time', async () => {
    const heartbeat = new RecordingSink()
    const result = await runMonitoredCycle(
      false,
      { heartbeat, logger, clock: ticks() },
      async () => report,
    )

    assert.equal(result, report)
    assert.deepEqual(heartbeat.sent, [
      { status: 'up', message: 'created=1 updated=0 retired=2 managed=4', durationMs: 250 },
    ])
  })

  it('reports down with the error message and rethrows', async () => {
    const heartbeat = new RecordingSink()
    const failure = new Error('kuma unreachable')

    await assert.rejects(
      runMonitoredCycle(false, { heartbeat, logger, clock: ticks() }, async () => {
        throw failure
      }),
      failure,
    )
    assert.deepEqual(heartbeat.sent, [
      { status: 'down', message: 'kuma unreachable', durationMs: 250 },
    ])
  })

  it('sends nothing on a dry run, success or failure', async () => {
    const heartbeat = new RecordingSink()

    await runMonitoredCycle(true, { heartbeat, logger }, async () => report)
    await assert.rejects(
      runMonitoredCycle(true, { heartbeat, logger }, async () => {
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.deepEqual(heartbeat.sent, [])
  })

  it('mentions the skipped heartbeat only when a push URL is configured', async () => {
    debugMessages.length = 0
    await runMonitoredCycle(
      true,
      { heartbeat: new RecordingSink(false), logger },
      async () => report,
    )
    assert.deepEqual(debugMessages, [])

    await runMonitoredCycle(
      true,
      { heartbeat: new RecordingSink(true), logger },
      async () => report,
    )
    assert.deepEqual(debugMessages, ['dry run — heartbeat skipped'])
  })
})
