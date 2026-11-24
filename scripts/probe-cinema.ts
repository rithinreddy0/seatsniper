/** Manual one-shot access test. Never sends Telegram messages. */
import { closeBms, fetchCinemaHtml, initBms } from "../src/bms.ts";
import { parseCinemaPage, readMonitorConfig } from "../src/venue-monitor.ts";

const config = readMonitorConfig(process.env);
try {
  await initBms();
  console.log(JSON.stringify(parseCinemaPage(await fetchCinemaHtml(config.url), config), null, 2));
} finally {
  await closeBms();
}
