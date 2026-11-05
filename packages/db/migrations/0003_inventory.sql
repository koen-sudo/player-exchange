-- Fase 3: inventory and portfolio.
-- - Programme versions: an amended programme supersedes the previous one.
-- - Publishing a programme requires an executed two-person approval (docs/10).
-- - Ownership changes only together with an ownership event (deferred check),
--   so every owned card has a complete, verifiable history.
-- - Opening balances (e.g. a demo seed or a later migration from another
--   ledger) are an explicit, referenced ownership cause.

BEGIN;

ALTER TYPE programme_status ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE issuance_programs
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD COLUMN approval_id uuid REFERENCES admin_approvals(id),
  ADD COLUMN is_opening_balance boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT issuance_programs_published_needs_approval
    CHECK (status::text NOT IN ('PUBLISHED') OR approval_id IS NOT NULL OR is_opening_balance);

-- Compare against the latest published, completed or superseded version.
CREATE OR REPLACE FUNCTION check_programme_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev integer;
BEGIN
  SELECT planned_total INTO prev FROM issuance_programs
   WHERE edition_id = NEW.edition_id AND status::text IN ('PUBLISHED','COMPLETED','SUPERSEDED') AND id <> NEW.id
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

-- A reduced programme may not go below the cards that already exist.
CREATE FUNCTION check_programme_covers_cards() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE highest integer;
BEGIN
  IF NEW.status::text = 'PUBLISHED' THEN
    SELECT coalesce(max(serial_number), 0) INTO highest FROM cards WHERE edition_id = NEW.edition_id;
    IF NEW.planned_total < highest THEN
      RAISE EXCEPTION 'programme % below existing serial %', NEW.planned_total, highest USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issuance_programs_covers_cards BEFORE INSERT OR UPDATE OF status, planned_total ON issuance_programs
  FOR EACH ROW EXECUTE FUNCTION check_programme_covers_cards();

-- Ownership events: add an explicit opening-balance cause with a reference.
ALTER TABLE ownership_events DROP CONSTRAINT ownership_events_cause_check;
ALTER TABLE ownership_events
  ADD COLUMN reference text,
  ADD CONSTRAINT ownership_events_cause_check
    CHECK (cause IN ('PRIMARY_DELIVERY','SECONDARY_SETTLEMENT','INCIDENT_CORRECTION','OPENING_BALANCE')),
  ADD CONSTRAINT ownership_events_opening_reference
    CHECK (cause NOT IN ('OPENING_BALANCE','INCIDENT_CORRECTION') OR coalesce(trim(reference), '') <> '');
CREATE INDEX ownership_events_card_idx ON ownership_events(card_id, occurred_at DESC);

-- A card's owner may only change together with an ownership event that
-- names the same new owner (checked at commit).
-- Runs at commit and checks the card's state at that moment, so several
-- changes inside one transaction only need one event for the final owner.
CREATE FUNCTION check_owner_has_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_owner uuid; latest uuid; found boolean;
BEGIN
  SELECT owner_user_id INTO current_owner FROM cards WHERE id = NEW.id;
  IF current_owner IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT new_owner_id, true INTO latest, found FROM ownership_events
   WHERE card_id = NEW.id ORDER BY occurred_at DESC, id DESC LIMIT 1;
  IF NOT coalesce(found, false) OR latest IS DISTINCT FROM current_owner THEN
    RAISE EXCEPTION 'owner of card % changed without matching ownership event', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cards_owner_has_event AFTER INSERT OR UPDATE OF owner_user_id ON cards
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_owner_has_event();

-- Invariant view used by tests and reconciliation (docs/09 "Structurele invarianten").
CREATE VIEW card_ownership_mismatches AS
SELECT c.id AS card_id, c.owner_user_id, e.new_owner_id AS event_owner
  FROM cards c
  LEFT JOIN LATERAL (
    SELECT new_owner_id FROM ownership_events oe WHERE oe.card_id = c.id ORDER BY occurred_at DESC, id DESC LIMIT 1
  ) e ON true
 WHERE c.status = 'OWNED' AND c.owner_user_id IS DISTINCT FROM e.new_owner_id;

-- Approvals: who executed, and when.
ALTER TABLE admin_approvals
  ADD COLUMN executed_by uuid REFERENCES users(id),
  ADD COLUMN executed_at timestamptz;

COMMIT;
