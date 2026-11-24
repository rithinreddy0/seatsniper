import { expect, test } from "bun:test";
import { deliverFresh, sendTelegram } from "./telegram-delivery.ts";

test("failed delivery does not mark sessions as delivered; later polls retry", async () => {
  const seen = new Set<string>();
  const shows = [{ id: "123", time: "10:00 AM", screen: "Dolby" }];
  await expect(
    deliverFresh(shows, seen, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(seen.size).toBe(0);
  let deliveries = 0;
  await deliverFresh(shows, seen, async () => {
    deliveries++;
  });
  await deliverFresh(shows, seen, async () => {
    deliveries++;
  });
  expect(deliveries).toBe(1);
  expect(seen.has("123")).toBe(true);
});
test("Telegram HTTP 200 with ok:false is a delivery failure", async () => {
  const mockFetch = async () => Response.json({ ok: false });
  await expect(sendTelegram("private-token", "chat", "message", mockFetch)).rejects.toThrow(
    "Telegram delivery failed",
  );
});
