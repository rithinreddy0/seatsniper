# Telegram monitor on Render Free

This fork adds `src/render-monitor.ts`; the original Discord entrypoint is unchanged.
Deploy a Docker **web service** using `Dockerfile.render`, plan **Free**, region Singapore,
branch `render-telegram`, and health path `/health`.

Set these environment variables in Render (never commit their secret values):

| Variable | Value |
| --- | --- |
| CINEMA_URL | Full BookMyShow cinema link ending in the requested date |
| TARGET_DATE | 2026-12-17 |
| MOVIE | Avengers: Doomsday |
| LANGUAGE | English |
| FORMAT | DOLBY CINEMA 3D |
| POLL_INTERVAL_SEC | 60 |
| TELEGRAM_BOT_TOKEN | Your rotated existing bot token |
| TELEGRAM_CHAT_ID | Your private Telegram chat ID |
| DATABASE_URL | Dedicated Neon Postgres connection URL with SSL |

The target is restored from environment on every restart. Postgres stores successful
delivery IDs; notifications are disabled until all three private settings exist.
Availability probes still run so deployment access can be tested before adding a bot token.
Database schema is additive and created only when a matching show needs delivery.
Use one service instance. A Postgres transaction advisory lock serializes overlapping
deployments. A crash after Telegram accepts a message but before its ledger transaction
commits can still cause a retry: exactly-once delivery across two services is not guaranteed.

`GET /health` is a side-effect-free liveness endpoint for external cron pings every five
minutes. It never fetches BookMyShow or sends an alert. `GET /` reports non-sensitive
operational status; `/ready` returns 503 until configured and successfully checking.
The internal loop checks every 60 seconds start-to-start when checks complete in time.
Slow checks are never overlapped or followed by catch-up bursts. The monitor stops
checking after the target date passes in IST.

Free Render storage is ephemeral: do not replace Postgres with local SQLite for delivery
history. External pings address idle sleep, not restarts, free-hour quotas, or site blocks.
Neon quotas also apply. Keep Postgres connections short-lived and only access the
ledger when matches exist. Confirm `/ready` and a real Telegram notification before
depending on this monitor. A successful web deployment alone does not prove monitoring.

## External cron configuration

Use cron-job.org or an existing external scheduler: method GET, URL
`https://YOUR-SERVICE.onrender.com/health`, every five minutes (`*/5 * * * *`).
Do not put tokens in the ping URL. No account or cron job is automatically created by
this repository. Enable failure notifications in the scheduler if desired.

## Commands

`bun run start:render` starts the Telegram web monitor. `bun run probe:cinema` makes one
availability check without notifications. Run `bun run check` before publishing changes.
