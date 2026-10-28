import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLogger } from './logger.js'

describe('createLogger', () => {
  it('builds a JSON logger by default', () => {
    assert.equal(createLogger('silent').level, 'silent')
  })

  it('builds a pretty logger when pino-pretty is installed', () => {
    assert.equal(createLogger('silent', 'pretty').level, 'silent')
  })
})
