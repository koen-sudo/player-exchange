-- Fase 6: primary issuance (drops), subscriptions, allocation and delivery.
-- - Drops are published with four-eyes approval; the price may change in both
--   directions until the subscription opens (V-01a), always with approval.
-- - The allocation seed is stored encrypted (AES-256-GCM, key from the
--   environment); only its SHA-256 commitment is public before opening.
--   After allocation the seed is revealed so anyone can verify the draw.
-- - A snapshot keeps the frozen participants AND the ranking, so a retry or
--   a waitlist promotion always uses the same order (AT-24).

BEGIN;

ALTER TABLE drops
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD COLUMN approval_id uuid REFERENCES admin_approvals(id),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN seed_iv bytea,
  ADD COLUMN seed_tag bytea,
  ADD COLUMN seed_revealed text,            -- hex, set only after allocation
  ADD COLUMN allocated_at timestamptz,
  ADD COLUMN waitlist_until timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN cancel_reason text;
CREATE INDEX drops_schedule_idx ON drops(status, opens_at, closes_at);
-- The seed is never revealed before the drawing (BR-11).
ALTER TABLE drops ADD CONSTRAINT drops_seed_revealed_after_allocation CHECK (seed_revealed IS NULL OR allocated_at IS NOT NULL);
-- The price is fixed at opening (V-01a: it may change before, in either direction).
ALTER TABLE drops ADD CONSTRAINT drops_open_has_fixed_price CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED','POSTPONED') OR price_fixed_at IS NOT NULL);

CREATE FUNCTION drops_price_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price_cents <> OLD.price_cents AND OLD.status NOT IN ('DRAFT','PUBLISHED') THEN
    RAISE EXCEPTION 'drop % price is fixed since opening', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.quantity <> OLD.quantity AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'drop % quantity is fixed since publication', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drops_price_frozen BEFORE UPDATE OF price_cents, quantity ON drops
  FOR EACH ROW EXECUTE FUNCTION drops_price_frozen();

-- Price history (V-01a): every change between publication and opening.
CREATE TABLE drop_price_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id      uuid NOT NULL REFERENCES drops(id),
  old_price_cents bigint NOT NULL,
  new_price_cents bigint NOT NULL CHECK (new_price_cents BETWEEN 20 AND 1000000),
  approval_id  uuid NOT NULL REFERENCES admin_approvals(id),
  changed_by   uuid NOT NULL REFERENCES users(id),
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER drop_price_changes_append_only BEFORE UPDATE OR DELETE ON drop_price_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE subscriptions
  ADD COLUMN price_cents bigint CHECK (price_cents BETWEEN 20 AND 1000000),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN outcome_at timestamptz;
CREATE INDEX subscriptions_user_idx ON subscriptions(user_id, created_at DESC);

ALTER TABLE allocation_snapshots ADD COLUMN ranking uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE allocations
  ADD COLUMN price_cents bigint CHECK (price_cents BETWEEN 20 AND 1000000),
  ADD COLUMN settled_at timestamptz,
  ADD COLUMN promoted_from uuid REFERENCES allocations(id);
-- A delivered allocation has delivered its card (checked at commit).
CREATE FUNCTION allocations_delivered_has_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sub_user uuid;
BEGIN
  IF NEW.status = 'DELIVERED' THEN
    SELECT user_id INTO sub_user FROM subscriptions WHERE id = NEW.subscription_id;
    IF NOT EXISTS (SELECT 1 FROM ownership_events e WHERE e.allocation_id = NEW.id AND e.card_id = NEW.card_id AND e.new_owner_id = sub_user) THEN
      RAISE EXCEPTION 'allocation % delivered without ownership event', NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER allocations_delivered_event
  AFTER INSERT OR UPDATE OF status ON allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION allocations_delivered_has_event();

CREATE INDEX settlement_operations_allocation_idx ON settlement_operations(allocation_id) WHERE allocation_id IS NOT NULL;

COMMIT;
