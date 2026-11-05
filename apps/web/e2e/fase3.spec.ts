/**
 * Fase 3 end-to-end checks: portfolio from actual card holdings, four-eyes
 * programme publication, player admission and market status.
 * Needs web + worker against a migrated, seeded database.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test.describe.configure({ mode: "serial" });

test("portfolio follows the cards Anna actually holds, including the reserved one", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await expect(page.getByText("3 spelers · 6 kaarten")).toBeVisible();
  const lucas = page.locator("tr", { hasText: "Lucas Moreau" });
  // In bezit 2, vrij te verkopen 1, gereserveerd 1 (her open sell order)
  await expect(lucas.locator("td").nth(1)).toHaveText("2");
  await expect(lucas.locator("td").nth(2)).toHaveText("1");
  await expect(lucas.locator("td").nth(3)).toHaveText("1");
});

test("programme publication needs a second person (four-eyes) and is audited", async ({ page, browser }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/voorraad?q=Noah%20Vermeer");
  await page.getByRole("link", { name: "Noah Vermeer" }).click();
  await page.getByLabel("Seizoen").selectOption({ index: 1 });
  await page.getByLabel("Aantal kaarten (max. 500)").fill("300");
  await page.locator("form", { hasText: "Concept maken" }).getByLabel("Reden").fill("Programma volgend seizoen");
  await page.getByRole("button", { name: "Concept maken" }).click();
  await expect(page.getByRole("status")).toContainText("Concept aangemaakt");
  await page.getByPlaceholder("Toelichting voor de goedkeurder").fill("Graag akkoord voor 300 kaarten");
  await page.getByRole("button", { name: "Goedkeuring aanvragen" }).click();
  await expect(page.getByRole("status")).toContainText("Goedkeuring aangevraagd");

  await page.goto("/beheer/goedkeuringen");
  await expect(page.getByText("Je eigen verzoek; een andere bevoegde persoon moet beslissen.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Goedkeuren" })).toHaveCount(0);

  const ctx = await browser.newContext();
  const joris = await ctx.newPage();
  await loginAs(joris, /Joris/);
  await joris.goto("/beheer/goedkeuringen");
  await joris.getByPlaceholder("Toelichting bij je besluit").first().fill("Gecontroleerd, akkoord");
  await joris.getByRole("button", { name: "Goedkeuren" }).first().click();
  await expect(joris.getByRole("status")).toContainText("Goedgekeurd");
  await ctx.close();

  await page.goto("/beheer/voorraad?q=Noah%20Vermeer");
  await page.getByRole("link", { name: "Noah Vermeer" }).click();
  await page.getByRole("button", { name: "Publiceren" }).click();
  await expect(page.getByRole("status")).toContainText("Programma gepubliceerd");
  await expect(page.getByText("Gepubliceerd").first()).toBeVisible();

  await page.goto("/beheer/audit");
  for (const label of ["Uitgifteprogramma (concept) gemaakt", "Goedkeuring aangevraagd", "Goedkeuring verleend", "Uitgifteprogramma gepubliceerd"]) {
    await expect(page.getByText(label).first()).toBeVisible();
  }
});

test("admission refuses a minor with the reason; a market pause closes trading on the player page", async ({ page, browser }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/spelers?q=van");
  await page.goto("/beheer/spelers?toelating=INELIGIBLE");
  const minorCard = page.locator("section", { hasText: "minderjarig" }).first();
  await expect(minorCard).toBeVisible();
  await minorCard.locator("form", { has: page.getByLabel("Toelating") }).getByLabel("Toelating").selectOption("APPROVED");
  await minorCard.locator("form", { has: page.getByLabel("Toelating") }).getByLabel("Reden").fill("Poging tot toelating");
  await minorCard.locator("form", { has: page.getByLabel("Toelating") }).getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "minderjarig" })).toBeVisible();

  await page.goto("/beheer/spelers?q=Mateo%20Ruiz");
  const mateo = page.locator("section", { hasText: "Mateo Ruiz" }).first();
  const marketForm = mateo.locator("form", { has: page.getByLabel("Marktstatus") });
  await marketForm.getByLabel("Marktstatus").selectOption("PAUSED");
  await marketForm.getByLabel("Reden").fill("Juridische blokkade in onderzoek");
  await marketForm.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Marktstatus gewijzigd");

  const ctx = await browser.newContext();
  const anna = await ctx.newPage();
  await loginAs(anna, /Anna de Vries/);
  await anna.goto("/markt?q=Mateo%20Ruiz");
  await anna.getByRole("link", { name: /Mateo Ruiz/ }).first().click();
  await anna.goto(anna.url().replace(/.*speler=/, "/spelers/"));
  await expect(anna.getByRole("button", { name: "Controleer kooporder" })).toHaveCount(0);
  await expect(anna.getByText("Gepauzeerd").first()).toBeVisible();
  await ctx.close();

  await page.goto("/beheer/spelers?q=Mateo%20Ruiz");
  const again = page.locator("section", { hasText: "Mateo Ruiz" }).first().locator("form", { has: page.getByLabel("Marktstatus") });
  await again.getByLabel("Marktstatus").selectOption("OPEN");
  await again.getByLabel("Reden").fill("Onderzoek afgerond");
  await again.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByRole("status")).toContainText("Marktstatus gewijzigd");
});
