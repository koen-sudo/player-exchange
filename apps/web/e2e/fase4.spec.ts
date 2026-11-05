/**
 * Fase 4 end-to-end checks: deposits through the demo checkout and the
 * simulated provider's webhooks (delivered by the worker over HTTP),
 * withdrawals, and the finance screen. Needs web + worker against a
 * migrated, seeded database.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

const main = (page: Page) => page.getByRole("main");
const available = (page: Page) => main(page).locator("div", { has: page.getByText("Beschikbaar saldo", { exact: true }) }).locator(".num").first();
const euros = (text: string) => Number(text.replace(/[^\d,]/g, "").replace(",", "."));

test.describe.configure({ mode: "serial" });

test("returning from the checkout without paying books nothing (AT-11)", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/betalingen");
  const before = euros(await available(page).innerText());
  await page.getByLabel("Bedrag").first().fill("40");
  await page.getByRole("button", { name: "Verder naar betalen" }).click();
  await page.waitForURL(/\/demo-betaalpagina/);
  await expect(page.getByText("DEMO · GEEN ECHT GELD")).toBeVisible();
  await expect(page.getByText(/€\s?40,00/)).toBeVisible();
  await page.getByRole("link", { name: /Terug naar Player Exchange zonder te betalen/ }).click();
  await page.waitForURL(/\/betalingen\?storting=/);
  await expect(page.getByRole("status")).toContainText("nog geen bevestiging van de betaalpartner");
  expect(euros(await available(page).innerText())).toBe(before);
  // The payment can still be completed later from the history.
  await expect(page.getByRole("link", { name: "Verder betalen" }).first()).toBeVisible();
});

test("a paid deposit becomes available only after the provider's webhook", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/betalingen");
  const before = euros(await available(page).innerText());
  await page.getByLabel("Bedrag").first().fill("25,50");
  await page.getByRole("button", { name: "Verder naar betalen" }).click();
  await page.waitForURL(/\/demo-betaalpagina/);
  await page.getByRole("button", { name: /Gelukt, bevestiging komt dubbel/ }).click();
  await page.waitForURL(/\/betalingen\?storting=/);
  // The worker delivers the (duplicate) webhooks within seconds; the page refreshes itself.
  await expect(page.getByRole("status")).toContainText("bevestigd door de betaalpartner", { timeout: 20_000 });
  await expect.poll(async () => euros(await available(page).innerText()), { timeout: 10_000 }).toBeCloseTo(before + 25.5, 2);
  // Exactly once, even though the confirmation came in more than once (AT-10).
  await page.waitForTimeout(4_000);
  await page.reload();
  expect(euros(await available(page).innerText())).toBeCloseTo(before + 25.5, 2);
});

test("a failed payment is reported and books nothing", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/betalingen");
  const before = euros(await available(page).innerText());
  await page.getByLabel("Bedrag").first().fill("15");
  await page.getByRole("button", { name: "Verder naar betalen" }).click();
  await page.waitForURL(/\/demo-betaalpagina/);
  await page.getByRole("button", { name: /Betaling mislukt/ }).click();
  await expect(page.getByRole("status")).toContainText("niet gelukt", { timeout: 20_000 });
  expect(euros(await available(page).innerText())).toBe(before);
});

test("withdrawal: paid, refused, and never more than available", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/betalingen");
  const before = euros(await available(page).innerText());
  await page.getByLabel("Bedrag").nth(1).fill("10");
  await page.getByRole("button", { name: "Opname aanvragen" }).click();
  await expect(page.getByRole("status")).toContainText("Opname uitbetaald");
  expect(euros(await available(page).innerText())).toBeCloseTo(before - 10, 2);

  await page.getByLabel("Bedrag").nth(1).fill("5");
  await page.getByLabel("Demo: antwoord van de betaalpartner").selectOption("FAIL");
  await page.getByRole("button", { name: "Opname aanvragen" }).click();
  await expect(page.getByRole("status")).toContainText("geweigerd");
  expect(euros(await available(page).innerText())).toBeCloseTo(before - 10, 2);

  await page.getByLabel("Bedrag").nth(1).fill("99999");
  await page.getByRole("button", { name: "Opname aanvragen" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /bedrag|saldo/ })).toBeVisible();
});

test("unverified users cannot deposit and see why", async ({ page }) => {
  await loginAs(page, /Bram/);
  await page.goto("/betalingen");
  await expect(page.getByRole("button", { name: "Verder naar betalen" })).toBeDisabled();
  await expect(main(page).getByText("Rond eerst je verificatie af.").first()).toBeVisible();
});

test("finance screen: ledger, invariants and a manual reconciliation that matches", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/betalingen");
  await expect(page.getByText("Alle 4 in orde")).toBeVisible();
  await page.getByRole("button", { name: "Reconciliatie nu uitvoeren" }).click();
  await expect(page.getByRole("status")).toContainText("Reconciliatie afgerond");
  await expect(page.getByText("Sluit aan")).toBeVisible();
});
