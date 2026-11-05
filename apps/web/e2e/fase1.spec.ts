/**
 * Fase 1 end-to-end checks (AT-01, AT-05, AT-36 and the screen states).
 * Run with the demo app running: pnpm --filter @px/web test:e2e
 */
import { expect, test, type Page } from "@playwright/test";

const widths = [390, 768, 1440];

/** Sign in with a demo account and wait until the redirect has completed. */
async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test.describe("markt", () => {
  test("alle zes competities zijn filterbaar (AT-01)", async ({ page }) => {
    await page.goto("/markt");
    const options = page.getByLabel("Competitie").locator("option");
    await expect(options).toHaveCount(7); // "Alle competities" + 6
    for (const name of ["Premier League", "LaLiga", "Bundesliga", "Ligue 1", "Eredivisie", "Pro League"]) {
      await expect(page.getByLabel("Competitie")).toContainText(name);
    }
  });

  test("filters blijven in de URL na terugnavigeren", async ({ page }) => {
    await page.goto("/markt?status=TRADABLE&rol=WINGER");
    await page.getByRole("link", { name: "Uitgiftes", exact: true }).first().click();
    await page.waitForURL(/\/uitgiftes/);
    await page.goBack();
    await expect(page).toHaveURL(/status=TRADABLE/);
    // Next.js keeps the previous route mounted but hidden; check the visible main content only.
    await expect(page.getByRole("main").getByLabel("Positie")).toHaveValue("WINGER");
  });

  test("profiel zonder kaarten toont geen verzonnen prijs (AT-05)", async ({ page }) => {
    await page.goto("/markt?status=PROFILE_ONLY");
    await expect(page.getByText("€ 0,00")).toHaveCount(0);
  });
});

test.describe("WF-02: ordercontrole vóór plaatsing", () => {
  test("paneel heet 'Controleer kooporder'; alleen het controlevenster plaatst", async ({ page }) => {
    await loginAs(page, /Anna de Vries/);
    await page.goto("/markt?q=Noah%20Vermeer");
    await page.getByRole("link", { name: /Noah Vermeer/ }).first().click();
    await expect(page.getByRole("button", { name: "Kooporder plaatsen" })).toBeHidden();
    await page.getByRole("button", { name: "Controleer kooporder" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Maximaal te reserveren")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Kooporder plaatsen" })).toBeVisible();
  });
});

test.describe("WF-01: spelers en kaarten apart geteld", () => {
  for (const width of widths) {
    test(`portefeuille toont '3 spelers · 6 kaarten' op ${width}px (AT-36)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await loginAs(page, /Anna de Vries/);
      await expect(page.getByText("3 spelers · 6 kaarten")).toBeVisible();
    });
  }
});

test("niet-toegelaten gebruiker krijgt geen preview via directe API (AT-08)", async ({ page, request }) => {
  await loginAs(page, /Bram Jansen/);
  const res = await page.request.post("/api/v1/order-previews", {
    headers: { origin: new URL(page.url()).origin },
    data: { side: "BUY", playerId: "x", quantity: 1, limitPriceMinor: "620", timeInForce: "ONE_DAY" },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe("VERIFICATION_REQUIRED");
  const anon = await request.post("/api/v1/order-previews", { data: {} });
  expect(anon.status()).toBe(403);
});
