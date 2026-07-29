import { authenticator } from "otplib";
import { type Socket, io } from "socket.io-client";
import {
  CALL_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  MONITOR_LIST_TIMEOUT_MS,
} from "./constants.js";
import type { Logger } from "./logger.js";

export interface KumaMonitor {
  id: number;
  name: string;
  url: string | null;
  type: string;
  active: boolean;
  description: string | null;
}

export interface KumaNotification {
  id: number;
  name: string;
  active: boolean;
  isDefault: boolean;
}

interface KumaAck {
  ok: boolean;
  msg?: string;
  monitorID?: number;
}

export interface KumaCredentials {
  url: string;
  username: string;
  password: string;
  totpSecret?: string | undefined;
}

/**
 * Minimal client for Uptime Kuma's Socket.IO API.
 *
 * Kuma has no write REST API — monitors can only be managed over Socket.IO, which is undocumented
 * and unversioned. We deliberately speak only the handful of events we need (`login`, `monitorList`,
 * `add`, `editMonitor`, `pauseMonitor`, `resumeMonitor`, `deleteMonitor`) instead of depending on a
 * wrapper library, so there is less surface to break on a Kuma upgrade.
 *
 * Verified against the 1.23.x event names. Kuma 2.x is a different major and is not covered.
 */
export class KumaClient {
  private socket: Socket | null = null;
  private monitorListPromise: Promise<Record<string, KumaMonitor>> | null =
    null;
  private notificationListPromise: Promise<KumaNotification[]> | null = null;

  constructor(
    private readonly credentials: KumaCredentials,
    private readonly logger: Logger,
  ) {}

  async connect(): Promise<void> {
    const socket = io(this.credentials.url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    this.socket = socket;

    // Kuma pushes these right after a successful login, unprompted. Register the listeners before
    // connecting so nothing is missed, and resolve them lazily when someone asks.
    this.monitorListPromise = this.capturePush<Record<string, KumaMonitor>>(
      socket,
      "monitorList",
      {},
    );
    this.notificationListPromise = this.capturePush<KumaNotification[]>(
      socket,
      "notificationList",
      [],
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Could not connect to Kuma at ${this.credentials.url}`),
        );
      }, CONNECT_TIMEOUT_MS);

      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error: Error) => {
        clearTimeout(timer);
        reject(new Error(`Kuma connection failed: ${error.message}`));
      });
    });

    this.logger.debug("connected to Kuma");
  }

  async login(): Promise<void> {
    const token = this.credentials.totpSecret
      ? authenticator.generate(this.credentials.totpSecret)
      : "";

    const response = await this.emit<KumaAck & { tokenRequired?: boolean }>(
      "login",
      {
        username: this.credentials.username,
        password: this.credentials.password,
        token,
      },
    );

    if (response?.tokenRequired) {
      throw new Error(
        "Kuma requires a 2FA token — set KUMA_TOTP_SECRET to the account's base32 TOTP secret",
      );
    }
    if (!response?.ok) {
      throw new Error(
        `Kuma login rejected: ${response?.msg ?? "unknown reason"}`,
      );
    }

    this.logger.debug("authenticated with Kuma");
  }

  async listMonitors(): Promise<KumaMonitor[]> {
    if (!this.monitorListPromise) {
      throw new Error("listMonitors called before connect()");
    }
    const list = await this.monitorListPromise;
    return Object.values(list);
  }

  /** Kuma's UI never shows notification ids, but it pushes them over the socket. */
  async listNotifications(): Promise<KumaNotification[]> {
    if (!this.notificationListPromise) {
      throw new Error("listNotifications called before connect()");
    }
    return this.notificationListPromise;
  }

  private capturePush<T>(socket: Socket, event: string, empty: T): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for Kuma to send ${event}`));
      }, MONITOR_LIST_TIMEOUT_MS);
      // Do not let a pending capture hold the event loop open after close().
      timer.unref();

      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload ?? empty);
      });
    });

    // Not every run consumes every captured list. Marking it handled here keeps an unread timeout
    // from surfacing as an unhandled rejection; awaiters still see the error normally.
    promise.catch(() => {});
    return promise;
  }

  async addMonitor(monitor: Record<string, unknown>): Promise<number> {
    const response = await this.emit<KumaAck>("add", monitor);
    if (!response?.ok || typeof response.monitorID !== "number") {
      throw new Error(
        `Kuma rejected monitor: ${response?.msg ?? "unknown reason"}`,
      );
    }
    return response.monitorID;
  }

  async editMonitor(monitor: Record<string, unknown>): Promise<void> {
    await this.expectOk("editMonitor", monitor);
  }

  async pauseMonitor(id: number): Promise<void> {
    await this.expectOk("pauseMonitor", id);
  }

  async resumeMonitor(id: number): Promise<void> {
    await this.expectOk("resumeMonitor", id);
  }

  async deleteMonitor(id: number): Promise<void> {
    await this.expectOk("deleteMonitor", id);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private async expectOk(event: string, payload: unknown): Promise<void> {
    const response = await this.emit<KumaAck>(event, payload);
    if (!response?.ok) {
      throw new Error(
        `Kuma ${event} failed: ${response?.msg ?? "unknown reason"}`,
      );
    }
  }

  private emit<T>(event: string, payload: unknown): Promise<T> {
    const socket = this.socket;
    if (!socket) {
      throw new Error(`${event} called before connect()`);
    }

    return new Promise<T>((resolve, reject) => {
      socket
        .timeout(CALL_TIMEOUT_MS)
        .emit(event, payload, (error: Error | null, response: T) => {
          if (error) {
            reject(
              new Error(`Kuma ${event} timed out after ${CALL_TIMEOUT_MS}ms`),
            );
            return;
          }
          resolve(response);
        });
    });
  }
}
