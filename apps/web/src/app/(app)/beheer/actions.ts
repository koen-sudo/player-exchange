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

class FormError extends Error {}

function fail(path: string, e: unknown): never {
  const msg = e instanceof FormError ? e.message : e instanceof DomainError ? e.userMessage : "Er ging iets mis. Er is niets gewijzigd.";
  if (!(e instanceof DomainError) && !(e instanceof FormError)) console.error(JSON.stringify({ level: "error", msg: "admin action failed", error: String(e) }));
  redirect(`${path}?fout=${encodeURIComponent(msg)}`);
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
