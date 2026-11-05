/**
 * Payments context for pages, actions and API routes. The adapter follows the
 * configuration; only the demo simulator exists until O-02 is decided.
 */
import "server-only";
import { getDb, paymentsContext, type SimScenario } from "@px/db";
import { loadConfig } from "@px/integrations/env";

export function payments(opts: { scenario?: SimScenario } = {}) {
  return paymentsContext(getDb().db, loadConfig(process.env), opts);
}

export const depositReturnUrl = (depositId: string) => `/betalingen/terug?storting=${depositId}`;
