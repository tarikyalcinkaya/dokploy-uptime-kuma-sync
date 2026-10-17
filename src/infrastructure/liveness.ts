import { stat, writeFile } from 'node:fs/promises'

const MILLISECONDS_PER_SECOND = 1000

// Slack for one slow cycle on top of two missed sleeps; a cycle waits on many timed-out calls at worst.
const CYCLE_ALLOWANCE_SECONDS = 300

export const DEFAULT_ALIVE_FILE = '/tmp/kuma-sync.alive'

export const markAlive = async (path: string, now = new Date()): Promise<void> => {
  await writeFile(path, now.toISOString())
}

export const maxSilenceMs = (intervalSeconds: number): number =>
  (2 * intervalSeconds + CYCLE_ALLOWANCE_SECONDS) * MILLISECONDS_PER_SECOND

export const isAlive = async (
  path: string,
  intervalSeconds: number,
  now = Date.now(),
): Promise<boolean> => {
  try {
    const { mtimeMs } = await stat(path)
    return now - mtimeMs <= maxSilenceMs(intervalSeconds)
  } catch {
    return false
  }
}
