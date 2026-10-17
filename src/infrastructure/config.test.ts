import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig, unquote } from './config.js'

describe('unquote', () => {
  it("strips the quotes docker's --env-file leaves behind", () => {
    assert.equal(
      unquote('"postgres://u:p@dokploy-postgres:5432/dokploy"'),
      'postgres://u:p@dokploy-postgres:5432/dokploy',
    )
    assert.equal(unquote("'single'"), 'single')
  })

  it('leaves unquoted values alone', () => {
    assert.equal(unquote('postgres://u:p@host:5432/db'), 'postgres://u:p@host:5432/db')
  })

  it('does not strip quotes that are part of the value', () => {
    assert.equal(unquote('say "hi"'), 'say "hi"')
    assert.equal(unquote('"unbalanced'), '"unbalanced')
    assert.equal(unquote('pass"word"'), 'pass"word"')
  })

  it('handles short and empty values without slicing them away', () => {
    assert.equal(unquote(''), '')
    assert.equal(unquote('"'), '"')
    assert.equal(unquote('""'), '')
  })
})

const minimal = {
  DATABASE_URL: 'postgres://u:p@dokploy-postgres:5432/dokploy',
  KUMA_URL: 'https://kuma.example.com',
  KUMA_USERNAME: 'admin',
  KUMA_PASSWORD: 'secret',
}

describe('loadConfig', () => {
  it('defaults to a safe dry run that pauses instead of deleting', () => {
    const config = loadConfig(minimal)
    assert.equal(config.DRY_RUN, true)
    assert.equal(config.ON_REMOVE, 'pause')
    assert.equal(config.LOG_FORMAT, 'json')
    assert.deepEqual(config.KUMA_NOTIFICATION_IDS, [])
  })

  it('reads booleans and comma lists the way an env file writes them', () => {
    const config = loadConfig({ ...minimal, DRY_RUN: 'false', KUMA_NOTIFICATION_IDS: ' 1, 2 ,,' })
    assert.equal(config.DRY_RUN, false)
    assert.deepEqual(config.KUMA_NOTIFICATION_IDS, ['1', '2'])
  })

  it('names every invalid variable', () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL[\s\S]*KUMA_URL/)
  })

  it('rejects a timeout Kuma would refuse', () => {
    assert.throws(
      () =>
        loadConfig({ ...minimal, MONITOR_INTERVAL_SECONDS: '20', MONITOR_TIMEOUT_SECONDS: '20' }),
      /MONITOR_TIMEOUT_SECONDS must be lower/,
    )
  })
})
