/**
 * Startup configuration guard (docs/00 "Drie uitvoeringsmodi", AT-35, addendum V1.1).
 *
 * - demo: fictitious data, test money, local adapters, demo login allowed.
 * - sandbox: supplier test environments; no demo login, no demo payment adapter.
 * - production: real users and money; refuses any demo adapter or demo login
 *   and refuses to start while required production gates are unmet.
 *
 * Called by web and worker before they accept work. A failing check throws and
 * the process exits: misconfiguration fails at startup, never at request time.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const APP_MODES = ["demo", "sandbox", "production"] as const;
export type AppMode = (typeof APP_MODES)[number];

export type AppConfig = {
  readonly mode: AppMode;
  readonly demoLoginEnabled: boolean;
  readonly adapters: {
    readonly payment: string;
    readonly identity: string;
    readonly footballData: string;
    readonly notification: string;
  };
  readonly databaseUrl: string;
  readonly redisUrl: string | undefined;
  readonly authSecret: string;
  /** Shared secret to verify payment webhooks (per provider contract). */
  readonly paymentWebhookSecret: string;
  /** Where the web app is reachable for the worker (simulated webhooks in demo). */
  readonly webBaseUrl: string;
  /** 256-bit key (hex) that encrypts drop allocation seeds at rest (BR-11). */
  readonly dropSeedKey: string;
};

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Ongeldige configuratie:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const DEMO_ADAPTERS = new Set(["demo", "fixture", "simulator"]);
/** The publicly known demo key from .env.example; refused in production. */
export const DEMO_DROP_SEED_KEY = "d0d0".repeat(16);

function bool(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const problems: string[] = [];
  const mode = env.APP_MODE as AppMode | undefined;
  if (!mode || !APP_MODES.includes(mode)) {
    problems.push(`APP_MODE moet demo, sandbox of production zijn (gevonden: ${env.APP_MODE ?? "leeg"})`);
  }
  const cfg: AppConfig = {
    mode: mode ?? "demo",
    demoLoginEnabled: bool(env.DEMO_LOGIN_ENABLED),
    adapters: {
      payment: env.PAYMENT_PROVIDER ?? "",
      identity: env.IDENTITY_PROVIDER ?? "",
      footballData: env.FOOTBALL_DATA_PROVIDER ?? "",
      notification: env.NOTIFICATION_PROVIDER ?? "",
    },
    databaseUrl: env.DATABASE_URL ?? "",
    redisUrl: env.REDIS_URL,
    authSecret: env.AUTH_SECRET ?? "",
    paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET ?? "",
    webBaseUrl: env.WEB_BASE_URL ?? "http://localhost:3000",
    dropSeedKey: env.DROP_SEED_KEY ?? "",
  };

  if (!cfg.databaseUrl) problems.push("DATABASE_URL ontbreekt");
  if (!cfg.authSecret) problems.push("AUTH_SECRET ontbreekt");
  if (!cfg.paymentWebhookSecret) problems.push("PAYMENT_WEBHOOK_SECRET ontbreekt");
  if (!/^[0-9a-f]{64}$/i.test(cfg.dropSeedKey)) problems.push("DROP_SEED_KEY moet 64 hexadecimale tekens (256 bit) zijn");
  for (const [k, v] of Object.entries(cfg.adapters)) {
    if (!v) problems.push(`adapter ${k} is niet ingesteld`);
  }

  if (cfg.mode !== "demo" && cfg.demoLoginEnabled) {
    problems.push(`demo-login is alleen toegestaan in demo-modus, niet in ${cfg.mode}`);
  }
  if (cfg.mode === "sandbox" && DEMO_ADAPTERS.has(cfg.adapters.payment)) {
    problems.push("sandbox vereist de testomgeving van een echte betaalpartner, geen demo-simulator");
  }
  if (cfg.mode === "production") {
    for (const [k, v] of Object.entries(cfg.adapters)) {
      if (DEMO_ADAPTERS.has(v)) problems.push(`demo-adapter "${v}" voor ${k} is niet toegestaan in productie`);
    }
    if (cfg.authSecret === "change-me-in-local-env" || cfg.authSecret.length < 32) {
      problems.push("AUTH_SECRET is te zwak voor productie");
    }
    if (cfg.paymentWebhookSecret.startsWith("demo-") || cfg.paymentWebhookSecret.length < 32) {
      problems.push("PAYMENT_WEBHOOK_SECRET is te zwak voor productie");
    }
    if (cfg.dropSeedKey.toLowerCase() === DEMO_DROP_SEED_KEY) problems.push("DROP_SEED_KEY is de demosleutel en niet toegestaan in productie");
  }

  // An online demo (reachable over https) is behind a password and does not
  // use the publicly known demo secrets from .env.example.
  const access = env.DEMO_ACCESS_PASSWORD;
  if (access !== undefined && access.length < 12) problems.push("DEMO_ACCESS_PASSWORD moet minimaal 12 tekens zijn");
  if (cfg.mode === "demo" && cfg.webBaseUrl.startsWith("https://")) {
    if (!access) problems.push("een online demo (https) vereist DEMO_ACCESS_PASSWORD");
    if (cfg.authSecret === "change-me-in-local-env" || cfg.authSecret.length < 32) problems.push("AUTH_SECRET is te zwak voor een online demo");
    if (cfg.paymentWebhookSecret.startsWith("demo-") || cfg.paymentWebhookSecret.length < 32) problems.push("PAYMENT_WEBHOOK_SECRET is te zwak voor een online demo");
    if (cfg.dropSeedKey.toLowerCase() === DEMO_DROP_SEED_KEY) problems.push("DROP_SEED_KEY is de openbare demosleutel; kies een eigen sleutel voor een online demo");
  }

  if (problems.length) throw new ConfigError(problems);
  return cfg;
}

/** The demo login is reachable only when this returns true, regardless of request parameters. */
export function isDemoLoginAllowed(cfg: AppConfig): boolean {
  return cfg.mode === "demo" && cfg.demoLoginEnabled;
}

// CLI: `node packages/integrations/src/env-check.ts` validates the current environment.
function isMainModule(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const cfg = loadConfig(process.env);
    console.log(`Configuratie geldig voor modus ${cfg.mode}.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
