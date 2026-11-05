/**
 * Runs once when the server starts. An invalid or unsafe configuration (for
 * example production with demo login or demo adapters) stops the server
 * before it accepts any request (AT-35, addendum V1.1).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig } = await import("@px/integrations/env");
  loadConfig(process.env);
}
