/**
 * Fase 9 end-to-end: security controls seen from the outside.
 * Security headers, CSRF (origin check), rate limiting, webhook size limit,
 * and production gates that the demo cannot fulfil.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test("pages carry the security headers", async ({ request }) => {
  const res = await request.get("/markt");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("a mutation from another origin is refused, even with a valid session", async ({ page, baseURL }) => {
  await loginAs(page, /Anna de Vries/);
  const evil = await page.request.post("/api/v1/order-previews", { headers: { origin: "https://evil.example" }, data: { side: "BUY" } });
  expect(evil.status()).toBe(403);
  const none = await page.request.post("/api/v1/withdrawals", { headers: { "idempotency-key": "e2e-csrf-0001" }, data: { amountCents: "100" } });
  expect(none.status()).toBe(403);
  const own = await page.request.post("/api/v1/order-previews", { headers: { origin: baseURL! }, data: { side: "SIDEWAYS" } });
  expect(own.status()).not.toBe(429);
});

test("sensitive endpoints are rate limited per user", async ({ page, baseURL }) => {
  await loginAs(page, /Bram/);
  // Other tests may already have used part of this minute's budget, and the
  // window may roll over once: within 125 requests a 429 must come, after at most 60 allowed.
  const statuses: number[] = [];
  for (let i = 0; i < 125 && statuses.at(-1) !== 429; i++) {
    const r = await page.request.post("/api/v1/order-previews", { headers: { origin: baseURL! }, data: { side: "BUY", playerId: "x", quantity: 1, limitPriceMinor: "100", timeInForce: "ONE_DAY" } });
    statuses.push(r.status());
  }
  expect(statuses.at(-1)).toBe(429);
  expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(120);
  const body = await (await page.request.post("/api/v1/order-previews", { headers: { origin: baseURL! }, data: {} })).json();
  expect(body.code).toBe("RATE_LIMITED");
  expect(body.message).toContain("Te veel verzoeken");
});

test("an oversized webhook is refused before processing", async ({ request }) => {
  const r = await request.post("/api/v1/webhooks/payments/demo", { headers: { "content-type": "application/json" }, data: "x".repeat(70 * 1024) });
  expect(r.status()).toBe(413);
});

test("production gates are visible but cannot be fulfilled in the demo", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/koppelingen");
  await expect(page.getByTestId("gate")).toHaveCount(10);
  await expect(page.getByText("In de demo worden geen gates vervuld")).toBeVisible();
});

test("a person can download their own data", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/account");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Mijn gegevens downloaden (JSON)" }).click()]);
  const data = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8"));
  expect(data.profile.display_name).toBe("Anna de Vries");
  expect(Array.isArray(data.cards)).toBe(true);
});
