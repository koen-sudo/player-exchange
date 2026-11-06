/**
 * Adapter contract suites (fase 8, docs/07, docs/11 "Lever contracttests en
 * capabilityrapport").
 *
 * Every adapter — the demo simulator today, a sandbox or production adapter
 * later — must pass the same checks. A capability the adapter does not
 * support is reported as BLOCKED (never silently skipped), and the money
 * flows that need it stay blocked (blockedFlows).
 *
 * The suites return results instead of throwing, so they can run from a test
 * runner and from the admin screen ("contracttest uitvoeren") alike.
 * Idempotency keys start with `contract-test:` so reconciliation can tell
 * them apart from customer money.
 */
import { blockedFlows, PAYMENT_CAPABILITIES, type FootballDataProvider, type PaymentCapability, type PaymentProvider, type ProviderOutcome } from "./contracts.ts";

export type ContractStatus = "PASSED" | "FAILED" | "BLOCKED";
export type ContractResult = { area: string; check: string; status: ContractStatus; detail?: string };
export const CONTRACT_KEY_PREFIX = "contract-test:";

class Collector {
  readonly results: ContractResult[] = [];
  async check(area: string, check: string, fn: () => Promise<string | void> | string | void): Promise<void> {
    try {
      const detail = await fn();
      this.results.push({ area, check, status: "PASSED", ...(detail ? { detail } : {}) });
    } catch (e) {
      this.results.push({ area, check, status: "FAILED", detail: (e as Error).message });
    }
  }
  blocked(area: string, check: string, detail: string) {
    this.results.push({ area, check, status: "BLOCKED", detail });
  }
}

function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const notFailed = (o: ProviderOutcome, what: string) => expect(o.status !== "FAILED", `${what}: ${o.status === "FAILED" ? o.reason : ""}`);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export type PaymentHarness = {
  provider: PaymentProvider;
  /** A test account at the provider (sandbox: a test customer). */
  accountRef: string;
  /** Complete a started deposit as the customer would (simulator: choose success; sandbox: test card). */
  completeDeposit(reference: string): Promise<void>;
  /** Let provider-side processing finish (simulator: nothing; sandbox: wait or trigger). */
  settle(): Promise<void>;
  /** A correctly signed webhook body as the provider would send it, if the harness can produce one. */
  sampleWebhook?(): Promise<{ headers: Record<string, string>; rawBody: string } | null>;
  /** Unique per run, so a suite can run repeatedly against one sandbox. */
  runId: string;
};

export async function runPaymentContract(h: PaymentHarness): Promise<ContractResult[]> {
  const c = new Collector();
  const p = h.provider;
  const report = p.capabilities();
  const has = (cap: PaymentCapability) => report.supported.has(cap);
  const key = (name: string) => `${CONTRACT_KEY_PREFIX}${h.runId}:${name}`;
  const finalStatus = async (k: string) => {
    await h.settle();
    return p.queryStatus({ idempotencyKey: k });
  };

  await c.check("rapport", "Capabilityrapport met adapter en omgeving", () => {
    expect(report.adapter && ["demo", "sandbox", "production"].includes(report.environment), "adapter of omgeving ontbreekt");
    for (const cap of report.supported) expect((PAYMENT_CAPABILITIES as readonly string[]).includes(cap), `onbekende capability ${cap}`);
    const blocked = blockedFlows(report);
    return blocked.length ? `Geblokkeerd: ${blocked.map((b) => `${b.flow} (mist ${b.missing.join(", ")})`).join("; ")}` : `${report.adapter} (${report.environment}): alle geldstromen ondersteund`;
  });

  // Unknown is never failure.
  if (has("QUERY_STATUS")) {
    await c.check("status", "Onbekende operatie geeft UNKNOWN, niet FAILED", async () => {
      const o = await p.queryStatus({ idempotencyKey: key("never-submitted") });
      expect(o.status === "UNKNOWN", `kreeg ${o.status}`);
    });
  } else c.blocked("status", "Status opvragen", "QUERY_STATUS niet ondersteund: herstel na een timeout is onmogelijk");

  let depositRef: string | null = null;
  if (has("DEPOSIT")) {
    await c.check("storting", "Storting starten geeft een betaalpagina en is idempotent", async () => {
      const a = await p.startDeposit({ idempotencyKey: key("deposit"), userAccountRef: h.accountRef, amount: 2_500, returnUrl: "/betalingen" });
      const b = await p.startDeposit({ idempotencyKey: key("deposit"), userAccountRef: h.accountRef, amount: 2_500, returnUrl: "/betalingen" });
      expect(a.status === "PENDING" && a.redirectUrl, "geen betaalpagina");
      expect(a.providerReference === b.providerReference, "tweede aanroep met dezelfde sleutel gaf een andere operatie");
      depositRef = a.providerReference;
    });
    await c.check("storting", "Niet betaald is niet bevestigd", async () => {
      const o = await p.queryStatus({ idempotencyKey: key("deposit") });
      expect(o.status === "PENDING", `kreeg ${o.status} vóór betaling`);
    });
    await c.check("storting", "Na betaling bevestigt de provider", async () => {
      expect(depositRef, "geen referentie");
      await h.completeDeposit(depositRef);
      const o = await finalStatus(key("deposit"));
      expect(o.status === "SUCCEEDED", `kreeg ${o.status}`);
    });
  } else c.blocked("storting", "Storten", "DEPOSIT niet ondersteund");

  let holdRef = "";
  if (has("HOLD_FUNDS")) {
    await c.check("reservering", "Saldo reserveren is idempotent", async () => {
      const a = await p.holdFunds({ idempotencyKey: key("hold"), userAccountRef: h.accountRef, amount: 1_240 });
      const b = await p.holdFunds({ idempotencyKey: key("hold"), userAccountRef: h.accountRef, amount: 1_240 });
      notFailed(a, "reserveren");
      expect(a.providerReference === b.providerReference, "dubbele reservering");
      holdRef = a.providerReference ?? "";
    });
  } else c.blocked("reservering", "Saldo reserveren", "HOLD_FUNDS niet ondersteund");

  if (has("SETTLE_INTERNAL_SALE")) {
    await c.check("afwikkeling", "Interne verkoop €6,00 met €0,30 commissie wordt afgewikkeld", async () => {
      const o = await p.settleSale({ idempotencyKey: key("settle"), buyerHoldReference: holdRef, buyerAccountRef: h.accountRef, sellerAccountRef: `${h.accountRef}:seller`, gross: 600, sellerNet: 570, platformFee: 30 });
      notFailed(o, "afwikkelen");
      const f = await finalStatus(key("settle"));
      expect(f.status === "SUCCEEDED", `kreeg ${f.status}`);
    });
    if (has("SPLIT_COMMISSION")) {
      await c.check("afwikkeling", "Een verdeling die niet optelt tot het brutobedrag wordt geweigerd", async () => {
        let refused = false;
        try {
          const o = await p.settleSale({ idempotencyKey: key("settle-bad"), buyerHoldReference: holdRef, buyerAccountRef: h.accountRef, sellerAccountRef: `${h.accountRef}:seller`, gross: 600, sellerNet: 570, platformFee: 31 });
          refused = o.status === "FAILED";
        } catch {
          refused = true;
        }
        expect(refused, "onjuiste verdeling geaccepteerd");
      });
    } else c.blocked("afwikkeling", "Commissie splitsen", "SPLIT_COMMISSION niet ondersteund");
  } else c.blocked("afwikkeling", "Interne verkoop afwikkelen", "SETTLE_INTERNAL_SALE niet ondersteund");

  if (has("RELEASE_HOLD")) {
    await c.check("reservering", "Restant vrijgeven is idempotent", async () => {
      const a = await p.releaseHold({ idempotencyKey: key("release"), holdReference: holdRef, amount: 640 });
      const b = await p.releaseHold({ idempotencyKey: key("release"), holdReference: holdRef, amount: 640 });
      notFailed(a, "vrijgeven");
      expect(a.providerReference === b.providerReference, "dubbele vrijgave");
    });
  } else c.blocked("reservering", "Reservering vrijgeven", "RELEASE_HOLD niet ondersteund");

  if (has("PAYOUT")) {
    await c.check("opname", "Uitbetaling is idempotent en wordt bevestigd", async () => {
      const a = await p.payout({ idempotencyKey: key("payout"), userAccountRef: h.accountRef, amount: 1_000, destinationRef: "NL•• TEST" });
      const b = await p.payout({ idempotencyKey: key("payout"), userAccountRef: h.accountRef, amount: 1_000, destinationRef: "NL•• TEST" });
      notFailed(a, "uitbetalen");
      expect(a.providerReference === b.providerReference, "dubbele uitbetaling");
      const f = await finalStatus(key("payout"));
      expect(f.status === "SUCCEEDED", `kreeg ${f.status}`);
    });
  } else c.blocked("opname", "Uitbetalen", "PAYOUT niet ondersteund");

  await c.check("webhook", "Een gewijzigd bericht wordt afgewezen", async () => {
    const sample = await h.sampleWebhook?.();
    const rawBody = sample ? sample.rawBody.replace(/\d/, (d) => String((Number(d) + 1) % 10)) : JSON.stringify({ eventId: "evt_forged", reference: "x" });
    const v = p.verifyWebhook({ headers: sample?.headers ?? { "x-psp-signature": "0".repeat(64) }, rawBody });
    expect(!v.valid && v.eventId === null, "vervalst bericht geaccepteerd");
  });
  if (h.sampleWebhook) {
    await c.check("webhook", "Een echt bericht wordt geaccepteerd met een event-ID", async () => {
      const s = await h.sampleWebhook!();
      expect(s, "geen voorbeeldbericht");
      const v = p.verifyWebhook(s);
      expect(v.valid && v.eventId, "echt bericht afgewezen");
    });
  }

  if (has("RECONCILIATION_REPORT")) {
    await c.check("reconciliatie", "Het providerrapport bevat de operaties met bedrag en status", async () => {
      const lines = await p.reconciliationReport({ since: new Date(Date.now() - 3_600_000) });
      const mine = new Map(lines.filter((l) => l.idempotencyKey.startsWith(`${CONTRACT_KEY_PREFIX}${h.runId}:`)).map((l) => [l.idempotencyKey, l]));
      for (const [k, amount] of [[key("deposit"), 2_500], [key("payout"), 1_000]] as const) {
        if (!mine.has(k)) {
          if ((k.endsWith("deposit") && !has("DEPOSIT")) || (k.endsWith("payout") && !has("PAYOUT"))) continue;
          throw new Error(`${k} ontbreekt in het rapport`);
        }
        expect(mine.get(k)!.amount === amount, `${k}: bedrag ${mine.get(k)!.amount}`);
        expect(Number.isSafeInteger(mine.get(k)!.amount), "bedrag is geen geheel aantal centen");
      }
      return `${mine.size} contractoperaties in het rapport`;
    });
  } else c.blocked("reconciliatie", "Providerrapport", "RECONCILIATION_REPORT niet ondersteund: dagelijkse aansluiting onmogelijk");

  return c.results;
}

// ---------------------------------------------------------------------------
// Football data
// ---------------------------------------------------------------------------
async function allPages<T>(fetch: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null; isCompleteSnapshot?: boolean }>, limit = 200) {
  const items: T[] = [];
  let cursor: string | undefined;
  let complete: boolean | undefined;
  for (let i = 0; i < limit; i++) {
    const page = await fetch(cursor);
    items.push(...page.items);
    if (page.nextCursor === null) {
      complete = page.isCompleteSnapshot;
      return { items, complete };
    }
    cursor = page.nextCursor;
  }
  throw new Error("paginering stopt niet");
}

export async function runFootballDataContract(p: FootballDataProvider, opts: { maxTeams?: number } = {}): Promise<ContractResult[]> {
  const c = new Collector();
  let competitions: Awaited<ReturnType<FootballDataProvider["competitions"]>> = [];
  await c.check("catalogus", "Competities met seizoensdata", async () => {
    competitions = await p.competitions();
    expect(competitions.length > 0, "geen competities");
    for (const x of competitions) expect(x.externalId && x.name && /^\d{4}-\d{2}-\d{2}$/.test(x.seasonStartsOn ?? ""), `onvolledige competitie ${x.externalId}`);
    return `${competitions.length} competities`;
  });
  const comp = competitions[0];
  let teamIds: string[] = [];
  await c.check("catalogus", "Teams per pagina, unieke ID's, laatste pagina meldt of de lijst compleet is", async () => {
    expect(comp, "geen competitie");
    const { items, complete } = await allPages((cur) => p.teams(comp.externalId, cur));
    expect(items.length > 0, "geen teams");
    expect(new Set(items.map((t) => t.externalId)).size === items.length, "dubbele team-ID's");
    expect(typeof complete === "boolean", "laatste pagina zegt niet of de lijst compleet is");
    teamIds = items.map((t) => t.externalId);
  });
  await c.check("catalogus", "Dezelfde aanvraag geeft dezelfde ID's (stabiele identiteit)", async () => {
    const again = await allPages((cur) => p.teams(comp!.externalId, cur));
    expect(JSON.stringify(again.items.map((t) => t.externalId)) === JSON.stringify(teamIds), "ID's wisselen tussen aanroepen");
  });
  await c.check("catalogus", "Selecties met spelers-ID, naam en rol (rol mag onbekend zijn)", async () => {
    let n = 0;
    for (const t of teamIds.slice(0, opts.maxTeams ?? 3)) {
      const { items } = await allPages((cur) => p.squad(t, cur));
      for (const pl of items) {
        expect(pl.externalId && pl.displayName, "speler zonder ID of naam");
        n++;
      }
    }
    expect(n > 0, "geen spelers");
    return `${n} spelers in ${Math.min(teamIds.length, opts.maxTeams ?? 3)} selecties`;
  });
  let fixtureIds: string[] = [];
  await c.check("wedstrijden", "Wedstrijden met tijdstip en status", async () => {
    const { items } = await allPages((cur) => p.fixtures(comp!.externalId, "2000-01-01T00:00:00Z", cur));
    for (const f of items) expect(!Number.isNaN(Date.parse(f.kickoffAt)) && f.status, `wedstrijd ${f.externalId} onvolledig`);
    fixtureIds = items.map((f) => f.externalId);
    return `${items.length} wedstrijden`;
  });
  await c.check("wedstrijden", "Statistieken versiegebonden; minuten 0–130 of onbekend; geen negatieve waardes", async () => {
    let n = 0;
    for (const fx of fixtureIds.slice(0, 10)) {
      for (const s of await p.playerMatchStats(fx)) {
        expect(s.version >= 1 && !Number.isNaN(Date.parse(s.asOf)), "geen versie of peilmoment");
        expect(s.minutes === null || (Number.isInteger(s.minutes) && s.minutes >= 0 && s.minutes <= 130), `minuten ${s.minutes}`);
        for (const [k, v] of Object.entries(s.stats)) expect(Number.isFinite(v) && v >= 0, `${k} = ${v}`);
        n++;
      }
    }
    return fixtureIds.length ? `${n} statistiekregels` : "geen wedstrijden om te controleren";
  });
  return c.results;
}
