/** Strict cinema-page matching for an environment-configured Telegram watch. */
import { createHash } from "node:crypto";
import { isRealDateCode } from "./time-filter.ts";

export type MonitorConfig = {
  url: string;
  date: string;
  venueCode: string;
  movie: string;
  language: string;
  format: string;
  intervalMs: number;
  key: string;
};
export type CinemaShow = { id: string; time: string; screen: string };
export type CinemaResult = {
  servedDate: string;
  venue: string;
  shows: CinemaShow[];
  otherFormats: string[];
};
const normal = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
const movieName = (value: unknown) => normal(value).replace(/[^A-Z0-9 ]/g, "");
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readMonitorConfig(env: Record<string, string | undefined>): MonitorConfig {
  const url = new URL(env.CINEMA_URL ?? "");
  const match = url.pathname.match(
    /^\/cinemas\/[a-z-]+\/[a-z0-9-]+\/buytickets\/([A-Z0-9]+)\/(\d{8})\/?$/i,
  );
  if (url.origin !== "https://in.bookmyshow.com" || !match || url.search || url.hash) {
    throw new Error("CINEMA_URL must be a full HTTPS BookMyShow cinema/date URL");
  }
  const date = (env.TARGET_DATE ?? match[2]!).replaceAll("-", "");
  if (!isRealDateCode(date) || date !== match[2])
    throw new Error("TARGET_DATE must be valid and match CINEMA_URL");
  const seconds = Number(env.POLL_INTERVAL_SEC ?? 60);
  if (!Number.isFinite(seconds) || seconds < 60)
    throw new Error("POLL_INTERVAL_SEC must be at least 60");
  const movie = env.MOVIE?.trim() || "Avengers: Doomsday";
  const language = env.LANGUAGE?.trim() || "English";
  const format = env.FORMAT?.trim() || "DOLBY CINEMA 3D";
  const key = createHash("sha256")
    .update([url.href, movieName(movie), normal(language), normal(format)].join("|"))
    .digest("hex");
  return {
    url: url.href,
    date,
    venueCode: match[1]!.toUpperCase(),
    movie,
    language,
    format,
    intervalMs: seconds * 1000,
    key,
  };
}

export function parseCinemaPage(html: string, config: MonitorConfig): CinemaResult {
  const raw = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error("BookMyShow data missing: page blocked or changed");
  const state = object(JSON.parse(raw.trim().replace(/;\s*$/, "")));
  const queries = object(object(state.venueShowtimesFunctionalApi).queries);
  const data = Object.values(queries)
    .map((query) => object(object(query).data))
    .find((item) => item.showDetailsTransformed);
  if (!data) throw new Error("BookMyShow cinema schema changed: no transformed show data");
  const transformed = object(data.showDetailsTransformed);
  const venue = object(transformed.Venues);
  const code = String(venue.VenueCode ?? "");
  const venueName = String(venue.VenueName ?? "");
  if (code && normal(code) !== config.venueCode)
    throw new Error("BookMyShow returned a different cinema");
  // Some venue payloads omit VenueCode. Require the exact venue name in that case.
  if (!code && normal(venueName) !== normal("ALLU Cinemas: Kokapet")) {
    throw new Error("Cannot verify the requested cinema");
  }
  if (!transformed.Date || !Array.isArray(transformed.Event))
    throw new Error("Incomplete cinema data");
  const result: CinemaResult = {
    servedDate: String(transformed.Date),
    venue: venueName,
    shows: [],
    otherFormats: [],
  };
  if (result.servedDate !== config.date) return result;
  const other = new Set<string>();
  const ids = new Set<string>();
  for (const value of transformed.Event) {
    const event = object(value);
    if (movieName(event.EventTitle) !== movieName(config.movie)) continue;
    for (const childValue of list(event.ChildEvents)) {
      const child = object(childValue);
      if (
        normal(child.EventLanguage) !== normal(config.language) ||
        normal(child.EventDimension) !== normal(config.format)
      ) {
        other.add(`${child.EventLanguage ?? "Unknown"} ${child.EventDimension ?? "Unknown"}`);
        continue;
      }
      for (const showValue of list(child.ShowTimes)) {
        const show = object(showValue);
        if (String(show.availStatus ?? show.AvailStatus ?? "") === "0") continue;
        const id = String(show.SessionId ?? "");
        const time = String(show.ShowTime ?? "");
        if (!id || !time) throw new Error("Matching show is missing its session ID or time");
        if (ids.has(id)) continue;
        ids.add(id);
        result.shows.push({ id, time, screen: String(show.ScreenName ?? "") });
      }
    }
  }
  result.otherFormats = [...other];
  return result;
}
