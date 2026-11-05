/**
 * Fase 1 end-to-end checks (AT-01, AT-05, AT-36 and the screen states).
 * Run with the demo app running: pnpm --filter @px/web test:e2e
 */
import { expect, test } from "@playwright/test";

const widths = [390, 768, 1440];

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
    await page.getByRole("link", { name: /Volgende/ }).click().catch(() => {});
    await page.goBack();
    await expect(page).toHaveURL(/status=TRADABLE/);
    await expect(page.getByLabel("Positie")).toHaveValue("WINGER");
  });

  test("profiel zonder kaarten toont geen verzonnen prijs (AT-05)", async ({ page }) => {
    await page.goto("/markt?status=PROFILE_ONLY");
    await expect(page.getByText("€ 0,00")).toHaveCount(0);
  });
});

test.describe("WF-02: ordercontrole vóór plaatsing", () => {
  test("paneel heet 'Controleer kooporder'; alleen het controlevenster plaatst", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Anna de Vries/ }).click();
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
      await page.goto("/login");
      await page.getByRole("button", { name: /Anna de Vries/ }).click();
      await page.goto("/portefeuille");
      await expect(page.getByText("3 spelers · 6 kaarten")).toBeVisible();
    });
  }
});

test("niet-toegelaten gebruiker krijgt geen preview via directe API (AT-08)", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Bram Jansen/ }).click();
  const res = await page.request.post("/api/v1/order-previews", {
    headers: { origin: new URL(page.url()).origin },
    data: { side: "BUY", playerId: "x", quantity: 1, limitPriceMinor: "620", timeInForce: "ONE_DAY" },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe("VERIFICATION_REQUIRED");
  const anon = await request.post("/api/v1/order-previews", { data: {} });
  expect(anon.status()).toBe(403);
});
