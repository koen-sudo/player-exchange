-- Player Exchange — core schema (fase 0 fundament, used by fases 2–7).
-- Source of truth for database constraints. See docs/05-data-model.md and
-- docs/adr/0002-database-migrations.md. Money is always integer euro cents
-- (bigint), currency is always 'EUR' in V1 (BR-19).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
CREATE TYPE environment_mode       AS ENUM ('demo', 'sandbox', 'production');
CREATE TYPE user_status            AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE career_status          AS ENUM ('ACTIVE', 'RETIRED', 'DECEASED', 'UNKNOWN');
CREATE TYPE data_quality           AS ENUM ('OK', 'PARTIAL', 'STALE', 'MISSING');
CREATE TYPE primary_admission      AS ENUM ('INELIGIBLE', 'REVIEW', 'APPROVED', 'PAUSED');
CREATE TYPE market_status          AS ENUM ('PROFILE_ONLY', 'PRELAUNCH', 'OPEN', 'PAUSED', 'CLOSED');
CREATE TYPE programme_status       AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED', 'COMPLETED', 'CANCELLED');
CREATE TYPE card_status            AS ENUM ('PLATFORM_INVENTORY', 'IN_DROP', 'ALLOCATED_PENDING', 'OWNED', 'UNSOLD');
CREATE TYPE drop_status            AS ENUM ('DRAFT', 'PUBLISHED', 'OPEN', 'CLOSED', 'ALLOCATING', 'SETTLING', 'COMPLETED', 'POSTPONED', 'CANCELLED');
CREATE TYPE subscription_status    AS ENUM ('RESERVATION_PENDING', 'CONFIRMED', 'CANCELLED', 'INVALID_LATE', 'ALLOCATED', 'WAITLISTED', 'NOT_ALLOCATED', 'RELEASED');
CREATE TYPE allocation_status      AS ENUM ('ALLOCATED', 'SETTLEMENT_PENDING', 'DELIVERED', 'FAILED', 'MANUAL_REVIEW', 'EXPIRED');
CREATE TYPE order_side             AS ENUM ('BUY', 'SELL');
CREATE TYPE time_in_force          AS ENUM ('ONE_DAY', 'SEVEN_DAYS', 'THIRTY_DAYS');
CREATE TYPE order_state            AS ENUM ('PENDING_HOLD', 'ACTIVE', 'CLOSED', 'REJECTED');
CREATE TYPE execution_status       AS ENUM ('MATCHED', 'SUBMISSION_PENDING', 'PROVIDER_PENDING', 'SETTLED', 'FAILED', 'MANUAL_REVIEW');
CREATE TYPE operation_status       AS ENUM ('CREATED', 'SUBMITTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'MANUAL_REVIEW');
CREATE TYPE valuation_run_status   AS ENUM ('DRAFT', 'VALIDATED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'FAILED', 'SUPERSEDED');
CREATE TYPE ledger_account_type    AS ENUM (
  'PSP_SETTLEMENT_ASSET', 'CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED', 'PENDING_SETTLEMENT',
  'PENDING_WITHDRAWAL', 'PLATFORM_FEE_CLEARING', 'PRIMARY_REVENUE_CLEARING', 'CUSTOMER_RECEIVABLE',
  'CUSTOMER_PENDING_INCOMING', 'PLATFORM_LOSS');
CREATE TYPE journal_side           AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE hold_status            AS ENUM ('PENDING', 'ACTIVE', 'RELEASED', 'CONSUMED', 'FAILED');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
-- Append-only guard for audit-like tables (journal lines, audit events, ownership events).
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject  text NOT NULL UNIQUE,
  status        user_status NOT NULL DEFAULT 'ACTIVE',
  locale        text NOT NULL DEFAULT 'nl-NL',
  is_test_account boolean NOT NULL DEFAULT false,
  is_staff      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  version       integer NOT NULL DEFAULT 1
);

CREATE TABLE user_profiles (
  user_id               uuid PRIMARY KEY REFERENCES users(id),
  display_name          text,
  residence_country     char(2),
  verification_status   text NOT NULL DEFAULT 'NOT_STARTED',
  verification_ref      text,
  age_confirmed         boolean NOT NULL DEFAULT false,
  beneficial_owner_key  text,       -- groups known same beneficial owner (BR-17)
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1
);

CREATE TABLE user_restrictions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  type        text NOT NULL CHECK (type IN ('TRADING_STOP','DEPOSIT_STOP','WITHDRAWAL_STOP','SUBSCRIPTION_STOP','FULL_STOP')),
  reason      text NOT NULL CHECK (length(trim(reason)) > 0),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  actor_id    uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX user_restrictions_user_idx ON user_restrictions(user_id);

CREATE TABLE terms_acceptances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  document_key     text NOT NULL,
  document_version text NOT NULL,
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_key, document_version)
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE competitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  provider_id  text NOT NULL,
  name         text NOT NULL,
  country_code char(2) NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE TABLE competition_seasons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id     uuid NOT NULL REFERENCES competitions(id),
  provider_season_id text NOT NULL,
  starts_on          date,
  ends_on            date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, provider_season_id)
);

CREATE TABLE teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  short_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_team_mappings (
  provider    text NOT NULL,
  external_id text NOT NULL,
  team_id     uuid NOT NULL REFERENCES teams(id),
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE team_competition_memberships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES teams(id),
  competition_id uuid NOT NULL REFERENCES competitions(id),
  valid_from     date NOT NULL,
  valid_to       date,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- immutable internal identity (BR-01)
  display_name  text NOT NULL,
  first_name    text,
  last_name     text,
  birth_date    date,
  nationality   char(2),
  career_status career_status NOT NULL DEFAULT 'ACTIVE',
  data_quality  data_quality NOT NULL DEFAULT 'MISSING',
  primary_admission primary_admission NOT NULL DEFAULT 'INELIGIBLE',
  is_fictional  boolean NOT NULL DEFAULT false,
  -- O-10 / AT-39: a real identity may only be shown commercially after release.
  identity_rights_released boolean NOT NULL DEFAULT false,
  retired_at    date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  version       integer NOT NULL DEFAULT 1
);

CREATE TABLE provider_player_mappings (
  provider    text NOT NULL,
  external_id text NOT NULL,
  player_id   uuid NOT NULL REFERENCES players(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE player_team_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid NOT NULL REFERENCES players(id),
  team_id         uuid NOT NULL REFERENCES teams(id),
  membership_type text NOT NULL CHECK (membership_type IN ('FIRST_TEAM','LOAN','YOUTH','RESERVE')),
  valid_from      date NOT NULL,
  valid_to        date,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX player_team_memberships_player_idx ON player_team_memberships(player_id);

CREATE TABLE player_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES players(id),
  role       text NOT NULL CHECK (role IN ('GOALKEEPER','CENTRE_BACK','FULL_BACK','DEFENSIVE_MIDFIELDER','CENTRAL_MIDFIELDER','WINGER','STRIKER')),
  source     text NOT NULL,
  weight     numeric(5,4) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 1),
  valid_from date NOT NULL,
  valid_to   date
);

CREATE TABLE fixtures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL,
  external_id    text NOT NULL,
  competition_id uuid REFERENCES competitions(id),
  home_team_id   uuid NOT NULL REFERENCES teams(id),
  away_team_id   uuid NOT NULL REFERENCES teams(id),
  kickoff_at     timestamptz,
  status         text NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE player_match_stats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES players(id),
  fixture_id     uuid NOT NULL REFERENCES fixtures(id),
  version        integer NOT NULL,
  minutes        integer CHECK (minutes IS NULL OR minutes BETWEEN 0 AND 130),
  stats          jsonb NOT NULL DEFAULT '{}'::jsonb, -- missing keys mean "unknown", never zero
  source_as_of   timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, fixture_id, version)
);

CREATE TABLE watchlists (
  user_id    uuid NOT NULL REFERENCES users(id),
  player_id  uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, player_id)
);

CREATE TABLE import_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  scope         text NOT NULL,
  source_version text,
  cursor        text,
  status        text NOT NULL CHECK (status IN ('RUNNING','PAUSED','COMPLETED','FAILED')),
  is_complete_snapshot boolean NOT NULL DEFAULT false,
  coverage      jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE TABLE import_issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES import_runs(id),
  kind          text NOT NULL CHECK (kind IN ('MISSING_FIELD','DUPLICATE','CONFLICTING_MATCH','SCHEMA')),
  entity_ref    text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution    text NOT NULL DEFAULT 'OPEN' CHECK (resolution IN ('OPEN','RESOLVED','IGNORED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Valuation
-- ---------------------------------------------------------------------------
CREATE TABLE external_valuations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players(id),
  source      text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency    char(3) NOT NULL DEFAULT 'EUR',
  as_of       date NOT NULL,
  known_at    timestamptz NOT NULL,
  UNIQUE (player_id, source, as_of)
);

CREATE TABLE valuation_model_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_key  text NOT NULL UNIQUE,
  is_demo      boolean NOT NULL,
  parameters   jsonb NOT NULL,
  code_version text NOT NULL,
  status       text NOT NULL CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  approved_by  uuid REFERENCES users(id),
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE valuation_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version_id uuid NOT NULL REFERENCES valuation_model_versions(id),
  scope            text NOT NULL,
  data_version     text NOT NULL,
  information_as_of timestamptz NOT NULL,
  input_snapshot_ref text,
  status           valuation_run_status NOT NULL DEFAULT 'DRAFT',
  computed_at      timestamptz,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL) OR status = 'SUPERSEDED')
);

CREATE TABLE player_reference_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES players(id),
  run_id        uuid NOT NULL REFERENCES valuation_runs(id),
  amount_cents  bigint NOT NULL CHECK (amount_cents >= 0),
  confidence    text NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  explanations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_historical boolean NOT NULL DEFAULT false, -- e.g. after retirement (BR-22)
  UNIQUE (player_id, run_id)
);

CREATE TABLE valuation_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES valuation_runs(id),
  decision   text NOT NULL CHECK (decision IN ('APPROVE','REJECT','REQUEST_CHANGES')),
  actor_id   uuid NOT NULL REFERENCES users(id),
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Public reads go through this view only (BR-08, AT-29): published runs only,
-- latest per player.
CREATE VIEW public_reference_values AS
SELECT DISTINCT ON (prv.player_id)
  prv.player_id, prv.amount_cents, prv.confidence, prv.explanations, prv.is_historical,
  vr.published_at, vr.information_as_of, mv.version_key AS model_version, mv.is_demo,
  vr.id AS run_id
FROM player_reference_values prv
JOIN valuation_runs vr ON vr.id = prv.run_id AND vr.status = 'PUBLISHED'
JOIN valuation_model_versions mv ON mv.id = vr.model_version_id
ORDER BY prv.player_id, vr.published_at DESC;

-- ---------------------------------------------------------------------------
-- Inventory and issuance
-- ---------------------------------------------------------------------------
CREATE TABLE player_markets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL UNIQUE REFERENCES players(id), -- one market per player (PRD-05)
  status     market_status NOT NULL DEFAULT 'PROFILE_ONLY',
  status_reason text,
  next_order_sequence bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1
);

CREATE TABLE editions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES players(id),
  season_key text NOT NULL CHECK (season_key ~ '^[0-9]{4}-[0-9]{4}$'
                 AND substr(season_key,6,4)::int = substr(season_key,1,4)::int + 1),
  hard_cap   integer NOT NULL DEFAULT 500 CHECK (hard_cap = 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, season_key)                       -- BR-02: one edition per player per season
);

CREATE TABLE issuance_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id    uuid NOT NULL REFERENCES editions(id),
  version       integer NOT NULL CHECK (version >= 1),
  planned_total integer NOT NULL CHECK (planned_total BETWEEN 0 AND 500),
  status        programme_status NOT NULL DEFAULT 'DRAFT',
  change_reason text,
  approved_by   uuid REFERENCES users(id),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, version)
);
-- At most one live (published) programme version per edition.
CREATE UNIQUE INDEX issuance_programs_one_published ON issuance_programs(edition_id) WHERE status = 'PUBLISHED';

-- BR-04: a new version of a published programme may not increase the total
-- and a reduction needs a reason.
CREATE FUNCTION check_programme_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev integer;
BEGIN
  SELECT planned_total INTO prev FROM issuance_programs
   WHERE edition_id = NEW.edition_id AND status IN ('PUBLISHED','COMPLETED') AND id <> NEW.id
   ORDER BY version DESC LIMIT 1;
  IF prev IS NOT NULL THEN
    IF NEW.planned_total > prev THEN
      RAISE EXCEPTION 'published programme cannot be increased (% -> %)', prev, NEW.planned_total
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.planned_total < prev AND coalesce(trim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'programme reduction requires a reason' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issuance_programs_version_check BEFORE INSERT OR UPDATE OF planned_total ON issuance_programs
  FOR EACH ROW EXECUTE FUNCTION check_programme_version();

CREATE TABLE cards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id     uuid NOT NULL REFERENCES editions(id),
  player_id      uuid NOT NULL REFERENCES players(id),
  serial_number  integer NOT NULL CHECK (serial_number BETWEEN 1 AND 500), -- AT-06
  status         card_status NOT NULL DEFAULT 'PLATFORM_INVENTORY',
  owner_user_id  uuid REFERENCES users(id),
  cost_basis_cents bigint CHECK (cost_basis_cents IS NULL OR cost_basis_cents >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  UNIQUE (edition_id, serial_number),
  -- A card has exactly one owner when owned, and none while it is platform stock.
  CHECK ((status = 'OWNED') = (owner_user_id IS NOT NULL)),
  CHECK (status <> 'OWNED' OR cost_basis_cents IS NOT NULL)
);
CREATE INDEX cards_owner_idx ON cards(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX cards_player_idx ON cards(player_id);

-- Card player must match the edition player.
CREATE FUNCTION check_card_player() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM editions e WHERE e.id = NEW.edition_id AND e.player_id = NEW.player_id) THEN
    RAISE EXCEPTION 'card player does not match edition player' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cards_player_check BEFORE INSERT OR UPDATE OF edition_id, player_id ON cards
  FOR EACH ROW EXECUTE FUNCTION check_card_player();

-- No card beyond the published programme (BR-04, "geen verborgen verhoging").
CREATE FUNCTION check_card_within_programme() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE planned integer;
BEGIN
  SELECT planned_total INTO planned FROM issuance_programs
   WHERE edition_id = NEW.edition_id AND status = 'PUBLISHED';
  IF planned IS NULL THEN
    RAISE EXCEPTION 'no published programme for edition' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.serial_number > planned THEN
    RAISE EXCEPTION 'serial % exceeds published programme %', NEW.serial_number, planned
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cards_programme_check BEFORE INSERT ON cards
  FOR EACH ROW EXECUTE FUNCTION check_card_within_programme();

CREATE TABLE ownership_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           uuid NOT NULL REFERENCES cards(id),
  previous_owner_id uuid REFERENCES users(id),
  new_owner_id      uuid REFERENCES users(id),
  cause             text NOT NULL CHECK (cause IN ('PRIMARY_DELIVERY','SECONDARY_SETTLEMENT','INCIDENT_CORRECTION')),
  execution_id      uuid,
  allocation_id     uuid,
  cost_basis_cents  bigint,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  -- Definitive ownership requires a linked successful settlement (invariant, docs/09).
  CHECK (cause <> 'SECONDARY_SETTLEMENT' OR execution_id IS NOT NULL),
  CHECK (cause <> 'PRIMARY_DELIVERY' OR allocation_id IS NOT NULL)
);
CREATE TRIGGER ownership_events_append_only BEFORE UPDATE OR DELETE ON ownership_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE drops (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id         uuid NOT NULL REFERENCES editions(id),
  round              integer NOT NULL DEFAULT 1 CHECK (round IN (1, 2)),
  price_cents        bigint NOT NULL CHECK (price_cents BETWEEN 20 AND 1000000),
  quantity           integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  max_per_user       integer NOT NULL CHECK (max_per_user BETWEEN 1 AND 3),
  publishes_at       timestamptz NOT NULL,
  price_fixed_at     timestamptz,
  opens_at           timestamptz NOT NULL,
  closes_at          timestamptz NOT NULL,
  status             drop_status NOT NULL DEFAULT 'DRAFT',
  reference_run_id   uuid REFERENCES valuation_runs(id),
  seed_commitment    text,               -- SHA-256 hex, registered before opening (BR-11)
  seed_ciphertext    bytea,              -- encrypted seed; revealed only after allocation
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CHECK (opens_at < closes_at),
  CHECK (publishes_at <= opens_at),
  CHECK (round = 1 AND max_per_user = 1 OR round = 2),
  CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED','POSTPONED') OR seed_commitment IS NOT NULL)
);

CREATE TABLE drop_cards (
  drop_id uuid NOT NULL REFERENCES drops(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  PRIMARY KEY (drop_id, card_id)
);
-- A card can be offered in only one drop.
CREATE UNIQUE INDEX drop_cards_card_unique ON drop_cards(card_id);

CREATE TABLE subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id       uuid NOT NULL REFERENCES drops(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  quantity      integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 3),
  hold_id       uuid,
  status        subscription_status NOT NULL DEFAULT 'RESERVATION_PENDING',
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  version       integer NOT NULL DEFAULT 1,
  UNIQUE (drop_id, user_id),                          -- SUBSCRIPTION_EXISTS
  CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

CREATE TABLE allocation_snapshots (
  drop_id              uuid PRIMARY KEY REFERENCES drops(id),  -- one frozen snapshot per drop
  algorithm_version    text NOT NULL,
  seed_commitment      text NOT NULL,
  participants_digest  text NOT NULL,
  participant_ids      uuid[] NOT NULL,
  available_cards      integer NOT NULL CHECK (available_cards >= 0),
  result_digest        text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER allocation_snapshots_append_only BEFORE UPDATE OR DELETE ON allocation_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id           uuid NOT NULL REFERENCES allocation_snapshots(drop_id),
  rank              integer NOT NULL CHECK (rank >= 1),
  subscription_id   uuid NOT NULL REFERENCES subscriptions(id),
  card_id           uuid REFERENCES cards(id),
  status            allocation_status NOT NULL DEFAULT 'ALLOCATED',
  algorithm_version text NOT NULL,
  allocated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drop_id, rank),
  UNIQUE (drop_id, subscription_id)
);
-- AT-26: never two live allocations for the same card.
CREATE UNIQUE INDEX allocations_one_live_per_card ON allocations(card_id)
  WHERE status IN ('ALLOCATED','SETTLEMENT_PENDING','DELIVERED','MANUAL_REVIEW');

-- ---------------------------------------------------------------------------
-- Trading
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_market_id   uuid NOT NULL REFERENCES player_markets(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  side               order_side NOT NULL,
  limit_price_cents  bigint NOT NULL CHECK (limit_price_cents BETWEEN 20 AND 1000000),
  time_in_force      time_in_force NOT NULL,
  state              order_state NOT NULL DEFAULT 'PENDING_HOLD',
  priority_sequence  bigint,
  qty_original       integer NOT NULL CHECK (qty_original BETWEEN 1 AND 500),
  qty_open           integer NOT NULL CHECK (qty_open >= 0),
  qty_pending        integer NOT NULL DEFAULT 0 CHECK (qty_pending >= 0),
  qty_filled         integer NOT NULL DEFAULT 0 CHECK (qty_filled >= 0),
  qty_cancelled      integer NOT NULL DEFAULT 0 CHECK (qty_cancelled >= 0),
  qty_expired        integer NOT NULL DEFAULT 0 CHECK (qty_expired >= 0),
  -- Cumulative commission per sell order (BR-20)
  settled_gross_cents      bigint NOT NULL DEFAULT 0 CHECK (settled_gross_cents >= 0),
  booked_commission_cents  bigint NOT NULL DEFAULT 0 CHECK (booked_commission_cents >= 0),
  commission_bps     integer NOT NULL DEFAULT 500 CHECK (commission_bps BETWEEN 0 AND 10000),
  accepted_at        timestamptz,
  expires_at         timestamptz,
  replaces_order_id  uuid REFERENCES orders(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CHECK (qty_open + qty_pending + qty_filled + qty_cancelled + qty_expired = qty_original),
  CHECK (side = 'SELL' OR booked_commission_cents = 0),
  CHECK (state = 'PENDING_HOLD' OR state = 'REJECTED' OR (accepted_at IS NOT NULL AND expires_at IS NOT NULL AND priority_sequence IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at - accepted_at IN (interval '24 hours', interval '168 hours', interval '720 hours'))
);
CREATE UNIQUE INDEX orders_priority_unique ON orders(player_market_id, priority_sequence) WHERE priority_sequence IS NOT NULL;
CREATE INDEX orders_book_idx ON orders(player_market_id, side, limit_price_cents, priority_sequence) WHERE state = 'ACTIVE' AND qty_open > 0;
CREATE INDEX orders_user_idx ON orders(user_id, created_at DESC);

CREATE TABLE order_cards (
  order_id   uuid NOT NULL REFERENCES orders(id),
  card_id    uuid NOT NULL REFERENCES cards(id),
  active     boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  PRIMARY KEY (order_id, card_id),
  CHECK (active OR released_at IS NOT NULL)
);
-- AT-13: one card can be in only one active sell reservation.
CREATE UNIQUE INDEX order_cards_one_active_per_card ON order_cards(card_id) WHERE active;

CREATE TABLE executions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_market_id   uuid NOT NULL REFERENCES player_markets(id),
  buy_order_id       uuid NOT NULL REFERENCES orders(id),
  sell_order_id      uuid NOT NULL REFERENCES orders(id),
  card_id            uuid NOT NULL REFERENCES cards(id),
  buyer_user_id      uuid NOT NULL REFERENCES users(id),
  seller_user_id     uuid NOT NULL REFERENCES users(id),
  price_cents        bigint NOT NULL CHECK (price_cents BETWEEN 20 AND 1000000),
  buyer_limit_cents  bigint NOT NULL,
  fee_cents          bigint CHECK (fee_cents IS NULL OR fee_cents >= 0),
  status             execution_status NOT NULL DEFAULT 'MATCHED',
  matched_at         timestamptz NOT NULL DEFAULT now(),
  settled_at         timestamptz,
  version            integer NOT NULL DEFAULT 1,
  CHECK (buyer_user_id <> seller_user_id),                      -- BR-17
  CHECK (price_cents <= buyer_limit_cents),
  CHECK ((status = 'SETTLED') = (settled_at IS NOT NULL)),
  CHECK (status <> 'SETTLED' OR fee_cents IS NOT NULL)
);
-- AT-07 / AT-21: a card can be in at most one unresolved execution.
CREATE UNIQUE INDEX executions_one_open_per_card ON executions(card_id)
  WHERE status IN ('MATCHED','SUBMISSION_PENDING','PROVIDER_PENDING','MANUAL_REVIEW');
-- A-10 / BR-21: at most one unresolved external settlement per player market.
CREATE UNIQUE INDEX executions_one_inflight_per_market ON executions(player_market_id)
  WHERE status IN ('MATCHED','SUBMISSION_PENDING','PROVIDER_PENDING','MANUAL_REVIEW');
CREATE INDEX executions_public_trades_idx ON executions(player_market_id, settled_at DESC) WHERE status = 'SETTLED';

CREATE TABLE settlement_operations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type               text NOT NULL CHECK (type IN ('HOLD','RELEASE','SECONDARY_SETTLEMENT','PRIMARY_SETTLEMENT','DEPOSIT','WITHDRAWAL')),
  idempotency_key    text NOT NULL UNIQUE,          -- stable key reused on every retry
  execution_id       uuid REFERENCES executions(id),
  allocation_id      uuid REFERENCES allocations(id),
  provider           text NOT NULL,
  provider_reference text,
  amount_cents       bigint NOT NULL CHECK (amount_cents >= 0),
  status             operation_status NOT NULL DEFAULT 'CREATED',
  attempts           integer NOT NULL DEFAULT 0,
  financially_processed_at timestamptz,             -- set exactly once (invariant)
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (provider, provider_reference)
);

CREATE TABLE idempotency_requests (
  actor_id      uuid NOT NULL,
  endpoint      text NOT NULL,
  key           text NOT NULL,
  request_hash  text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, endpoint, key)
);

CREATE TABLE outbox_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        text NOT NULL,
  aggregate_id uuid,
  dedupe_key   text NOT NULL UNIQUE,
  payload      jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events(available_at) WHERE processed_at IS NULL;

CREATE TABLE inbox_events (
  provider          text NOT NULL,
  external_event_id text NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  payload           jsonb NOT NULL,
  signature_valid   boolean NOT NULL,
  processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  processed_at      timestamptz,
  PRIMARY KEY (provider, external_event_id)          -- AT-10: duplicate webhook stored once
);

-- ---------------------------------------------------------------------------
-- Money: double-entry ledger
-- ---------------------------------------------------------------------------
CREATE TABLE payment_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status              text NOT NULL CHECK (status IN ('PENDING','ACTIVE','RESTRICTED','CLOSED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE ledger_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       ledger_account_type NOT NULL,
  owner_user_id uuid REFERENCES users(id),        -- null for platform accounts
  currency   char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  -- Projection, updated in the same transaction as the journal (docs/05).
  balance_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1,
  UNIQUE NULLS NOT DISTINCT (type, owner_user_id, currency),
  -- Customer cash buckets can never be negative through normal flows.
  CHECK (type NOT IN ('CUSTOMER_AVAILABLE','CUSTOMER_RESERVED','PENDING_SETTLEMENT','PENDING_WITHDRAWAL','CUSTOMER_PENDING_INCOMING') OR balance_cents >= 0),
  CHECK ((type IN ('CUSTOMER_AVAILABLE','CUSTOMER_RESERVED','CUSTOMER_RECEIVABLE','CUSTOMER_PENDING_INCOMING')) = (owner_user_id IS NOT NULL)
         OR type IN ('PENDING_SETTLEMENT','PENDING_WITHDRAWAL'))
);

CREATE TABLE journal_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_event_id  text NOT NULL UNIQUE,         -- one financial processing per event
  kind               text NOT NULL,
  source             text NOT NULL,
  reverses_entry_id  uuid REFERENCES journal_entries(id),
  environment        environment_mode NOT NULL,
  memo               text,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE journal_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  uuid NOT NULL REFERENCES journal_entries(id),
  ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  side              journal_side NOT NULL,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  currency          char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR')
);
CREATE INDEX journal_lines_entry_idx ON journal_lines(journal_entry_id);
CREATE INDEX journal_lines_account_idx ON journal_lines(ledger_account_id);
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Every entry balances per currency at commit time (deferred).
CREATE FUNCTION check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE diff bigint; n integer;
BEGIN
  SELECT coalesce(sum(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0), count(*)
    INTO diff, n
    FROM journal_lines WHERE journal_entry_id = NEW.journal_entry_id;
  IF n < 2 OR diff <> 0 THEN
    RAISE EXCEPTION 'journal entry % not balanced (lines %, diff %)', NEW.journal_entry_id, n, diff
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Balance projection: liability-style accounts (customer money, clearing)
-- increase on CREDIT; asset-style accounts increase on DEBIT.
CREATE FUNCTION apply_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acct_type ledger_account_type; delta bigint;
BEGIN
  SELECT type INTO acct_type FROM ledger_accounts WHERE id = NEW.ledger_account_id FOR UPDATE;
  IF acct_type IN ('PSP_SETTLEMENT_ASSET','CUSTOMER_RECEIVABLE','PLATFORM_LOSS') THEN
    delta := CASE WHEN NEW.side = 'DEBIT' THEN NEW.amount_cents ELSE -NEW.amount_cents END;
  ELSE
    delta := CASE WHEN NEW.side = 'CREDIT' THEN NEW.amount_cents ELSE -NEW.amount_cents END;
  END IF;
  UPDATE ledger_accounts SET balance_cents = balance_cents + delta, version = version + 1
   WHERE id = NEW.ledger_account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_lines_apply AFTER INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION apply_journal_line();

CREATE TABLE cash_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  purpose       text NOT NULL CHECK (purpose IN ('BUY_ORDER','SUBSCRIPTION','WITHDRAWAL')),
  order_id      uuid REFERENCES orders(id),
  subscription_id uuid REFERENCES subscriptions(id),
  withdrawal_id uuid,
  confirmed_amount_cents bigint NOT NULL DEFAULT 0 CHECK (confirmed_amount_cents >= 0),
  requested_amount_cents bigint NOT NULL CHECK (requested_amount_cents > 0),
  status        hold_status NOT NULL DEFAULT 'PENDING',
  operation_id  uuid REFERENCES settlement_operations(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  version       integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(order_id, subscription_id, withdrawal_id) = 1),
  CHECK (confirmed_amount_cents <= requested_amount_cents)
);
CREATE UNIQUE INDEX cash_holds_one_per_order ON cash_holds(order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX cash_holds_one_per_subscription ON cash_holds(subscription_id) WHERE subscription_id IS NOT NULL;

CREATE TABLE deposits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  amount_cents       bigint NOT NULL CHECK (amount_cents > 0),
  provider           text NOT NULL,
  provider_reference text,
  status             text NOT NULL CHECK (status IN ('INITIATED','PENDING','CONFIRMED','FAILED','REVERSED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_at       timestamptz,
  UNIQUE (provider, provider_reference),
  CHECK ((status = 'CONFIRMED') <= (confirmed_at IS NOT NULL))
);

CREATE TABLE withdrawals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  amount_cents       bigint NOT NULL CHECK (amount_cents > 0),
  payment_account_id uuid NOT NULL REFERENCES payment_accounts(id),
  status             text NOT NULL CHECK (status IN ('REQUESTED','HELD','SUBMITTED','PENDING','PAID','FAILED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE TABLE customer_receivables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  cause         text NOT NULL CHECK (cause IN ('CHARGEBACK','INCIDENT')),
  incident_ref  text NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED','WRITTEN_OFF')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL,
  as_of       timestamptz NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('RUNNING','MATCHED','BREAKS_FOUND','FAILED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_breaks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES reconciliation_runs(id),
  difference_cents bigint NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('INFO','MATERIAL')),
  owner_id    uuid REFERENCES users(id),
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED')),
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- "Een beheerder kan een verschil niet alleen wegklikken."
  CHECK (status <> 'RESOLVED' OR severity <> 'MATERIAL'
         OR (resolution_note IS NOT NULL AND resolved_by IS NOT NULL AND approved_by IS NOT NULL AND approved_by <> resolved_by))
);

-- ---------------------------------------------------------------------------
-- Administration and audit
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  key         text PRIMARY KEY,
  description text NOT NULL
);
INSERT INTO roles(key, description) VALUES
  ('SUPPORT', 'Support'),
  ('CATALOG_MANAGER', 'Catalog manager'),
  ('ISSUANCE_OPERATOR', 'Issuance operator'),
  ('VALUATION_ANALYST', 'Valuation analyst'),
  ('FINANCE_OPERATOR', 'Finance operator'),
  ('APPROVER', 'Approver'),
  ('SUPERADMIN', 'Superadmin');

CREATE TABLE permissions (
  key         text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_key       text NOT NULL REFERENCES roles(key),
  permission_key text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id),
  role_key   text NOT NULL REFERENCES roles(key),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_key)
);

CREATE TABLE admin_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type   text NOT NULL,
  payload       jsonb NOT NULL,
  payload_hash  text NOT NULL,                     -- sha256 of canonical action + payload
  requested_by  uuid NOT NULL REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  status        text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','EXECUTED','INVALIDATED')),
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)   -- no self-approval
);

-- AT-34: an approval binds to the exact payload; changing it invalidates.
CREATE FUNCTION bind_approval_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload_hash <> encode(digest(NEW.action_type || '|' || NEW.payload::text, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'approval payload hash mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.payload IS DISTINCT FROM OLD.payload OR NEW.action_type IS DISTINCT FROM OLD.action_type) THEN
    RAISE EXCEPTION 'approved action payload cannot change; create a new approval' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_approvals_bind BEFORE INSERT OR UPDATE ON admin_approvals
  FOR EACH ROW EXECUTE FUNCTION bind_approval_payload();

CREATE TABLE audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid,
  actor_kind   text NOT NULL CHECK (actor_kind IN ('USER','ADMIN','SYSTEM','PROVIDER')),
  action       text NOT NULL,
  reason       text,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  related      jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id   text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  -- AT-33: admin actions carry actor and reason.
  CHECK (actor_kind <> 'ADMIN' OR (actor_id IS NOT NULL AND coalesce(trim(reason), '') <> ''))
);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE feature_gates (
  key          text PRIMARY KEY,
  description  text NOT NULL,
  evidence_ref text,
  approval_id  uuid REFERENCES admin_approvals(id),
  satisfied    boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- A gate is only satisfied with evidence and an approved, second-person decision.
  CHECK (NOT satisfied OR (evidence_ref IS NOT NULL AND approval_id IS NOT NULL))
);
INSERT INTO feature_gates(key, description) VALUES
  ('LEGAL', 'Juridisch: beoordeling product, klantlanden en toelating'),
  ('CONTRACTS', 'Kaartvoorwaarden, privacy en overeenkomsten'),
  ('PAYMENTS', 'Schriftelijke provideracceptatie en geverifieerde geldstromen'),
  ('DATA', 'Commerciele rechten voor data en afgeleide waardes'),
  ('IMAGERY', 'Rechten voor gebruikte foto''s en merken'),
  ('PLAYER_IDENTITY', 'Spelersidentiteit: namen en persoonlijkheidskenmerken (O-10)'),
  ('VALUATION', 'Gevalideerde en goedgekeurde modelversie'),
  ('ENGINEERING', 'Kern-, concurrentie- en hersteltests geslaagd'),
  ('SECURITY', 'Kritieke en hoge bevindingen opgelost'),
  ('OPERATIONS', 'Eigenaren, klachtenpad, incidentproces, afwikkelingsplan');

CREATE TABLE notification_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  template    text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('IN_APP','EMAIL')),
  dedupe_key  text NOT NULL UNIQUE,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notification_outbox(id),
  provider        text NOT NULL,
  status          text NOT NULL CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED')),
  attempted_at    timestamptz NOT NULL DEFAULT now()
);

-- Single-row environment marker. Production mode with demo adapters is
-- refused at startup by the app (AT-35); the DB records which mode it belongs to.
CREATE TABLE environment_marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode      environment_mode NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
