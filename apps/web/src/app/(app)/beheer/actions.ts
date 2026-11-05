"use server";

/**
 * Admin server actions. Every action resolves the user from the session and
 * re-checks the permission inside the database function (never trusting the
 * form). Results are reported through the URL so a reload never repeats them.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError } from "@px/domain";
import { addRestriction, endRestriction, getDb, requestCatalogImport, RESTRICTION_TYPES_LIST } from "@px/db";
import { currentUser } from "@/server/session";
import { payments } from "@/server/payments";
import { approveBreakResolution, proposeBreakResolution, runReconciliation } from "@px/db";
import {
  createDraftProgramme,
  decideApproval,
  publishProgramme,
  requestProgrammePublication,
  resolveImportIssue,
  setMarketStatus,
  setPrimaryAdmission,
  type MarketStatus,
  type PrimaryAdmission,
} from "@px/db";

class FormError extends Error {}

function fail(path: string, e: unknown): never {
  const msg = e instanceof FormError ? e.message : e instanceof DomainError ? e.userMessage : "Er ging iets mis. Er is niets gewijzigd.";
  if (!(e instanceof DomainError) && !(e instanceof FormError)) console.error(JSON.stringify({ level: "error", msg: "admin action failed", error: String(e) }));
  redirect(`${path}${path.includes("?") ? "&" : "?"}fout=${encodeURIComponent(msg)}`);
}

export async function startCatalogImport(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let note: string;
  try {
    const r = await requestCatalogImport(getDb().db, user, "fixture", String(formData.get("reason") ?? ""), randomUUID());
    note = r.alreadyActive ? "Er loopt al een import; die wordt afgemaakt." : "Import ingepland. De worker verwerkt hem direct.";
  } catch (e) {
    fail("/beheer/catalogus", e);
  }
  revalidatePath("/beheer/catalogus");
  redirect(`/beheer/catalogus?melding=${encodeURIComponent(note)}`);
}

export async function restrictUser(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const type = String(formData.get("type") ?? "");
  try {
    if (!(RESTRICTION_TYPES_LIST as readonly string[]).includes(type)) throw new FormError("Kies een geldig type beperking.");
    if (String(formData.get("reason") ?? "").trim().length < 5) throw new FormError("Geef een reden van minimaal 5 tekens.");
    await addRestriction(getDb().db, user, {
      userId: String(formData.get("userId") ?? ""),
      type: type as (typeof RESTRICTION_TYPES_LIST)[number],
      reason: String(formData.get("reason") ?? ""),
      requestId: randomUUID(),
    });
  } catch (e) {
    fail("/beheer/gebruikers", e);
  }
  revalidatePath("/beheer/gebruikers");
  redirect(`/beheer/gebruikers?melding=${encodeURIComponent("Beperking ingesteld en vastgelegd in de auditlog.")}`);
}

export async function liftRestriction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  try {
    if (String(formData.get("reason") ?? "").trim().length < 5) throw new FormError("Geef een reden van minimaal 5 tekens.");
    await endRestriction(getDb().db, user, {
      restrictionId: String(formData.get("restrictionId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      requestId: randomUUID(),
    });
  } catch (e) {
    fail("/beheer/gebruikers", e);
  }
  revalidatePath("/beheer/gebruikers");
  redirect(`/beheer/gebruikers?melding=${encodeURIComponent("Beperking beëindigd en vastgelegd in de auditlog.")}`);
}

// ---------------------------------------------------------------------------
// Fase 3: players, programmes, approvals, quarantine
// ---------------------------------------------------------------------------


const str = (f: FormData, k: string) => String(f.get(k) ?? "");
function done(path: string, note: string): never {
  revalidatePath(path);
  redirect(`${path}${path.includes("?") ? "&" : "?"}melding=${encodeURIComponent(note)}`);
}
async function guarded(path: string, fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<string>): Promise<never> {
  const user = await currentUser();
  if (!user) redirect("/login");
  let note: string;
  try {
    note = await fn(user);
  } catch (e) {
    fail(path, e);
  }
  done(path, note);
}

export async function changeAdmission(formData: FormData) {
  const back = `/beheer/spelers?q=${encodeURIComponent(str(formData, "q"))}`;
  await guarded(back, async (user) => {
    await setPrimaryAdmission(getDb().db, user, { playerId: str(formData, "playerId"), admission: str(formData, "admission") as PrimaryAdmission, reason: str(formData, "reason") });
    return "Toelating gewijzigd en vastgelegd in de auditlog.";
  });
}

export async function changeMarketStatus(formData: FormData) {
  const back = `/beheer/spelers?q=${encodeURIComponent(str(formData, "q"))}`;
  await guarded(back, async (user) => {
    await setMarketStatus(getDb().db, user, { playerId: str(formData, "playerId"), status: str(formData, "status") as MarketStatus, reason: str(formData, "reason") });
    return "Marktstatus gewijzigd en vastgelegd in de auditlog.";
  });
}

export async function draftProgramme(formData: FormData) {
  const playerId = str(formData, "playerId");
  await guarded(`/beheer/voorraad?speler=${playerId}`, async (user) => {
    const planned = Number(str(formData, "plannedTotal"));
    if (!Number.isInteger(planned)) throw new FormError("Vul een geheel aantal kaarten in.");
    await createDraftProgramme(getDb().db, user, { playerId, seasonKey: str(formData, "seasonKey"), plannedTotal: planned, reason: str(formData, "reason") });
    return "Concept aangemaakt. Vraag goedkeuring aan om te publiceren.";
  });
}

export async function askProgrammeApproval(formData: FormData) {
  await guarded(`/beheer/voorraad?speler=${str(formData, "playerId")}`, async (user) => {
    await requestProgrammePublication(getDb().db, user, { programmeId: str(formData, "programmeId"), reason: str(formData, "reason") });
    return "Goedkeuring aangevraagd. Een tweede bevoegde persoon moet akkoord geven.";
  });
}

export async function publishApprovedProgramme(formData: FormData) {
  await guarded(`/beheer/voorraad?speler=${str(formData, "playerId")}`, async (user) => {
    await publishProgramme(getDb().db, user, { programmeId: str(formData, "programmeId"), approvalId: str(formData, "approvalId") });
    return "Programma gepubliceerd.";
  });
}

export async function decide(formData: FormData) {
  await guarded("/beheer/goedkeuringen", async (user) => {
    const decision = str(formData, "decision") === "APPROVE" ? "APPROVE" : "REJECT";
    await decideApproval(getDb().db, user, { approvalId: str(formData, "approvalId"), decision, reason: str(formData, "reason") });
    return decision === "APPROVE" ? "Goedgekeurd." : "Afgewezen.";
  });
}

export async function resolveIssue(formData: FormData) {
  await guarded("/beheer/catalogus", async (user) => {
    const choice = str(formData, "choice");
    const resolution = choice === "IGNORE" ? { kind: "IGNORE" as const } : choice === "CREATE_NEW" ? { kind: "CREATE_NEW" as const } : { kind: "LINK" as const, playerId: choice };
    await resolveImportIssue(getDb().db, user, { issueId: str(formData, "issueId"), resolution, reason: str(formData, "reason") });
    return "Importprobleem afgehandeld en vastgelegd in de auditlog.";
  });
}

export async function reconcileNow() {
  await guarded("/beheer/betalingen", async (user) => {
    if (!user.permissions.has("finance.reconcile")) throw new DomainError("ACTION_NOT_ALLOWED");
    const ctx = payments();
    const r = await runReconciliation(getDb().db, ctx.provider, ctx.providerName, { scope: "payments:manual" });
    return r.outcome === "MATCHED"
      ? "Reconciliatie afgerond: platform en betaalpartner sluiten aan."
      : `Reconciliatie afgerond: ${r.findings} verschil(len), waarvan ${r.opened} nieuw.`;
  });
}

export async function proposeResolution(formData: FormData) {
  await guarded("/beheer/betalingen", async (user) => {
    await proposeBreakResolution(getDb().db, user, { breakId: str(formData, "breakId"), note: str(formData, "note") });
    return "Voorstel vastgelegd. Een tweede bevoegde persoon moet het goedkeuren (bij een materieel verschil).";
  });
}

export async function approveResolution(formData: FormData) {
  await guarded("/beheer/betalingen", async (user) => {
    await approveBreakResolution(getDb().db, user, { breakId: str(formData, "breakId"), reason: str(formData, "reason") });
    return "Verschil afgehandeld en vastgelegd in de auditlog.";
  });
}
