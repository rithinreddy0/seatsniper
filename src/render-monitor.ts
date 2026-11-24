/** Render web entrypoint: fixed environment watch, Telegram alerts, no Discord credentials. */
import { closeBms, fetchCinemaHtml, initBms, rotateSessionIfStale } from "./bms.ts";
import { monitorError, monitorResponse, type MonitorStatus } from "./monitor-health.ts";
import { deliverDurably, sendTelegram } from "./telegram-delivery.ts";
import { todayIST } from "./time-filter.ts";
import { parseCinemaPage, readMonitorConfig } from "./venue-monitor.ts";

const config = readMonitorConfig(process.env);
const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
const chat = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
const database = process.env.DATABASE_URL?.trim() ?? "";
const missing = [
  !token && "TELEGRAM_BOT_TOKEN",
  !chat && "TELEGRAM_CHAT_ID",
  !database && "DATABASE_URL",
].filter((key): key is string => Boolean(key));
const status: MonitorStatus = {
  phase: "starting",
  missing,
  lastSuccess: null,
  failures: 0,
  intervalMs: config.intervalMs,
};
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 10000),
  fetch: (request) => monitorResponse(request, status),
});
console.log(
  `[monitor] HTTP listening on ${server.port}; checks every ${config.intervalMs / 1000}s`,
);
if (missing.length)
  console.log(
    `[monitor] Missing ${missing.join(", ")}; availability probes run, notifications disabled`,
  );
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let active: Promise<void> | null = null;
let initialized = false;
let failureNotified = false;

async function check(): Promise<void> {
  if (todayIST() > config.date) {
    status.phase = "expired";
    return;
  }
  status.lastAttempt = new Date().toISOString();
  try {
    if (!initialized) {
      await initBms();
      initialized = true;
    }
    rotateSessionIfStale();
    const result = parseCinemaPage(await fetchCinemaHtml(config.url), config);
    status.lastSuccess = new Date().toISOString();
    status.matchingShows = result.shows.length;
    status.otherFormats = result.otherFormats;
    status.phase = missing.length ? "awaiting_configuration" : "monitoring";
    status.lastError = undefined;
    if (result.shows.length && !missing.length) {
      const count = await deliverDurably(database, config.key, result.shows, async (fresh) => {
        await sendTelegram(
          token,
          chat,
          [
            `BOOKING OPEN: ${config.movie}`,
            `${config.language} | ${config.format}`,
            `${result.venue} | ${config.date.slice(0, 4)}-${config.date.slice(4, 6)}-${config.date.slice(6)}`,
            ...fresh.map((show) => `${show.time}${show.screen ? ` — ${show.screen}` : ""}`),
            config.url,
          ].join("\n"),
        );
      });
      if (count) status.lastDelivery = new Date().toISOString();
    }
    if (failureNotified && token && chat) {
      await sendTelegram(
        token,
        chat,
        "SeatSniper recovered: BookMyShow checks are succeeding again.",
      );
    }
    failureNotified = false;
    status.failures = 0;
    console.log(
      `[monitor] checked ${config.date}: matching=${result.shows.length}; phase=${status.phase}`,
    );
  } catch (error) {
    status.failures = (status.failures ?? 0) + 1;
    status.phase = "degraded";
    // Provider errors have no credentials. Never log DB/Telegram URLs or their raw errors.
    status.lastError = monitorError(error);
    console.error(
      `[monitor] check failed (${status.failures}); ${error instanceof Error && /^Telegram /.test(error.message) ? error.message : status.lastError}`,
    );
    if (status.failures >= 5 && !failureNotified && token && chat) {
      try {
        await sendTelegram(
          token,
          chat,
          "SeatSniper warning: 5 consecutive checks failed. Monitoring is degraded; check BookMyShow manually.",
        );
        failureNotified = true;
      } catch {
        console.error("[monitor] failure warning could not be delivered; will retry");
      }
    }
  }
}

async function tick(): Promise<void> {
  if (stopping) return;
  const started = Date.now();
  active = check();
  await active;
  active = null;
  if (!stopping && status.phase !== "expired") {
    // Keep a start-to-start minute when checks finish in time; never overlap or burst after a slow check.
    const delay =
      Date.now() - started < config.intervalMs
        ? config.intervalMs - (Date.now() - started)
        : config.intervalMs;
    timer = setTimeout(() => void tick(), Math.max(1, delay));
  }
}
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  status.phase = "stopping";
  if (timer) clearTimeout(timer);
  if (active) await Promise.race([active, Bun.sleep(20_000)]);
  await closeBms();
  await server.stop(true);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown());
void tick();
