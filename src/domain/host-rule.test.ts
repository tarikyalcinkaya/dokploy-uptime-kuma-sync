import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findHostRule, matchesPattern } from './host-rule.js'

describe('matchesPattern', () => {
  it('matches a literal host case-insensitively and nothing else', () => {
    assert.equal(matchesPattern('api.example.com', 'API.example.com'), true)
    assert.equal(matchesPattern('api.example.com', 'dev-api.example.com'), false)
  })

  it('lets a star span dots', () => {
    assert.equal(matchesPattern('mta-sts.*', 'mta-sts.mail.example.com'), true)
    assert.equal(matchesPattern('*.example.com', 'example.com'), false)
  })

  it('treats regex characters in the pattern literally', () => {
    assert.equal(matchesPattern('a.b', 'axb'), false)
    assert.equal(matchesPattern('(a)+', '(a)+'), true)
  })

  it('finishes on a pattern with many stars against a long host', { timeout: 5000 }, () => {
    assert.equal(matchesPattern('*a*a*a*a*a*a*b', 'a'.repeat(5000)), false)
    assert.equal(matchesPattern('*a*a*a*a*a*a*b', `${'a'.repeat(5000)}b`), true)
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
