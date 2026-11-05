/**
 * Fase 7 end-to-end: a valuation run is computed, reviewed by a second person
 * and published. A draft or approved run is never public (AT-29); open orders
 * keep their limit (AT-28). Needs web + worker on a seeded database.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test("a valuation run becomes public only after review and publication", async ({ browser, request }) => {
  const noah = (await (await request.get("/api/v1/players?q=Noah%20Vermeer")).json()).data.items[0];
  const publicValue = async () => (await (await request.get(`/api/v1/players/${noah.id}`)).json()).data.reference.amountMinor as string;
  const before = await publicValue();

  const admin = await (await browser.newContext()).newPage();
  await loginAs(admin, /Sanne/);
  await admin.goto("/beheer/waardering");
  await admin.getByRole("button", { name: "Conceptrun berekenen" }).click();
  await expect(admin.getByRole("status")).toContainText("Conceptrun berekend");
  await expect(admin.getByText("Je eigen run; een tweede persoon moet hem beoordelen.")).toBeVisible();
  expect(await publicValue()).toBe(before);

  const approver = await (await browser.newContext()).newPage();
  await loginAs(approver, /Joris/);
  await approver.goto("/beheer/waardering");
  await approver.getByLabel("Toelichting bij je beoordeling").fill("Steekproef van tien spelers gecontroleerd");
  await approver.getByRole("button", { name: "Goedkeuren" }).click();
  await expect(approver.getByRole("status")).toContainText("Run goedgekeurd");
  expect(await publicValue()).toBe(before);

  await admin.goto("/beheer/waardering");
  await admin.getByRole("button", { name: "Demo: nu publiceren" }).click();
  await expect(admin.getByRole("status")).toContainText("Run gepubliceerd");
  await expect(admin.getByTestId("valuation-run").first()).toContainText("Gepubliceerd");

  // Noah's new value comes from the demo model; Anna's own open orders keep their limits.
  const after = await publicValue();
  expect(Number(after)).toBeGreaterThan(0);
  const anna = await (await browser.newContext()).newPage();
  await loginAs(anna, /Anna de Vries/);
  await anna.goto("/transacties");
  await expect(anna.getByRole("main")).toContainText(/€\s?3,55/);
});
