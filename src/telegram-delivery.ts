/** Delivery confirmation and durable session ledger for the Telegram monitor. */
import { SQL } from "bun";
import type { CinemaShow } from "./venue-monitor.ts";

export async function sendTelegram(
  token: string,
  chat: string,
  text: string,
  transport: (request: string, options?: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await transport(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Telegram network request failed");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Telegram delivery failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { ok?: boolean };
  if (body.ok !== true) throw new Error("Telegram delivery failed");
}

export async function deliverFresh(
  shows: CinemaShow[],
  seen: Set<string>,
  send: (fresh: CinemaShow[]) => Promise<void>,
): Promise<number> {
  const fresh = shows.filter((show) => !seen.has(show.id));
  if (!fresh.length) return 0;
  await send(fresh);
  for (const show of fresh) seen.add(show.id);
  return fresh.length;
}

/** Only used when shows exist: no database polling on empty cinema checks. */
export async function deliverDurably(
  databaseUrl: string,
  watchKey: string,
  shows: CinemaShow[],
  send: (fresh: CinemaShow[]) => Promise<void>,
): Promise<number> {
  const sql = new SQL(databaseUrl, { max: 1, connectionTimeout: 15, idleTimeout: 5 });
  try {
    // Additive schema migration, safe to run on a fresh dedicated database.
    await sql`CREATE TABLE IF NOT EXISTS seatsniper_telegram_delivery (
      watch_key TEXT NOT NULL, session_id TEXT NOT NULL,
      delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (watch_key, session_id)
    )`;
    return await sql.begin(async (tx) => {
      const locks = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${watchKey})) AS acquired`;
      if (!locks[0]?.acquired) return 0;
      const rows =
        await tx`SELECT session_id FROM seatsniper_telegram_delivery WHERE watch_key = ${watchKey}`;
      const seen = new Set<string>(rows.map((row: { session_id: string }) => row.session_id));
      return deliverFresh(shows, seen, async (fresh) => {
        await send(fresh);
        for (const show of fresh) {
          await tx`INSERT INTO seatsniper_telegram_delivery (watch_key, session_id)
            VALUES (${watchKey}, ${show.id}) ON CONFLICT DO NOTHING`;
        }
      });
    });
  } finally {
    await sql.close();
  }
}
