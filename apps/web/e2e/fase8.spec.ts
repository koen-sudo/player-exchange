/**
 * Fase 8 end-to-end: contract tests as evidence, monitoring with owners, and a
 * ledger correction with four eyes. Needs web + worker on a seeded database.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test("contract tests run against the configured adapters and are kept as evidence", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/koppelingen");
  await expect(page.getByText(/Capabilityrapport betalen/)).toBeVisible();
  await page.getByRole("button", { name: "Contracttests uitvoeren" }).click();
  await expect(page.getByRole("status")).toContainText(/0 mislukt, 0 geblokkeerd/);
  await expect(page.getByTestId("contract-run")).toHaveCount(2);
});

test("monitoring shows every signal with an owner", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/bewaking");
  await expect(page.getByTestId("signal")).toHaveCount(10);
  await expect(page.getByTestId("signal").filter({ hasText: "Dekking van reserveringen" })).toContainText("In orde");
});

test("a ledger correction needs a second person and is booked once", async ({ browser }) => {
  const sanne = await (await browser.newContext()).newPage();
  await loginAs(sanne, /Sanne/);
  await sanne.goto("/beheer/betalingen");
  const value = await sanne.locator("select[name=userId] option", { hasText: "Anna de Vries" }).first().getAttribute("value");
  await sanne.locator("select[name=userId]").selectOption(value!);
  await sanne.getByLabel("Bedrag (€)").fill("2,50");
  await sanne.getByLabel("Reden").fill("E2E: dubbel afgeschreven");
  await sanne.getByRole("button", { name: "Correctie aanvragen" }).click();
  await expect(sanne.getByRole("status")).toContainText("Correctie aangevraagd");
  await expect(sanne.getByTestId("correction")).toHaveCount(0);

  const joris = await (await browser.newContext()).newPage();
  await loginAs(joris, /Joris/);
  await joris.goto("/beheer/goedkeuringen");
  const req = joris.locator("li", { hasText: "E2E: dubbel afgeschreven" }).first();
  await req.getByPlaceholder("Toelichting bij je besluit").fill("Afschrift gecontroleerd");
  await req.getByRole("button", { name: "Goedkeuren" }).click();
  await expect(joris.getByRole("status")).toContainText("Goedgekeurd");

  await sanne.goto("/beheer/betalingen");
  await sanne.getByTestId("correction").first().getByRole("button", { name: "Boeken" }).click();
  await expect(sanne.getByRole("status")).toContainText("Correctie geboekt");
  await expect(sanne.getByTestId("correction")).toHaveCount(0);
});
