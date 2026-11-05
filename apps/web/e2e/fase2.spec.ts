/**
 * Fase 2 end-to-end checks: catalogue API from the database, identity and
 * admission, admin import and restrictions with audit. Needs the demo web app
 * AND the worker running against a migrated, seeded database.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(/\/portefeuille/);
}

test.describe.configure({ mode: "serial" });

test("catalogue API: six competitions and cursor pagination over all players, without birth dates", async ({ request }) => {
  const comps = await (await request.get("/api/v1/competitions")).json();
  expect(comps.data).toHaveLength(6);
  let cursor: string | null = null;
  const ids = new Set<string>();
  do {
    const url: string = `/api/v1/players?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await request.get(url);
    const body = await res.json();
    for (const p of body.data.items) ids.add(p.id);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("birth");
    cursor = body.data.nextCursor;
  } while (cursor);
  expect(ids.size).toBeGreaterThanOrEqual(240);
});

test("/api/v1/me requires a session and only describes the signed-in user", async ({ page, request }) => {
  expect((await request.get("/api/v1/me")).status()).toBe(401);
  await loginAs(page, /Anna de Vries/);
  const me = await (await page.request.get("/api/v1/me")).json();
  expect(me.data.displayName).toBe("Anna de Vries");
  expect(me.data.allowedActions.TRADE.allowed).toBe(true);
});

test("a trader cannot open the admin area", async ({ page }) => {
  await loginAs(page, /Anna de Vries/);
  await page.goto("/beheer/gebruikers");
  await expect(page.getByRole("heading", { name: "Onvoldoende rechten" })).toBeVisible();
});

test("an approver without catalogue rights is refused on the catalogue page", async ({ page }) => {
  await loginAs(page, /Joris/);
  await page.goto("/beheer/catalogus");
  await expect(page.getByRole("heading", { name: "Onvoldoende rechten" })).toBeVisible();
});

test("admin queues a catalogue import; the worker completes it", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/catalogus");
  await page.getByPlaceholder(/selecties na transferperiode/).fill("End-to-end test van de import");
  await page.getByRole("button", { name: "Import starten" }).click();
  await expect(page.getByRole("status")).toContainText(/Import ingepland|loopt al een import/);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Voltooid").first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 45_000 });
  await page.goto("/beheer/audit");
  await expect(page.getByText("Catalogusimport ingepland").first()).toBeVisible();
});

test("a trading stop blocks Anna's orders but not cancelling, and both changes are audited", async ({ page, browser }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/gebruikers");
  const anna = page.locator("section", { hasText: "Anna de Vries" });
  await anna.getByLabel("Beperking").selectOption("TRADING_STOP");
  await anna.getByLabel("Reden (verplicht)").fill("End-to-end test: tijdelijke handelsstop");
  await anna.getByRole("button", { name: "Instellen" }).click();
  await expect(page.getByRole("status")).toContainText("Beperking ingesteld");

  const ctx = await browser.newContext();
  const ap = await ctx.newPage();
  await loginAs(ap, /Anna de Vries/);
  const me = await (await ap.request.get("/api/v1/me")).json();
  expect(me.data.allowedActions.TRADE.allowed).toBe(false);
  expect(me.data.allowedActions.CANCEL_ORDER.allowed).toBe(true);
  expect(me.data.allowedActions.WITHDRAW.allowed).toBe(true);
  await ap.goto("/markt?q=Noah%20Vermeer");
  await ap.getByRole("link", { name: /Noah Vermeer/ }).first().click();
  await expect(ap.getByRole("button", { name: "Controleer kooporder" }).first()).toBeDisabled();

  await page.goto("/beheer/gebruikers");
  const annaAgain = page.locator("section", { hasText: "Anna de Vries" });
  await annaAgain.getByPlaceholder("Reden voor beëindigen").fill("End-to-end test afgerond");
  await annaAgain.getByRole("button", { name: "Beëindigen" }).click();
  await expect(page.getByRole("status")).toContainText("Beperking beëindigd");
  await expect(async () => {
    const after = await (await ap.request.get("/api/v1/me")).json();
    expect(after.data.allowedActions.TRADE.allowed).toBe(true);
  }).toPass({ timeout: 5_000 });
  await ctx.close();

  await page.goto("/beheer/audit");
  await expect(page.getByText("Beperking ingesteld").first()).toBeVisible();
  await expect(page.getByText("Beperking beëindigd").first()).toBeVisible();
});

test("an admin cannot restrict their own account", async ({ page }) => {
  await loginAs(page, /Sanne/);
  await page.goto("/beheer/gebruikers");
  const self = page.locator("section", { hasText: "Sanne (beheer)" });
  await expect(self.getByText("Je kunt je eigen account niet beperken.")).toBeVisible();
  await expect(self.getByRole("button", { name: "Instellen" })).toHaveCount(0);
});
