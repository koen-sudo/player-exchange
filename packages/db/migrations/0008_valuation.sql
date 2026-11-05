-- Fase 7: valuation pipeline.
-- DRAFT → VALIDATED → APPROVED → PUBLISHED (or FAILED / REJECTED).
-- - A run is approved by someone other than its creator (four-eyes).
-- - Values of a run can no longer change once it is reviewed.
-- - Only PUBLISHED runs reach users (public_reference_values, AT-29).

BEGIN;

ALTER TABLE valuation_runs
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD COLUMN approved_by uuid REFERENCES users(id),
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN scheduled_publish_at timestamptz,
  ADD COLUMN checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT valuation_runs_four_eyes CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by),
  ADD CONSTRAINT valuation_runs_approved_has_approver CHECK (status NOT IN ('APPROVED','PUBLISHED') OR approved_by IS NOT NULL OR created_by IS NULL);
CREATE INDEX valuation_runs_status_idx ON valuation_runs(status, scheduled_publish_at);

ALTER TABLE player_reference_values
  ADD COLUMN inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN components jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN previous_cents bigint;

-- Values are frozen as soon as a run leaves DRAFT.
CREATE FUNCTION reference_values_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s valuation_run_status;
BEGIN
  SELECT status INTO s FROM valuation_runs WHERE id = coalesce(OLD.run_id, NEW.run_id);
  IF s IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'reference values of a % run cannot change', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER reference_values_frozen BEFORE UPDATE OR DELETE ON player_reference_values
  FOR EACH ROW EXECUTE FUNCTION reference_values_frozen();

-- A published run stays published (a newer run takes over per player).
CREATE FUNCTION valuation_run_transitions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED','SUPERSEDED') THEN
    RAISE EXCEPTION 'a published run cannot become %', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'PUBLISHED' AND OLD.status NOT IN ('APPROVED','PUBLISHED') THEN
    RAISE EXCEPTION 'only an approved run can be published (was %)', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valuation_run_transitions BEFORE UPDATE OF status ON valuation_runs
  FOR EACH ROW EXECUTE FUNCTION valuation_run_transitions();

INSERT INTO permissions(key, description) VALUES ('valuation.publish', 'Goedgekeurde waarderingen publiceren') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key, permission_key) VALUES ('VALUATION_ANALYST', 'valuation.publish') ON CONFLICT DO NOTHING;

COMMIT;
