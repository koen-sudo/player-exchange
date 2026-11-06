-- Fase 9: hardening.
-- - Rate limiting on sensitive endpoints (docs/10), counted atomically in the database
--   so every web instance shares the same limits.
-- - Production gates can only be fulfilled through an executed two-person approval
--   that names exactly this gate and this evidence.

BEGIN;

CREATE TABLE rate_limit_hits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX rate_limit_hits_window_idx ON rate_limit_hits(window_start);

INSERT INTO permissions(key, description) VALUES
  ('gates.manage', 'Bewijs voor productiegates aanvragen en vastleggen (na goedkeuring)')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key, permission_key) VALUES ('SUPERADMIN', 'gates.manage'), ('SUPERADMIN', 'operations.view')
ON CONFLICT DO NOTHING;

CREATE FUNCTION check_gate_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'gate definition is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.satisfied AND NOT OLD.satisfied THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_approvals a
       WHERE a.id = NEW.approval_id AND a.action_type = 'FULFIL_GATE' AND a.status = 'EXECUTED'
         AND a.payload->>'gate' = NEW.key AND a.payload->>'evidenceRef' = NEW.evidence_ref
         AND a.approved_by IS NOT NULL AND a.approved_by <> a.requested_by) THEN
      RAISE EXCEPTION 'gate % needs an executed two-person approval for this evidence', NEW.key USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Revoking is always allowed (safe direction); it clears the evidence link.
  IF OLD.satisfied AND NOT NEW.satisfied AND (NEW.approval_id IS NOT NULL OR NEW.evidence_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'a revoked gate keeps no evidence link' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER feature_gates_change BEFORE UPDATE ON feature_gates FOR EACH ROW EXECUTE FUNCTION check_gate_change();
CREATE TRIGGER feature_gates_no_delete BEFORE DELETE ON feature_gates FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
