-- Fase 4: ledger and payments demo.
-- - Platform ledger accounts.
-- - Deposits/withdrawals linked to their provider operation.
-- - Cash holds track consumed and released amounts (partial fills, fase 5).
-- - Reconciliation breaks can point at a user and an operation.
-- - psp_sim: a simulated payment provider in its own schema. It stands in for
--   an external system (O-02). Production refuses the demo adapter (AT-35).

BEGIN;

-- ---------------------------------------------------------------------------
-- Platform accounts (one each, owner NULL)
-- ---------------------------------------------------------------------------
INSERT INTO ledger_accounts(type, owner_user_id) VALUES
  ('PSP_SETTLEMENT_ASSET', NULL),
  ('PLATFORM_FEE_CLEARING', NULL),
  ('PRIMARY_REVENUE_CLEARING', NULL),
  ('PLATFORM_LOSS', NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Deposits and withdrawals
-- ---------------------------------------------------------------------------
ALTER TABLE deposits
  ADD COLUMN operation_id uuid REFERENCES settlement_operations(id),
  ADD COLUMN failure_reason text,
  ADD COLUMN redirect_url text,
  ADD COLUMN pending_since timestamptz;
CREATE INDEX deposits_user_idx ON deposits(user_id, created_at DESC);

ALTER TABLE withdrawals
  ADD COLUMN operation_id uuid REFERENCES settlement_operations(id),
  ADD COLUMN failure_reason text;
CREATE INDEX withdrawals_user_idx ON withdrawals(user_id, created_at DESC);
-- A paid or failed withdrawal is final.
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_completed_at CHECK ((status IN ('PAID','FAILED')) = (completed_at IS NOT NULL));

ALTER TABLE payment_accounts ADD COLUMN display_ref text; -- masked, e.g. "NL•• •••• 4321"

-- ---------------------------------------------------------------------------
-- Cash holds: consumed + released never exceed the confirmed amount
-- ---------------------------------------------------------------------------
ALTER TABLE cash_holds
  ADD COLUMN consumed_amount_cents bigint NOT NULL DEFAULT 0 CHECK (consumed_amount_cents >= 0),
  ADD COLUMN released_amount_cents bigint NOT NULL DEFAULT 0 CHECK (released_amount_cents >= 0),
  ADD CONSTRAINT cash_holds_balance CHECK (consumed_amount_cents + released_amount_cents <= confirmed_amount_cents);

-- ---------------------------------------------------------------------------
-- Settlement operations: when the money effect was booked
-- ---------------------------------------------------------------------------
ALTER TABLE settlement_operations
  ADD COLUMN user_id uuid REFERENCES users(id),
  ADD COLUMN outcome_known_at timestamptz;
CREATE INDEX settlement_operations_open_idx ON settlement_operations(status) WHERE status IN ('CREATED','SUBMITTED','PENDING','UNKNOWN');

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
ALTER TABLE reconciliation_breaks
  ADD COLUMN kind text NOT NULL DEFAULT 'AMOUNT' CHECK (kind IN ('AMOUNT','STATUS','MISSING_IN_LEDGER','MISSING_AT_PROVIDER','PROJECTION')),
  ADD COLUMN user_id uuid REFERENCES users(id),
  ADD COLUMN operation_id uuid REFERENCES settlement_operations(id),
  ADD COLUMN detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What the break is about (e.g. "op:<id>:status"); a rerun does not open the same break twice.
  ADD COLUMN fingerprint text NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN resolved_at timestamptz;
CREATE INDEX reconciliation_breaks_open_idx ON reconciliation_breaks(user_id) WHERE status <> 'RESOLVED';
CREATE UNIQUE INDEX reconciliation_breaks_one_open ON reconciliation_breaks(fingerprint) WHERE status <> 'RESOLVED';
ALTER TABLE reconciliation_runs ADD COLUMN finished_at timestamptz, ADD COLUMN summary jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Projection check: each account balance equals the sum of its journal lines.
CREATE VIEW ledger_projection_mismatches AS
SELECT a.id AS account_id, a.type, a.owner_user_id, a.balance_cents,
       coalesce(sum(CASE
         WHEN a.type IN ('PSP_SETTLEMENT_ASSET','CUSTOMER_RECEIVABLE','PLATFORM_LOSS')
           THEN CASE WHEN l.side = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
         ELSE CASE WHEN l.side = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END END), 0) AS journal_balance
  FROM ledger_accounts a LEFT JOIN journal_lines l ON l.ledger_account_id = a.id
 GROUP BY a.id
HAVING a.balance_cents <> coalesce(sum(CASE
         WHEN a.type IN ('PSP_SETTLEMENT_ASSET','CUSTOMER_RECEIVABLE','PLATFORM_LOSS')
           THEN CASE WHEN l.side = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
         ELSE CASE WHEN l.side = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END END), 0);

INSERT INTO permissions(key, description) VALUES ('finance.reconcile', 'Reconciliatie draaien en verschillen behandelen')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key, permission_key) VALUES ('FINANCE_OPERATOR', 'finance.reconcile') ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Simulated payment provider (demo only)
-- ---------------------------------------------------------------------------
CREATE SCHEMA psp_sim;

CREATE TABLE psp_sim.operations (
  idempotency_key text PRIMARY KEY,
  reference       text NOT NULL UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('DEPOSIT','HOLD','RELEASE','SETTLE','PAYOUT')),
  account_ref     text NOT NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents >= 0),
  status          text NOT NULL CHECK (status IN ('AWAITING_CUSTOMER','PENDING','SUCCEEDED','FAILED')),
  scenario        text NOT NULL,
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolve_after   timestamptz,
  resolved_at     timestamptz
);

-- Webhook events the simulator will deliver (possibly more than once).
CREATE TABLE psp_sim.events (
  id            bigserial PRIMARY KEY,
  event_id      text NOT NULL,
  reference     text NOT NULL REFERENCES psp_sim.operations(reference),
  payload       jsonb NOT NULL,
  deliver_after timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0
);
CREATE INDEX psp_sim_events_due ON psp_sim.events(deliver_after) WHERE delivered_at IS NULL;

-- The simulator's own view of money it holds for the platform.
CREATE VIEW psp_sim.balance AS
SELECT coalesce(sum(CASE WHEN kind = 'DEPOSIT' THEN amount_cents WHEN kind = 'PAYOUT' THEN -amount_cents ELSE 0 END), 0) AS settled_cents
  FROM psp_sim.operations WHERE status = 'SUCCEEDED';

COMMIT;
