import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findHostRule, matchesHost } from './host-rule.js'

describe('matchesHost', () => {
  it('matches a literal host case-insensitively and nothing else', () => {
    assert.equal(matchesHost('api.example.com', 'API.example.com'), true)
    assert.equal(matchesHost('api.example.com', 'dev-api.example.com'), false)
  })

  it('lets a star span dots', () => {
    assert.equal(matchesHost('mta-sts.*', 'mta-sts.mail.example.com'), true)
    assert.equal(matchesHost('*.example.com', 'example.com'), false)
  })

  it('treats regex characters in the pattern literally', () => {
    assert.equal(matchesHost('a.b', 'axb'), false)
  })
})

describe('findHostRule', () => {
  it('returns the first matching rule', () => {
    const rules = [
      { pattern: 'api.*', value: '/health' },
      { pattern: '*', value: '/' },
    ]
    assert.equal(findHostRule(rules, 'api.example.com'), '/health')
    assert.equal(findHostRule(rules, 'web.example.com'), '/')
    assert.equal(findHostRule([], 'web.example.com'), null)
  })
})
