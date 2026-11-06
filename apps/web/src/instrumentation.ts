/**
 * Runs once when the server starts. An invalid or unsafe configuration (for
 * example production with demo login or demo adapters) stops the server
 * before it accepts any request (AT-35, addendum V1.1). Production also
 * refuses to start while a production gate is open (docs/10).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig } = await import("@px/integrations/env");
  const cfg = loadConfig(process.env);
  if (cfg.mode === "production") {
    const { assertProductionGates, getDb } = await import("@px/db");
    await assertProductionGates(getDb().db, cfg.mode);
  }
}
