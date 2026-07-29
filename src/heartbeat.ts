import { HEARTBEAT_TIMEOUT_MS } from "./constants.js";
import type { Logger } from "./logger.js";

export interface Heartbeat {
  status: "up" | "down";
  message: string;
  durationMs: number;
}

/** Kuma truncates long push messages; keep them readable in the monitor's event list. */
const MAX_MESSAGE_LENGTH = 200;

export const buildHeartbeatUrl = (
  pushUrl: string,
  heartbeat: Heartbeat,
): string => {
  const url = new URL(pushUrl);
  url.searchParams.set("status", heartbeat.status);
  url.searchParams.set("msg", heartbeat.message.slice(0, MAX_MESSAGE_LENGTH));
  url.searchParams.set("ping", String(Math.round(heartbeat.durationMs)));
  return url.toString();
};

/**
 * Pings a Kuma push monitor so Kuma notices when kuma-sync itself stops working.
 *
 * Without this the sync is the blind spot in the alerting: if it silently dies, new domains stop
 * getting monitors and nothing tells you.
 *
 * Never throws — a failed heartbeat must not fail the cycle. If the ping cannot get through, the
 * push monitor times out on Kuma's side and alerts anyway, which is the same outcome.
 */
export const sendHeartbeat = async (
  pushUrl: string | undefined,
  heartbeat: Heartbeat,
  logger: Logger,
): Promise<void> => {
  if (!pushUrl) {
    return;
  }

  try {
    const response = await fetch(buildHeartbeatUrl(pushUrl, heartbeat), {
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(
        { httpStatus: response.status },
        "Kuma rejected the heartbeat — is KUMA_PUSH_URL the right push token?",
      );
      return;
    }

    logger.debug({ status: heartbeat.status }, "heartbeat sent");
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "could not send heartbeat",
    );
  }
};
