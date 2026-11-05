-- Database constraint tests. Run against a fresh database with
-- packages/db/migrations applied:  pnpm db:test  (or scripts/test-db.sh).
-- Each block either asserts a value or asserts that a statement is refused.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok   - refused: % [%]', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL - statement was accepted but should be refused: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL - %', label; END IF;
  RAISE NOTICE 'ok   - %', label;
END $$;

SET client_min_messages = notice;

BEGIN;

-- Fixture ------------------------------------------------------------------
INSERT INTO users(id, auth_subject) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'demo:anna'),
  ('00000000-0000-0000-0000-00000000000b', 'demo:bram'),
  ('00000000-0000-0000-0000-00000000000c', 'demo:admin1'),
  ('00000000-0000-0000-0000-00000000000d', 'demo:admin2');
INSERT INTO players(id, display_name, is_fictional) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Noah Vermeer', true);
INSERT INTO player_markets(id, player_id, status) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'OPEN');
INSERT INTO editions(id, player_id, season_key) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-2027');
INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at, is_opening_balance) VALUES
  ('30000000-0000-0000-0000-000000000001', 1, 500, 'PUBLISHED', now(), true);
INSERT INTO cards(edition_id, player_id, serial_number)
  SELECT '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', g FROM generate_series(1, 500) g;

-- Identity and editions -------------------------------------------------------
SELECT pg_temp.expect_error($$INSERT INTO editions(player_id, season_key) VALUES ('10000000-0000-0000-0000-000000000001', '2026-2027')$$,
  'BR-02 second edition for the same player and season');
SELECT pg_temp.expect_error($$INSERT INTO editions(player_id, season_key) VALUES ('10000000-0000-0000-0000-000000000001', '2026-2028')$$,
  'BR-02 malformed season key');
SELECT pg_temp.expect_error($$INSERT INTO player_markets(player_id) VALUES ('10000000-0000-0000-0000-000000000001')$$,
  'PRD-05 second market for the same player');
SELECT pg_temp.expect_error($$INSERT INTO provider_player_mappings VALUES ('fixture','ext-1','10000000-0000-0000-0000-000000000001'), ('fixture','ext-1','10000000-0000-0000-0000-000000000001')$$,
  'AT-02 duplicate provider mapping');

-- Cap -------------------------------------------------------------------------
SELECT pg_temp.expect((SELECT count(*) FROM cards) = 500, 'AT-06 500 cards created for the edition');
SELECT pg_temp.expect_error($$INSERT INTO cards(edition_id, player_id, serial_number) VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', 501)$$,
  'AT-06 the 501st card of the same player/edition');
SELECT pg_temp.expect_error($$INSERT INTO cards(edition_id, player_id, serial_number) VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', 7)$$,
  'duplicate serial number within an edition');
SELECT pg_temp.expect_error($$WITH e AS (INSERT INTO editions(player_id, season_key) VALUES ('10000000-0000-0000-0000-000000000001', '2027-2028') RETURNING id)
  INSERT INTO issuance_programs(edition_id, version, planned_total, status) SELECT id, 1, 501, 'DRAFT' FROM e$$,
  'BR-03 programme above 500 for a fresh edition');
SELECT pg_temp.expect_error($$INSERT INTO issuance_programs(edition_id, version, planned_total, status) VALUES ('30000000-0000-0000-0000-000000000001', 2, 499 + 2, 'DRAFT')$$,
  'BR-04 published programme cannot be increased');
SELECT pg_temp.expect_error($$INSERT INTO issuance_programs(edition_id, version, planned_total, status, change_reason) VALUES ('30000000-0000-0000-0000-000000000001', 2, 450, 'DRAFT', '')$$,
  'BR-04 reduction without a reason');

-- Ownership -----------------------------------------------------------------
SELECT pg_temp.expect_error($$UPDATE cards SET status = 'OWNED' WHERE serial_number = 1$$,
  'owned card without an owner');
UPDATE cards SET status = 'OWNED', owner_user_id = '00000000-0000-0000-0000-00000000000a', cost_basis_cents = 580
  WHERE serial_number IN (1, 2, 3);
UPDATE cards SET status = 'OWNED', owner_user_id = '00000000-0000-0000-0000-00000000000b', cost_basis_cents = 600
  WHERE serial_number IN (4);
INSERT INTO ownership_events(card_id, new_owner_id, cause, reference, cost_basis_cents)
  SELECT id, owner_user_id, 'OPENING_BALANCE', 'constraint-test', cost_basis_cents FROM cards WHERE status = 'OWNED';
SELECT pg_temp.expect_error($$INSERT INTO ownership_events(card_id, new_owner_id, cause) SELECT id, '00000000-0000-0000-0000-00000000000a', 'SECONDARY_SETTLEMENT' FROM cards WHERE serial_number = 1$$,
  'ownership change without a linked settlement');

-- Orders --------------------------------------------------------------------
INSERT INTO orders(id, player_market_id, user_id, side, limit_price_cents, time_in_force, state, priority_sequence, qty_original, qty_open, accepted_at, expires_at)
VALUES
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'SELL', 600, 'SEVEN_DAYS', 'ACTIVE', 1, 1, 1, now(), now() + interval '168 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'BUY', 620, 'ONE_DAY', 'ACTIVE', 2, 2, 2, now(), now() + interval '24 hours');
SELECT pg_temp.expect_error($$INSERT INTO orders(player_market_id, user_id, side, limit_price_cents, time_in_force, state, priority_sequence, qty_original, qty_open, accepted_at, expires_at)
  VALUES ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'BUY', 600, 'ONE_DAY', 'ACTIVE', 3, 1, 1, now(), now() + interval '48 hours')$$,
  'AT-37 expiry other than 24/168/720 hours');
SELECT pg_temp.expect_error($$INSERT INTO orders(player_market_id, user_id, side, limit_price_cents, time_in_force, qty_original, qty_open) VALUES ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'BUY', 19, 'ONE_DAY', 1, 1)$$,
  'BR-19 limit below €0,20');
SELECT pg_temp.expect_error($$UPDATE orders SET qty_open = 0 WHERE id = '40000000-0000-0000-0000-000000000002'$$,
  'order quantity buckets must add up to the original');
SELECT pg_temp.expect_error($$INSERT INTO orders(player_market_id, user_id, side, limit_price_cents, time_in_force, state, priority_sequence, qty_original, qty_open, accepted_at, expires_at)
  VALUES ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'BUY', 600, 'ONE_DAY', 'ACTIVE', 2, 1, 1, now(), now() + interval '24 hours')$$,
  'AT-15 priority sequence is unique per market');

INSERT INTO order_cards(order_id, card_id) SELECT '40000000-0000-0000-0000-000000000001', id FROM cards WHERE serial_number = 1;
INSERT INTO orders(id, player_market_id, user_id, side, limit_price_cents, time_in_force, state, priority_sequence, qty_original, qty_open, accepted_at, expires_at)
VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'SELL', 700, 'ONE_DAY', 'ACTIVE', 4, 1, 1, now(), now() + interval '24 hours');
SELECT pg_temp.expect_error($$INSERT INTO order_cards(order_id, card_id) SELECT '40000000-0000-0000-0000-000000000003', id FROM cards WHERE serial_number = 1$$,
  'AT-13 one card in two active sell orders');

-- Executions ------------------------------------------------------------------
INSERT INTO executions(id, player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents)
SELECT '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', id,
  '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 600, 620 FROM cards WHERE serial_number = 1;
SELECT pg_temp.expect_error($$INSERT INTO executions(player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents)
  SELECT '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 600, 620 FROM cards WHERE serial_number = 1$$,
  'AT-07/AT-21 a second open execution for the same card');
SELECT pg_temp.expect_error($$INSERT INTO executions(player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents)
  SELECT '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 600, 620 FROM cards WHERE serial_number = 2$$,
  'A-10 a second in-flight settlement in the same market');
SELECT pg_temp.expect_error($$INSERT INTO executions(player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents, status, settled_at, fee_cents)
  SELECT '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', id, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 600, 620, 'SETTLED', now(), 30 FROM cards WHERE serial_number = 2$$,
  'AT-17 self-trade execution');
SELECT pg_temp.expect_error($$UPDATE executions SET status = 'SETTLED', settled_at = now() WHERE id = '50000000-0000-0000-0000-000000000001'$$,
  'settled execution without a fee');
SELECT pg_temp.expect_error($$INSERT INTO executions(player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents, status, settled_at, fee_cents)
  SELECT '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 630, 620, 'SETTLED', now(), 32 FROM cards WHERE serial_number = 2$$,
  'execution above the buyer limit');

-- Idempotency and inbox ---------------------------------------------------------
INSERT INTO inbox_events(provider, external_event_id, payload, signature_valid) VALUES ('demo-psp', 'evt_1', '{}', true);
SELECT pg_temp.expect_error($$INSERT INTO inbox_events(provider, external_event_id, payload, signature_valid) VALUES ('demo-psp', 'evt_1', '{}', true)$$,
  'AT-10 duplicate webhook event');
INSERT INTO settlement_operations(type, idempotency_key, provider, amount_cents) VALUES ('DEPOSIT', 'dep-1', 'demo-psp', 10000);
SELECT pg_temp.expect_error($$INSERT INTO settlement_operations(type, idempotency_key, provider, amount_cents) VALUES ('DEPOSIT', 'dep-1', 'demo-psp', 10000)$$,
  'stable idempotency key used twice');

-- Ledger --------------------------------------------------------------------------
-- The platform PSP account exists from migration 0005; give it a fixed id for this test.
UPDATE ledger_accounts SET id = '60000000-0000-0000-0000-000000000001' WHERE type = 'PSP_SETTLEMENT_ASSET' AND owner_user_id IS NULL;
INSERT INTO ledger_accounts(id, type, owner_user_id) VALUES
  ('60000000-0000-0000-0000-00000000000a', 'CUSTOMER_AVAILABLE', '00000000-0000-0000-0000-00000000000b'),
  ('60000000-0000-0000-0000-00000000000b', 'CUSTOMER_RESERVED', '00000000-0000-0000-0000-00000000000b');
SELECT pg_temp.expect_error($$INSERT INTO ledger_accounts(type, owner_user_id) VALUES ('CUSTOMER_AVAILABLE', '00000000-0000-0000-0000-00000000000b')$$,
  'one ledger account per type/owner/currency');

COMMIT;

-- Balanced entry: deposit €100 -> customer available.
BEGIN;
INSERT INTO journal_entries(id, business_event_id, kind, source, environment) VALUES
  ('70000000-0000-0000-0000-000000000001', 'deposit:dep-1', 'DEPOSIT_CONFIRMED', 'test', 'demo');
INSERT INTO journal_lines(journal_entry_id, ledger_account_id, side, amount_cents) VALUES
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'DEBIT', 10000),
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-00000000000a', 'CREDIT', 10000);
COMMIT;
SELECT pg_temp.expect((SELECT balance_cents FROM ledger_accounts WHERE id = '60000000-0000-0000-0000-00000000000a') = 10000,
  'projection: customer available €100,00 after deposit');

-- Unbalanced entry is refused at commit.
DO $$
BEGIN
  BEGIN
    INSERT INTO journal_entries(id, business_event_id, kind, source, environment) VALUES
      ('70000000-0000-0000-0000-000000000002', 'bad:1', 'TEST', 'test', 'demo');
    INSERT INTO journal_lines(journal_entry_id, ledger_account_id, side, amount_cents) VALUES
      ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'DEBIT', 500),
      ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-00000000000a', 'CREDIT', 400);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'FAIL - unbalanced journal entry accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   - refused: unbalanced journal entry';
  END;
END $$;

SELECT pg_temp.expect_error($$INSERT INTO journal_entries(business_event_id, kind, source, environment) VALUES ('deposit:dep-1', 'DEPOSIT_CONFIRMED', 'test', 'demo')$$,
  'same business event processed financially twice');
SELECT pg_temp.expect_error($$UPDATE journal_lines SET amount_cents = 1$$, 'journal lines are append-only');
SELECT pg_temp.expect_error($$DELETE FROM journal_lines$$, 'journal lines cannot be deleted');

-- Reserve €12,40 for a buy order of 2 × €6,20 (exact money example, docs/09).
BEGIN;
INSERT INTO journal_entries(id, business_event_id, kind, source, environment) VALUES
  ('70000000-0000-0000-0000-000000000003', 'hold:order-2', 'BUY_HOLD', 'test', 'demo');
INSERT INTO journal_lines(journal_entry_id, ledger_account_id, side, amount_cents) VALUES
  ('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-00000000000a', 'DEBIT', 1240),
  ('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-00000000000b', 'CREDIT', 1240);
COMMIT;
SELECT pg_temp.expect((SELECT array_agg(balance_cents ORDER BY type) FROM ledger_accounts WHERE owner_user_id = '00000000-0000-0000-0000-00000000000b') = ARRAY[8760::bigint, 1240::bigint],
  'money example: available €87,60, reserved €12,40');

-- Overdrawing available is refused (AT-12).
DO $$
BEGIN
  BEGIN
    INSERT INTO journal_entries(id, business_event_id, kind, source, environment) VALUES
      ('70000000-0000-0000-0000-000000000004', 'hold:too-much', 'BUY_HOLD', 'test', 'demo');
    INSERT INTO journal_lines(journal_entry_id, ledger_account_id, side, amount_cents) VALUES
      ('70000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-00000000000a', 'DEBIT', 9000),
      ('70000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-00000000000b', 'CREDIT', 9000);
    RAISE EXCEPTION 'FAIL - available balance went negative';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   - refused: reservation beyond available balance';
  END;
END $$;

-- Audit and approvals ---------------------------------------------------------------
SELECT pg_temp.expect_error($$INSERT INTO audit_events(actor_kind, action, entity_type, entity_id) VALUES ('ADMIN', 'PAUSE_MARKET', 'player_market', 'x')$$,
  'AT-33 admin action without actor and reason');
INSERT INTO audit_events(actor_id, actor_kind, action, reason, entity_type, entity_id)
  VALUES ('00000000-0000-0000-0000-00000000000c', 'ADMIN', 'PAUSE_MARKET', 'Juridische blokkade', 'player_market', '20000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$DELETE FROM audit_events$$, 'audit log is append-only');

INSERT INTO admin_approvals(id, action_type, payload, payload_hash, requested_by, reason)
VALUES ('80000000-0000-0000-0000-000000000001', 'PUBLISH_PROGRAMME', '{"planned": 200}',
        encode(digest('PUBLISH_PROGRAMME|' || '{"planned": 200}'::jsonb::text, 'sha256'), 'hex'),
        '00000000-0000-0000-0000-00000000000c', 'Seizoensprogramma');
SELECT pg_temp.expect_error($$UPDATE admin_approvals SET approved_by = requested_by, status = 'APPROVED' WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  'self-approval of a sensitive action');
SELECT pg_temp.expect_error($$UPDATE admin_approvals SET payload = '{"planned": 300}' WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  'AT-34 changed approval payload with stale hash');
SELECT pg_temp.expect_error($$UPDATE admin_approvals SET payload = '{"planned": 300}',
    payload_hash = encode(digest('PUBLISH_PROGRAMME|' || '{"planned": 300}'::jsonb::text, 'sha256'), 'hex')
  WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  'AT-34 changed approval payload, even with a matching new hash');
UPDATE admin_approvals SET approved_by = '00000000-0000-0000-0000-00000000000d', status = 'APPROVED', decided_at = now()
  WHERE id = '80000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect((SELECT status FROM admin_approvals WHERE id = '80000000-0000-0000-0000-000000000001') = 'APPROVED',
  'second person can approve');

SELECT pg_temp.expect_error($$UPDATE feature_gates SET satisfied = true WHERE key = 'PAYMENTS'$$,
  'production gate cannot be ticked without evidence and approval');

-- Valuation visibility (AT-29) ----------------------------------------------------------
INSERT INTO valuation_model_versions(id, version_key, is_demo, parameters, code_version, status)
  VALUES ('90000000-0000-0000-0000-000000000001', 'demo-v0', true, '{}', 'test', 'APPROVED');
INSERT INTO valuation_runs(id, model_version_id, scope, data_version, information_as_of, status)
  VALUES ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'all', 'd1', now(), 'DRAFT');
INSERT INTO player_reference_values(player_id, run_id, amount_cents, confidence)
  VALUES ('10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 640, 'MEDIUM');
SELECT pg_temp.expect((SELECT count(*) FROM public_reference_values) = 0, 'AT-29 draft valuation is not public');
UPDATE valuation_runs SET status = 'PUBLISHED', published_at = now() WHERE id = '90000000-0000-0000-0000-000000000002';
SELECT pg_temp.expect((SELECT amount_cents FROM public_reference_values) = 640, 'published valuation becomes public');

-- Subscriptions and allocation --------------------------------------------------------------
INSERT INTO drops(id, edition_id, price_cents, quantity, max_per_user, publishes_at, opens_at, closes_at, status, seed_commitment)
  VALUES ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 600, 5, 1,
          '2026-11-05T17:00:00Z', '2026-11-10T08:00:00Z', '2026-11-10T20:00:00Z', 'OPEN', repeat('a', 64));
SELECT pg_temp.expect_error($$INSERT INTO drops(edition_id, price_cents, quantity, max_per_user, publishes_at, opens_at, closes_at, status)
  VALUES ('30000000-0000-0000-0000-000000000001', 600, 5, 1, now(), now() + interval '1 day', now() + interval '2 days', 'OPEN')$$,
  'BR-11 drop opened without a seed commitment');
SELECT pg_temp.expect_error($$INSERT INTO drops(edition_id, price_cents, quantity, max_per_user, publishes_at, opens_at, closes_at)
  VALUES ('30000000-0000-0000-0000-000000000001', 600, 5, 2, now(), now() + interval '1 day', now() + interval '2 days')$$,
  'A-07 first round allows one card per person');
INSERT INTO subscriptions(drop_id, user_id) VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a');
SELECT pg_temp.expect_error($$INSERT INTO subscriptions(drop_id, user_id) VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a')$$,
  'SUBSCRIPTION_EXISTS second subscription for the same drop');

-- Reconciliation ----------------------------------------------------------------------------------
INSERT INTO reconciliation_runs(id, scope, as_of, outcome) VALUES ('b0000000-0000-0000-0000-000000000001', 'daily', now(), 'BREAKS_FOUND');
INSERT INTO reconciliation_breaks(id, run_id, difference_cents, severity) VALUES ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 1500, 'MATERIAL');
SELECT pg_temp.expect_error($$UPDATE reconciliation_breaks SET status = 'RESOLVED', resolution_note = 'ok', resolved_by = '00000000-0000-0000-0000-00000000000c', approved_by = '00000000-0000-0000-0000-00000000000c'$$,
  'material break cannot be closed by one person');

-- Fase 3: ownership history and programme publication --------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE cards SET owner_user_id = '00000000-0000-0000-0000-00000000000b' WHERE serial_number = 2;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'FAIL - owner changed without ownership event';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   - refused: owner change without ownership event [%]', SQLERRM;
  END;
END $$;

BEGIN;
INSERT INTO ownership_events(card_id, previous_owner_id, new_owner_id, cause, reference, cost_basis_cents)
  SELECT id, owner_user_id, '00000000-0000-0000-0000-00000000000b', 'INCIDENT_CORRECTION', 'constraint-test', 580 FROM cards WHERE serial_number = 2;
UPDATE cards SET owner_user_id = '00000000-0000-0000-0000-00000000000b' WHERE serial_number = 2;
COMMIT;
SELECT pg_temp.expect((SELECT count(*) FROM card_ownership_mismatches) = 0, 'owner change together with event is accepted; no mismatches');

SELECT pg_temp.expect_error($$INSERT INTO ownership_events(card_id, new_owner_id, cause) SELECT id, owner_user_id, 'OPENING_BALANCE' FROM cards WHERE serial_number = 3$$,
  'opening balance without reference');

SELECT pg_temp.expect_error($$WITH e AS (INSERT INTO editions(player_id, season_key) VALUES ('10000000-0000-0000-0000-000000000001', '2028-2029') RETURNING id)
  INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at) SELECT id, 1, 200, 'PUBLISHED', now() FROM e$$,
  'programme published without approval');

SELECT pg_temp.expect_error($$UPDATE issuance_programs SET planned_total = 400, change_reason = 'te veel uitgegeven' WHERE edition_id = '30000000-0000-0000-0000-000000000001' AND status = 'PUBLISHED'$$,
  'published programme reduced below existing serial numbers');

-- Fase 4: payments and reconciliation ---------------------------------------
INSERT INTO cash_holds(id, user_id, purpose, order_id, requested_amount_cents, confirmed_amount_cents, status)
  SELECT '70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'BUY_ORDER', o.id, 1000, 1000, 'ACTIVE'
    FROM orders o WHERE o.user_id = '00000000-0000-0000-0000-00000000000a' AND NOT EXISTS (SELECT 1 FROM cash_holds h WHERE h.order_id = o.id) LIMIT 1;
SELECT pg_temp.expect_error($$UPDATE cash_holds SET consumed_amount_cents = 700, released_amount_cents = 400 WHERE id = '70000000-0000-0000-0000-000000000001'$$,
  'hold consumed + released above the held amount');

INSERT INTO payment_accounts(id, user_id, provider, provider_account_id, status) VALUES
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'demo', 'acct-anna-test', 'ACTIVE');
SELECT pg_temp.expect_error($$INSERT INTO withdrawals(user_id, amount_cents, payment_account_id, status) VALUES ('00000000-0000-0000-0000-00000000000a', 500, '71000000-0000-0000-0000-000000000001', 'PAID')$$,
  'paid withdrawal without completion time');
SELECT pg_temp.expect_error($$INSERT INTO deposits(user_id, amount_cents, provider, status) VALUES ('00000000-0000-0000-0000-00000000000a', 500, 'demo', 'CONFIRMED')$$,
  'confirmed deposit without confirmation time');
SELECT pg_temp.expect_error($$INSERT INTO inbox_events(provider, external_event_id, payload, signature_valid) VALUES ('demo', 'evt-1', '{}', true), ('demo', 'evt-1', '{}', true)$$,
  'the same webhook event stored twice (AT-10)');

INSERT INTO reconciliation_runs(id, scope, as_of, outcome) VALUES ('72000000-0000-0000-0000-000000000001', 'test', now(), 'BREAKS_FOUND');
INSERT INTO reconciliation_breaks(id, run_id, difference_cents, severity, fingerprint) VALUES
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 500, 'MATERIAL', 'test:break');
SELECT pg_temp.expect_error($$INSERT INTO reconciliation_breaks(run_id, difference_cents, severity, fingerprint) VALUES ('72000000-0000-0000-0000-000000000001', 500, 'MATERIAL', 'test:break')$$,
  'the same open break twice');
SELECT pg_temp.expect_error($$UPDATE reconciliation_breaks SET status = 'RESOLVED', resolution_note = 'weg', resolved_by = '00000000-0000-0000-0000-00000000000c' WHERE id = '73000000-0000-0000-0000-000000000001'$$,
  'material break closed by one person');
SELECT pg_temp.expect_error($$UPDATE reconciliation_breaks SET status = 'RESOLVED', resolution_note = 'weg', resolved_by = '00000000-0000-0000-0000-00000000000c', approved_by = '00000000-0000-0000-0000-00000000000c' WHERE id = '73000000-0000-0000-0000-000000000001'$$,
  'material break approved by the same person');
UPDATE reconciliation_breaks SET status = 'RESOLVED', resolution_note = 'verklaard', resolved_by = '00000000-0000-0000-0000-00000000000c', approved_by = '00000000-0000-0000-0000-00000000000d' WHERE id = '73000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect((SELECT status FROM reconciliation_breaks WHERE id = '73000000-0000-0000-0000-000000000001') = 'RESOLVED', 'material break closed by two people is accepted');

\echo 'All database constraint tests passed.'
