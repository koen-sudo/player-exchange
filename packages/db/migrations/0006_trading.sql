-- Fase 5: orders, matching and settlement.
-- - Server-side order previews (docs/06): a placed order always comes from a
--   preview the server made, checked again at placement.
-- - A closed order has nothing open or pending.
-- - A settled execution always has the ownership event that delivered the card.

BEGIN;

CREATE TABLE order_previews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  player_market_id uuid NOT NULL REFERENCES player_markets(id),
  side             order_side NOT NULL,
  payload          jsonb NOT NULL,          -- quantity, limit, time in force, selected cards
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  order_id         uuid REFERENCES orders(id),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (order_id IS NULL))
);
CREATE INDEX order_previews_user_idx ON order_previews(user_id, created_at DESC);

ALTER TABLE orders ADD CONSTRAINT orders_closed_is_empty CHECK (state <> 'CLOSED' OR (qty_open = 0 AND qty_pending = 0));
ALTER TABLE orders ADD COLUMN closed_at timestamptz;
CREATE INDEX orders_expiry_idx ON orders(expires_at) WHERE state = 'ACTIVE' AND qty_open > 0;

CREATE INDEX executions_buyer_idx ON executions(buyer_user_id, matched_at DESC);
CREATE INDEX executions_seller_idx ON executions(seller_user_id, matched_at DESC);
CREATE INDEX settlement_operations_execution_idx ON settlement_operations(execution_id) WHERE execution_id IS NOT NULL;

-- A settled execution has delivered its card to the buyer (checked at commit).
CREATE FUNCTION executions_settled_has_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'SETTLED' AND NOT EXISTS (
    SELECT 1 FROM ownership_events e
     WHERE e.execution_id = NEW.id AND e.card_id = NEW.card_id AND e.new_owner_id = NEW.buyer_user_id) THEN
    RAISE EXCEPTION 'execution % settled without delivering card % to the buyer', NEW.id, NEW.card_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER executions_settled_delivery
  AFTER INSERT OR UPDATE OF status ON executions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION executions_settled_has_delivery();

-- A final execution never changes again.
CREATE FUNCTION executions_final_is_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('SETTLED','FAILED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'execution % is already %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER executions_final
  BEFORE UPDATE OF status ON executions
  FOR EACH ROW EXECUTE FUNCTION executions_final_is_final();

INSERT INTO permissions(key, description) VALUES ('trading.view', 'Orders en uitvoeringen inzien') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key, permission_key) VALUES
  ('FINANCE_OPERATOR', 'trading.view'), ('SUPPORT', 'trading.view') ON CONFLICT DO NOTHING;

COMMIT;
