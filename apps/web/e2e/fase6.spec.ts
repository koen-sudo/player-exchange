/**
 * Fase 6 end-to-end: a drop goes from concept to delivery. Four-eyes
 * publication, subscription with reservation, closing with a verifiable
 * drawing, settlement and delivery. Uses the demo-only schedule buttons so
 * the test does not wait until Tuesday. Needs web + worker on a seeded DB.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test.describe.configure({ mode: "serial" });

test("a drop is published with four eyes, subscribed to, drawn and delivered", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await loginAs(admin, /Sanne/);
  await admin.goto("/beheer/uitgiftes");
  const value = await admin.locator("select[name=playerId] option", { hasText: "Mateo Ruiz" }).first().getAttribute("value");
  await admin.locator("select[name=playerId]").selectOption(value!);
  await admin.getByLabel("Prijs per kaart (€)").fill("7,50");
  await admin.getByLabel("Aantal kaarten").fill("2");
  await admin.getByLabel("Reden voor de goedkeurder").fill("E2E: wekelijkse uitgifte");
  await admin.getByRole("button", { name: "Concept vastleggen en goedkeuring aanvragen" }).click();
  await expect(admin.getByRole("status")).toContainText("goedkeuring aangevraagd");
  const item = admin.getByTestId("admin-drop").filter({ hasText: "Mateo Ruiz" }).filter({ hasText: "Concept" }).first();
  await expect(item).toContainText("Wacht op goedkeuring");

  const approver = await (await browser.newContext()).newPage();
  await loginAs(approver, /Joris/);
  await approver.goto("/beheer/goedkeuringen");
  const req = approver.locator("li", { hasText: "Uitgifte (drop) publiceren" }).filter({ hasText: "Mateo Ruiz" }).first();
  await req.getByPlaceholder("Toelichting bij je besluit").fill("Prijs en aantal gecontroleerd");
  await req.getByRole("button", { name: "Goedkeuren" }).click();
  await expect(approver.getByRole("status")).toContainText("Goedgekeurd");

  await admin.reload();
  await item.getByRole("button", { name: "Publiceren" }).click();
  await expect(admin.getByRole("status")).toContainText("Uitgifte gepubliceerd");
  const published = admin.getByTestId("admin-drop").filter({ hasText: "Mateo Ruiz" }).filter({ hasText: "Gepubliceerd" });
  await published.first().getByRole("button", { name: "Demo: inschrijving nu openen" }).click();
  await expect(admin.getByRole("status")).toContainText("Demo: inschrijving geopend");

  const anna = await (await browser.newContext()).newPage();
  await loginAs(anna, /Anna de Vries/);
  await anna.goto("/uitgiftes?tab=open");
  await anna.getByRole("link", { name: /Mateo Ruiz/ }).last().click();
  await anna.getByRole("button", { name: "Inschrijven" }).click();
  const dialog = anna.getByRole("dialog");
  await dialog.getByRole("button", { name: "Controleren" }).click();
  await expect(dialog).toContainText("€ 7,50");
  await dialog.getByRole("button", { name: "Bedrag reserveren en inschrijven" }).click();
  await expect(dialog.getByRole("status")).toContainText("Je bent ingeschreven");
  await dialog.getByRole("button", { name: "Sluiten" }).click();
  await expect(anna.getByTestId("my-subscription")).toContainText("Ingeschreven, wacht op toewijzing");

  const open = admin.getByTestId("admin-drop").filter({ hasText: "Mateo Ruiz" }).filter({ hasText: "Inschrijving open" });
  await open.first().getByRole("button", { name: "Demo: nu sluiten en toewijzen" }).click();
  await expect(admin.getByRole("status")).toContainText("de trekking en afwikkeling zijn uitgevoerd");
  await expect(admin.getByTestId("admin-drop").filter({ hasText: "Mateo Ruiz" }).filter({ hasText: "Afgerond" }).first()).toContainText("geleverd 1");

  await anna.goto("/uitgiftes?tab=mijn");
  // The demo history also has an older Mateo Ruiz drop; the newest is listed last.
  await anna.getByRole("link", { name: /Mateo Ruiz/ }).last().click();
  await expect(anna.getByTestId("my-subscription")).toContainText("Kaart geleverd");
  await anna.getByText("Controleerbare trekking").click();
  await expect(anna.getByText("Seed (na de trekking vrijgegeven)")).toBeVisible();
});

test("notifications show the outcomes and can be marked as read", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await expect(page.getByRole("link", { name: /Meldingen, \d+ ongelezen/ })).toBeVisible();
  await page.goto("/meldingen");
  await expect(page.getByRole("link", { name: /Kaart uit een uitgifte geleverd/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Alles gelezen" }).click();
  await expect(page.getByRole("link", { name: "Meldingen", exact: true })).toBeVisible();
});
