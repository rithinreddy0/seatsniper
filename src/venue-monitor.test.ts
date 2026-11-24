import { expect, test } from "bun:test";
import { parseCinemaPage, readMonitorConfig } from "./venue-monitor.ts";

const config = readMonitorConfig({
  CINEMA_URL:
    "https://in.bookmyshow.com/cinemas/hyderabad/allu-cinemas-kokapet/buytickets/ALUC/20261217",
  TARGET_DATE: "2026-12-17",
  MOVIE: "Avengers: Doomsday",
  LANGUAGE: "English",
  FORMAT: "DOLBY CINEMA 3D",
});
function page(
  options: {
    date?: string;
    format?: string;
    language?: string;
    venue?: string;
    movie?: string;
  } = {},
) {
  const transformed = {
    Date: options.date ?? "20261217",
    Venues: { VenueCode: options.venue ?? "ALUC", VenueName: "ALLU Cinemas: Kokapet" },
    Event: [
      {
        EventTitle: options.movie ?? "Avengers: Doomsday",
        ChildEvents: [
          {
            EventLanguage: options.language ?? "English",
            EventDimension: options.format ?? "DOLBY CINEMA 3D",
            ShowTimes: [{ SessionId: "123", ShowTime: "10:00 AM" }],
          },
        ],
      },
    ],
  };
  return `<script>window.__INITIAL_STATE__ = ${JSON.stringify({ venueShowtimesFunctionalApi: { queries: { test: { data: { showDetailsTransformed: transformed } } } } })};</script>`;
}
test("only the exact movie, language, venue, date, and Dolby Cinema 3D match", () => {
  expect(parseCinemaPage(page(), config).shows).toHaveLength(1);
  for (const format of ["DOLBY ATMOS", "DOLBY CINEMA 2D", "MS-Infinity Vsn 3d", "English 3D"]) {
    expect(parseCinemaPage(page({ format }), config).shows).toHaveLength(0);
  }
  expect(parseCinemaPage(page({ language: "Hindi" }), config).shows).toHaveLength(0);
  expect(parseCinemaPage(page({ movie: "Other Movie" }), config).shows).toHaveLength(0);
  expect(parseCinemaPage(page({ date: "20261124" }), config).shows).toHaveLength(0);
  expect(() => parseCinemaPage(page({ venue: "OTHER" }), config)).toThrow();
});
test("blocked and changed pages throw rather than masquerading as unavailable", () => {
  expect(() => parseCinemaPage("<title>Challenge</title>", config)).toThrow();
  expect(() =>
    parseCinemaPage("<script>window.__INITIAL_STATE__ = {};</script>", config),
  ).toThrow();
});
test("configuration rejects non-BookMyShow URLs, invalid dates, and sub-minute intervals", () => {
  expect(() => readMonitorConfig({ CINEMA_URL: "https://example.com/" })).toThrow();
  expect(() => readMonitorConfig({ CINEMA_URL: config.url, TARGET_DATE: "2026-02-30" })).toThrow();
  expect(() => readMonitorConfig({ CINEMA_URL: config.url, POLL_INTERVAL_SEC: "50" })).toThrow();
});
