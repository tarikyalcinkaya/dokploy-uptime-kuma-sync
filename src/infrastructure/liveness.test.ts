import assert from 'node:assert/strict'
import { mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { isAlive, markAlive, maxSilenceMs } from './liveness.js'

describe('liveness file', () => {
  it('is alive right after a cycle and dead once it goes quiet for too long', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'kuma-sync-')), 'alive')
    await markAlive(path)
    assert.equal(await isAlive(path, 900), true)

    const stale = new Date(Date.now() - maxSilenceMs(900) - 1000)
    await utimes(path, stale, stale)
    assert.equal(await isAlive(path, 900), false)
  })

  it('is not alive before the first cycle wrote the file', async () => {
    assert.equal(await isAlive('/nonexistent/kuma-sync.alive', 900), false)
  })
})
