/**
 * Fase 5 end-to-end checks: placing orders that match the demo book, settlement
 * through the payment simulator, cancelling the free remainder, and the admin
 * view. Needs web + worker against a migrated, seeded database.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

async function openPlayer(page: Page, name: string) {
  const res = await (await page.request.get(`/api/v1/players?q=${encodeURIComponent(name)}`)).json();
  await page.goto(`/spelers/${res.data.items[0].id}`);
}

test.describe.configure({ mode: "serial" });

test("a buy order at the best ask is executed and settled at once; the card is in the portfolio", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await expect(page.getByText("3 spelers · 6 kaarten")).toBeVisible();
  await openPlayer(page, "Noah Vermeer");
  await page.getByRole("button", { name: "Controleer kooporder" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Maximaal te reserveren")).toBeVisible();
  await dialog.getByRole("button", { name: "Kooporder plaatsen" }).click();
  await expect(dialog.getByRole("status")).toContainText("1 kaart is direct gekocht en afgewikkeld");
  await expect(dialog.getByRole("button", { name: "Kooporder plaatsen" })).toBeDisabled();
  await page.goto("/portefeuille");
  await expect(page.getByText("3 spelers · 7 kaarten")).toBeVisible();
  await page.goto("/transacties");
  await expect(page.getByTestId("trade-row").filter({ hasText: "Aankoop" }).first()).toContainText("Afgewikkeld");
});

test("a sell order against the best bid pays out minus 5% commission", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await openPlayer(page, "Lucas Moreau");
  await page.getByRole("main").getByRole("tab", { name: "Verkopen" }).first().click();
  await page.getByRole("button", { name: "Controleer verkooporder" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Commissie (5%)")).toBeVisible();
  await dialog.getByRole("button", { name: "Verkooporder plaatsen" }).click();
  await expect(dialog.getByRole("status")).toContainText("1 kaart is direct verkocht en afgewikkeld");
  await page.goto("/transacties");
  const row = page.getByTestId("trade-row").filter({ hasText: "Verkoop" }).first();
  await expect(row).toContainText(/€\s?3,10/);
  await expect(row).toContainText(/€\s?0,16/);
});

test("cancelling releases the free remainder of an open buy order", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/betalingen");
  await expect(page.getByRole("main").getByText("Reserveringen", { exact: true }).locator("xpath=..").locator(".num")).toContainText(/12,40/);
  await page.goto("/transacties");
  await page.getByRole("button", { name: /2 open kaarten van Noah Vermeer annuleren/ }).click();
  await expect(page.getByRole("status")).toContainText("2 kaarten geannuleerd");
  await expect(page.getByRole("button", { name: /open kaarten van Noah Vermeer annuleren/ })).toHaveCount(0);
  await page.goto("/betalingen");
  await expect(page.getByRole("main").getByText("Reserveringen", { exact: true }).locator("xpath=..").locator(".num")).toContainText(/0,00/);
});

test("orders API: the same idempotency key places one order; a used preview cannot be reused", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  const origin = new URL(page.url()).origin;
  const players = await (await page.request.get("/api/v1/players?q=Mateo%20Ruiz")).json();
  const playerId = players.data.items[0].id;
  const preview = await page.request.post("/api/v1/order-previews", {
    headers: { origin },
    data: { side: "BUY", playerId, quantity: 1, limitPriceMinor: "300", timeInForce: "ONE_DAY" },
  });
  expect(preview.status()).toBe(200);
  const previewId = (await preview.json()).data.previewId;
  const place = () => page.request.post("/api/v1/orders", { headers: { origin, "idempotency-key": `e2e-${previewId}` }, data: { previewId } });
  const [a, b] = [await place(), await place()];
  expect((await a.json()).data.orderId).toBe((await b.json()).data.orderId);
  const reuse = await page.request.post("/api/v1/orders", { headers: { origin, "idempotency-key": `e2e-other-${previewId}` }, data: { previewId } });
  expect(reuse.status()).toBe(409);
  expect((await reuse.json()).code).toBe("PREVIEW_EXPIRED");
  const orderId = (await a.json()).data.orderId;
  const cancel = await page.request.post(`/api/v1/orders/${orderId}/cancel`, { headers: { origin } });
  expect((await cancel.json()).data.cancelled).toBe(1);
});

test("admin sees executions and healthy trading invariants", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/handel");
  await expect(page.getByText("Alle 5 in orde")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Noah Vermeer" }).first()).toBeVisible();
  await page.goto("/beheer/betalingen");
  await page.getByRole("button", { name: "Reconciliatie nu uitvoeren" }).click();
  await expect(page.getByRole("status")).toContainText("sluiten aan");
});
