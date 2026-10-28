import type { ILogger } from '../application/logger.js'
import type { Heartbeat, IHeartbeatSink } from '../domain/ports.js'
import { errorMessage } from '../shared/errors.js'
import { HEARTBEAT_TIMEOUT_MS } from './timeouts.js'

export type { Heartbeat }

// Kuma truncates long push messages; keep them readable in the monitor's event list.
const MAX_MESSAGE_LENGTH = 200

export const buildHeartbeatUrl = (pushUrl: string, heartbeat: Heartbeat): string => {
  const url = new URL(pushUrl)
  url.searchParams.set('status', heartbeat.status)
  url.searchParams.set('msg', heartbeat.message.slice(0, MAX_MESSAGE_LENGTH))
  url.searchParams.set('ping', String(Math.round(heartbeat.durationMs)))
  return url.toString()
}

// Never throws: a failed ping must not fail the cycle, and Kuma's push timeout alerts anyway.
export const sendHeartbeat = async (
  pushUrl: string | undefined,
  heartbeat: Heartbeat,
  logger: ILogger,
): Promise<void> => {
  if (!pushUrl) {
    return
  }

  try {
    const response = await fetch(buildHeartbeatUrl(pushUrl, heartbeat), {
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    })

    if (!response.ok) {
      logger.warn(
        { httpStatus: response.status },
        'Kuma rejected the heartbeat — is KUMA_PUSH_URL the right push token?',
      )
      return
    }

    logger.debug({ status: heartbeat.status }, 'heartbeat sent')
  } catch (error) {
    logger.warn({ err: errorMessage(error) }, 'could not send heartbeat')
  }
}

export class PushHeartbeatSink implements IHeartbeatSink {
  readonly #pushUrl: string | undefined
  readonly #logger: ILogger

  constructor(pushUrl: string | undefined, logger: ILogger) {
    this.#pushUrl = pushUrl
    this.#logger = logger
  }

  get isConfigured(): boolean {
    return Boolean(this.#pushUrl)
  }

  send(heartbeat: Heartbeat): Promise<void> {
    return sendHeartbeat(this.#pushUrl, heartbeat, this.#logger)
  }
}
