import { authenticator } from 'otplib'
import { io, type Socket } from 'socket.io-client'
import type { ILogger } from '../../application/logger.js'
import { CALL_TIMEOUT_MS, CONNECT_TIMEOUT_MS, PUSH_TIMEOUT_MS } from '../timeouts.js'

interface PasswordCredentials {
  url: string
  username: string
  password: string
  totpSecret?: string | undefined
}

// A session JWT from an earlier login; `loginByToken` is not subject to Kuma's 20/min login limit.
interface TokenCredentials {
  url: string
  jwt: string
}

export type KumaCredentials = PasswordCredentials | TokenCredentials

export interface KumaAck {
  ok: boolean
  msg?: string
  monitorID?: number
  tokenRequired?: boolean
  token?: string
}

export const describeAckFailure = (event: string, ack: KumaAck | undefined): string =>
  `Kuma ${event} failed: ${ack?.msg ?? 'no reason given'}`

// Kuma's Socket.IO API is undocumented, so only the few events we need are spoken, without a wrapper.
export class KumaSession {
  readonly #credentials: KumaCredentials
  readonly #logger: ILogger
  #socket: Socket | null = null
  #jwt: string | null = null
  #pushes = new Map<string, Promise<unknown>>()

  constructor(credentials: KumaCredentials, logger: ILogger) {
    this.#credentials = credentials
    this.#logger = logger
  }

  async open(): Promise<void> {
    const socket = io(this.#credentials.url, {
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    })
    this.#socket = socket

    // Kuma pushes these right after login, unprompted; listen before connecting so none is missed.
    for (const event of ['monitorList', 'notificationList']) {
      this.#pushes.set(event, this.#capturePush(socket, event))
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Could not connect to Kuma at ${this.#credentials.url}`))
      }, CONNECT_TIMEOUT_MS)

      socket.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('connect_error', (error: Error) => {
        clearTimeout(timer)
        reject(new Error(`Kuma connection failed: ${error.message}`))
      })
    })
    this.#logger.debug('connected to Kuma')

    await this.#login()
  }

  pushed(event: 'monitorList' | 'notificationList'): Promise<unknown> {
    const push = this.#pushes.get(event)
    if (!push) {
      throw new Error(`${event} read before open()`)
    }
    return push
  }

  async call(event: string, ...args: unknown[]): Promise<KumaAck | undefined> {
    const socket = this.#socket
    if (!socket) {
      throw new Error(`${event} called before open()`)
    }

    try {
      return (await socket.timeout(CALL_TIMEOUT_MS).emitWithAck(event, ...args)) as
        KumaAck | undefined
    } catch {
      throw new Error(`Kuma ${event} timed out after ${CALL_TIMEOUT_MS}ms`)
    }
  }

  async expectOk(event: string, ...args: unknown[]): Promise<KumaAck> {
    const ack = await this.call(event, ...args)
    if (!ack?.ok) {
      throw new Error(describeAckFailure(event, ack))
    }
    return ack
  }

  get jwt(): string | null {
    return this.#jwt
  }

  close(): void {
    this.#socket?.close()
    this.#socket = null
  }

  async #login(): Promise<void> {
    const credentials = this.#credentials
    const ack =
      'jwt' in credentials
        ? await this.call('loginByToken', credentials.jwt)
        : await this.call('login', {
            username: credentials.username,
            password: credentials.password,
            token: credentials.totpSecret ? authenticator.generate(credentials.totpSecret) : '',
          })

    if (ack?.tokenRequired) {
      throw new Error(
        "Kuma requires a 2FA token — set KUMA_TOTP_SECRET to the account's base32 TOTP secret",
      )
    }
    if (!ack?.ok) {
      throw new Error(describeAckFailure('login', ack))
    }
    this.#logger.debug('authenticated with Kuma')
    this.#jwt = ack.token ?? null
  }

  #capturePush(socket: Socket, event: string): Promise<unknown> {
    const push = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for Kuma to send ${event}`))
      }, PUSH_TIMEOUT_MS)
      // A pending capture must not hold the event loop open after close().
      timer.unref()

      socket.once(event, (payload: unknown) => {
        clearTimeout(timer)
        resolve(payload)
      })
    })

    // Not every run reads every list; without a handler an unread timeout becomes an unhandled
    // rejection. Awaiters still see the error.
    push.catch((error: unknown) => {
      this.#logger.debug({ event, err: String(error) }, 'unread Kuma push')
    })
    return push
  }
}
