import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHeartbeatUrl } from "./heartbeat.js";

const PUSH_URL = "https://kuma.example.com/api/push/abc123";

describe("buildHeartbeatUrl", () => {
  it("keeps the push token path and adds the status params", () => {
    const url = new URL(
      buildHeartbeatUrl(PUSH_URL, {
        status: "up",
        message: "created=1 retired=0",
        durationMs: 1234.6,
      }),
    );

    assert.equal(url.pathname, "/api/push/abc123");
    assert.equal(url.searchParams.get("status"), "up");
    assert.equal(url.searchParams.get("msg"), "created=1 retired=0");
    assert.equal(url.searchParams.get("ping"), "1235");
  });

  it("reports failures as down", () => {
    const url = new URL(
      buildHeartbeatUrl(PUSH_URL, {
        status: "down",
        message: "Kuma login rejected",
        durationMs: 0,
      }),
    );

    assert.equal(url.searchParams.get("status"), "down");
    assert.equal(url.searchParams.get("msg"), "Kuma login rejected");
  });

  it("truncates long messages so Kuma's event list stays readable", () => {
    const url = new URL(
      buildHeartbeatUrl(PUSH_URL, {
        status: "down",
        message: "x".repeat(500),
        durationMs: 0,
      }),
    );

    assert.equal(url.searchParams.get("msg")?.length, 200);
  });

  it("does not clobber a token already carried as a query param", () => {
    const url = new URL(
      buildHeartbeatUrl(`${PUSH_URL}?foo=bar`, {
        status: "up",
        message: "ok",
        durationMs: 5,
      }),
    );

    assert.equal(url.searchParams.get("foo"), "bar");
    assert.equal(url.searchParams.get("status"), "up");
  });
});
