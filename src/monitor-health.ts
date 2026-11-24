/** Public, non-sensitive process liveness and operational readiness. */
import { BmsError } from "./provider-error.ts";

export function monitorError(error: unknown): string {
  if (error instanceof BmsError) return `BookMyShow ${error.kind}: ${error.message}`;
  return "Availability or delivery check failed; inspect service configuration";
}

export type MonitorStatus = {
  phase: string;
  missing: string[];
  lastSuccess: string | null;
  lastAttempt?: string;
  failures?: number;
  matchingShows?: number;
  otherFormats?: string[];
  lastError?: string;
  lastDelivery?: string;
  intervalMs?: number;
};
export function monitorResponse(request: Request, status: MonitorStatus): Response {
  const path = new URL(request.url).pathname;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  if (path === "/health") return Response.json({ ok: true }, { headers });
  if (path === "/" || path === "/ready") {
    const stale =
      status.phase === "monitoring" &&
      (!status.lastSuccess ||
        Date.now() - Date.parse(status.lastSuccess) >
          Math.max(150_000, (status.intervalMs ?? 60_000) * 2.5));
    return Response.json(
      { service: "SeatSniper Telegram monitor", ...status, ...(stale ? { phase: "stale" } : {}) },
      {
        status: path === "/ready" && (status.phase !== "monitoring" || stale) ? 503 : 200,
        headers,
      },
    );
  }
  return new Response("Not found", { status: 404, headers });
}
