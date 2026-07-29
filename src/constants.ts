/** Marker written into a Kuma monitor's description so we can recognise our own monitors. */
export const MANAGED_MARKER_PREFIX = "dokploy:domainId=";

export const MANAGED_NOTICE = "Managed by kuma-sync — do not edit manually.";

/** Socket.IO connection handshake budget. */
export const CONNECT_TIMEOUT_MS = 15_000;

/** Per-event acknowledgement budget for Kuma socket calls. */
export const CALL_TIMEOUT_MS = 20_000;

/** How long to wait for Kuma to push the initial `monitorList` after login. */
export const MONITOR_LIST_TIMEOUT_MS = 30_000;

/** Budget for the push ping to Kuma. */
export const HEARTBEAT_TIMEOUT_MS = 10_000;

/** Postgres connection/statement budget. */
export const DB_TIMEOUT_SECONDS = 10;

/** Always allow at least this many monitors to be retired in a single run. */
export const MIN_RETIRE_ALLOWANCE = 1;

/** Kuma monitor defaults that we do not expose as configuration. */
export const MONITOR_DEFAULTS = {
  type: "http",
  method: "GET",
  accepted_statuscodes: ["200-299"],
  maxredirects: 10,
  expiryNotification: false,
  ignoreTls: false,
  upsideDown: false,
  resendInterval: 0,
  httpBodyEncoding: "json",
  authMethod: null,
  parent: null,
} as const;
