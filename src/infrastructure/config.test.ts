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
    assert.equal(config.MONITOR_INTERVAL_SECONDS, 120)
    assert.equal(config.MONITOR_INTERVAL_SECONDS_OTHER_ENVS, 300)
    assert.equal(config.MONITOR_EXPIRY_NOTIFICATION, true)
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
    assert.throws(
      () =>
        loadConfig({
          ...minimal,
          MONITOR_INTERVAL_SECONDS_OTHER_ENVS: '25',
          MONITOR_TIMEOUT_SECONDS: '30',
        }),
      /MONITOR_TIMEOUT_SECONDS must be lower/,
    )
  })

  it('reads health paths and accepted codes as host rules', () => {
    const config = loadConfig({
      ...minimal,
      HEALTH_PATHS: 'api.example.com=/health, mta-sts.*=/.well-known/mta-sts.txt',
      ACCEPTED_STATUS_CODES: 'admin.example.com=200-299|401',
    })
    assert.deepEqual(config.HEALTH_PATHS, [
      { pattern: 'api.example.com', value: '/health' },
      { pattern: 'mta-sts.*', value: '/.well-known/mta-sts.txt' },
    ])
    assert.deepEqual(config.ACCEPTED_STATUS_CODES, [
      { pattern: 'admin.example.com', value: ['200-299', '401'] },
    ])
  })

  it('rejects a malformed host rule', () => {
    assert.throws(() => loadConfig({ ...minimal, HEALTH_PATHS: 'api.example.com' }), /HEALTH_PATHS/)
    assert.throws(() => loadConfig({ ...minimal, HEALTH_PATHS: 'api=health' }), /HEALTH_PATHS/)
    assert.throws(
      () => loadConfig({ ...minimal, ACCEPTED_STATUS_CODES: 'api=ok' }),
      /ACCEPTED_STATUS_CODES/,
    )
  })

  it('treats an empty line as unset instead of coercing it to zero', () => {
    assert.equal(loadConfig({ ...minimal, MAX_RETIRE_RATIO: '' }).MAX_RETIRE_RATIO, 0.5)
  })

  it('rejects intervals Kuma would refuse and non-numeric notification ids', () => {
    assert.throws(
      () => loadConfig({ ...minimal, MONITOR_INTERVAL_SECONDS: '19' }),
      /MONITOR_INTERVAL/,
    )
    assert.throws(
      () => loadConfig({ ...minimal, KUMA_NOTIFICATION_IDS: 'telegram' }),
      /KUMA_NOTIFICATION_IDS/,
    )
  })

  it('keeps the Kuma password off plain http outside the host and the Docker network', () => {
    assert.throws(() => loadConfig({ ...minimal, KUMA_URL: 'http://kuma.example.com' }), /KUMA_URL/)
    assert.throws(
      () => loadConfig({ ...minimal, KUMA_URL: 'https://u:p@kuma.example.com' }),
      /KUMA_URL/,
    )
    assert.equal(
      loadConfig({ ...minimal, KUMA_URL: 'http://uptime-kuma:3001' }).KUMA_URL,
      'http://uptime-kuma:3001',
    )
    assert.equal(
      loadConfig({ ...minimal, KUMA_URL: 'http://127.0.0.1:3001' }).KUMA_URL,
      'http://127.0.0.1:3001',
    )
  })
})
