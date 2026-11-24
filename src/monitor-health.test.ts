import { expect, test } from "bun:test";
import { monitorError, monitorResponse } from "./monitor-health.ts";
import { BmsError } from "./provider-error.ts";

test("health is side-effect free; readiness exposes missing setup without exposing credentials", async () => {
  const status = {
    phase: "awaiting_configuration",
    missing: ["TELEGRAM_BOT_TOKEN"],
    lastSuccess: null,
  };
  const health = monitorResponse(new Request("https://example.com/health"), status);
  expect(health.status).toBe(200);
  const ready = monitorResponse(new Request("https://example.com/ready"), status);
  expect(ready.status).toBe(503);
  expect(await ready.text()).toContain("awaiting_configuration");
  expect(monitorResponse(new Request("https://example.com/check"), status).status).toBe(404);
});

test("readiness fails when successful availability checks become stale", () => {
  const status = { phase: "monitoring", missing: [], lastSuccess: new Date(0).toISOString() };
  expect(monitorResponse(new Request("https://example.com/ready"), status).status).toBe(503);
});

test("provider diagnostics remain actionable while generic errors cannot leak credentials", () => {
  expect(monitorError(new BmsError("blocked", "HTTP 403 (123 bytes)"))).toContain("HTTP 403");
  expect(monitorError(new Error("postgres://secret-password@private-host/db"))).not.toContain(
    "secret-password",
  );
});
