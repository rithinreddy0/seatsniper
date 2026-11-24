import { expect, test } from "bun:test";
import { monitorResponse } from "./monitor-health.ts";

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
