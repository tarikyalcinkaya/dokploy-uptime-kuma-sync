import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeOwnership, readOwnedDomainId, readPausedAt } from './ownership.js'

describe('ownership markers', () => {
  it('round-trips the domain id and the pause time', () => {
    const pausedAt = new Date('2026-10-18T12:00:00.000Z')
    const monitor = { description: describeOwnership('dom1', pausedAt) }
    assert.equal(readOwnedDomainId(monitor), 'dom1')
    assert.deepEqual(readPausedAt(monitor), pausedAt)
    assert.equal(readPausedAt({ description: describeOwnership('dom1') }), null)
  })

  it('does not claim a description that only mentions the marker mid-line', () => {
    assert.equal(readOwnedDomainId({ description: 'see dokploy:domainId=dom1 for details' }), null)
  })

  it('ignores a pause time that is not a date', () => {
    assert.equal(readPausedAt({ description: 'dokploy:pausedAt=soon' }), null)
  })
})
