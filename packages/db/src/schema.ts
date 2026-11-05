/**
 * Drizzle table definitions for typed queries (ADR 0002).
 * The SQL migrations in ../migrations are the source of truth for structure
 * and constraints; these definitions mirror the columns the code uses.
 * Fase 2 covers identity, authorisation, audit and catalogue.
 */
import { boolean, char, date, integer, jsonb, numeric, pgTable, primaryKey, pgView, text, timestamp, uuid, bigint } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authSubject: text("auth_subject").notNull().unique(),
  status: text("status").$type<"ACTIVE" | "SUSPENDED" | "CLOSED">().notNull().default("ACTIVE"),
  locale: text("locale").notNull().default("nl-NL"),
  isTestAccount: boolean("is_test_account").notNull().default(false),
  isStaff: boolean("is_staff").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
  version: integer("version").notNull().default(1),
});

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  displayName: text("display_name"),
  residenceCountry: char("residence_country", { length: 2 }),
  verificationStatus: text("verification_status").notNull().default("NOT_STARTED"),
  verificationRef: text("verification_ref"),
  ageConfirmed: boolean("age_confirmed").notNull().default(false),
  beneficialOwnerKey: text("beneficial_owner_key"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const RESTRICTION_TYPES = ["TRADING_STOP", "DEPOSIT_STOP", "WITHDRAWAL_STOP", "SUBSCRIPTION_STOP", "FULL_STOP"] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export const userRestrictions = pgTable("user_restrictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  type: text("type").$type<RestrictionType>().notNull(),
  reason: text("reason").notNull(),
  startsAt: ts("starts_at").notNull().defaultNow(),
  endsAt: ts("ends_at"),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const termsDocuments = pgTable("terms_documents", {
  documentKey: text("document_key").notNull(),
  documentVersion: text("document_version").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  isPlaceholder: boolean("is_placeholder").notNull().default(true),
  publishedAt: ts("published_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.documentKey, t.documentVersion] })]);

export const termsAcceptances = pgTable("terms_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  documentKey: text("document_key").notNull(),
  documentVersion: text("document_version").notNull(),
  acceptedAt: ts("accepted_at").notNull().defaultNow(),
});

export const admittedCountries = pgTable("admitted_countries", {
  countryCode: char("country_code", { length: 2 }).primaryKey(),
});

export const roles = pgTable("roles", { key: text("key").primaryKey(), description: text("description").notNull() });
export const permissions = pgTable("permissions", { key: text("key").primaryKey(), description: text("description").notNull() });
export const rolePermissions = pgTable("role_permissions", {
  roleKey: text("role_key").notNull(),
  permissionKey: text("permission_key").notNull(),
}, (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })]);
export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull(),
  roleKey: text("role_key").notNull(),
  grantedBy: uuid("granted_by"),
  grantedAt: ts("granted_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleKey] })]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id"),
  actorKind: text("actor_kind").$type<"USER" | "ADMIN" | "SYSTEM" | "PROVIDER">().notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  related: jsonb("related").$type<Record<string, unknown>>().notNull().default({}),
  requestId: text("request_id"),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
});

export const featureGates = pgTable("feature_gates", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  evidenceRef: text("evidence_ref"),
  approvalId: uuid("approval_id"),
  satisfied: boolean("satisfied").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export const competitions = pgTable("competitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
  name: text("name").notNull(),
  countryCode: char("country_code", { length: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const competitionSeasons = pgTable("competition_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  competitionId: uuid("competition_id").notNull(),
  providerSeasonId: text("provider_season_id").notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const providerTeamMappings = pgTable("provider_team_mappings", {
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  teamId: uuid("team_id").notNull(),
}, (t) => [primaryKey({ columns: [t.provider, t.externalId] })]);

export const teamCompetitionMemberships = pgTable("team_competition_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  competitionId: uuid("competition_id").notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
});

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  birthDate: date("birth_date"),
  nationality: char("nationality", { length: 2 }),
  careerStatus: text("career_status").$type<"ACTIVE" | "RETIRED" | "DECEASED" | "UNKNOWN">().notNull().default("ACTIVE"),
  dataQuality: text("data_quality").$type<"OK" | "PARTIAL" | "STALE" | "MISSING">().notNull().default("MISSING"),
  primaryAdmission: text("primary_admission").$type<"INELIGIBLE" | "REVIEW" | "APPROVED" | "PAUSED">().notNull().default("INELIGIBLE"),
  isFictional: boolean("is_fictional").notNull().default(false),
  identityRightsReleased: boolean("identity_rights_released").notNull().default(false),
  retiredAt: date("retired_at"),
  sourceVersion: text("source_version"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const providerPlayerMappings = pgTable("provider_player_mappings", {
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  playerId: uuid("player_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.provider, t.externalId] })]);

export const playerTeamMemberships = pgTable("player_team_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull(),
  teamId: uuid("team_id").notNull(),
  membershipType: text("membership_type").$type<"FIRST_TEAM" | "LOAN" | "YOUTH" | "RESERVE">().notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
});

export const playerRoles = pgTable("player_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull(),
  role: text("role").notNull(),
  source: text("source").notNull(),
  weight: numeric("weight").notNull().default("1"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
});

export const playerMarkets = pgTable("player_markets", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().unique(),
  status: text("status").$type<"PROFILE_ONLY" | "PRELAUNCH" | "OPEN" | "PAUSED" | "CLOSED">().notNull().default("PROFILE_ONLY"),
  statusReason: text("status_reason"),
});

export const importRuns = pgTable("import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  scope: text("scope").notNull(),
  sourceVersion: text("source_version"),
  cursor: text("cursor"),
  status: text("status").$type<"QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED">().notNull(),
  isCompleteSnapshot: boolean("is_complete_snapshot").notNull().default(false),
  coverage: jsonb("coverage").$type<Record<string, unknown>>().notNull().default({}),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  requestedBy: uuid("requested_by"),
  heartbeatAt: ts("heartbeat_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
});

export const importRunSteps = pgTable("import_run_steps", {
  runId: uuid("run_id").notNull(),
  stepKey: text("step_key").notNull(),
  status: text("status").$type<"PENDING" | "RUNNING" | "COMPLETED" | "FAILED">().notNull().default("PENDING"),
  cursor: text("cursor"),
  pagesDone: integer("pages_done").notNull().default(0),
  isCompleteSnapshot: boolean("is_complete_snapshot").notNull().default(false),
  completedAt: ts("completed_at"),
}, (t) => [primaryKey({ columns: [t.runId, t.stepKey] })]);

export const importSnapshots = pgTable("import_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  stepKey: text("step_key").notNull(),
  pageNo: integer("page_no").notNull(),
  sourceVersion: text("source_version").notNull(),
  payload: jsonb("payload").notNull(),
  retainUntil: ts("retain_until").notNull(),
});

export const importIssues = pgTable("import_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  importRunId: uuid("import_run_id").notNull(),
  kind: text("kind").$type<"MISSING_FIELD" | "DUPLICATE" | "CONFLICTING_MATCH" | "SCHEMA">().notNull(),
  entityRef: text("entity_ref").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  resolution: text("resolution").$type<"OPEN" | "RESOLVED" | "IGNORED">().notNull().default("OPEN"),
  provider: text("provider"),
  externalId: text("external_id"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const publicReferenceValues = pgView("public_reference_values", {
  playerId: uuid("player_id").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  confidence: text("confidence").notNull(),
  publishedAt: ts("published_at").notNull(),
  modelVersion: text("model_version").notNull(),
  isDemo: boolean("is_demo").notNull(),
  isHistorical: boolean("is_historical").notNull(),
}).existing();
