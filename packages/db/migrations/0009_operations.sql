-- Fase 8: integration contracts and operations.
-- - Results of adapter contract test runs (the capability evidence per adapter).
-- - Rejected webhooks are counted (no body stored), for monitoring.
-- - Monitoring alerts with an operational owner and handling status (docs/10).

BEGIN;

CREATE TABLE adapter_contract_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('PAYMENT','FOOTBALL_DATA','IDENTITY','NOTIFICATION')),
  adapter     text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('demo','sandbox','production')),
  results     jsonb NOT NULL,
  passed      integer NOT NULL CHECK (passed >= 0),
  failed      integer NOT NULL CHECK (failed >= 0),
  blocked     integer NOT NULL CHECK (blocked >= 0),
  ran_by      uuid REFERENCES users(id),
  ran_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adapter_contract_runs_idx ON adapter_contract_runs(kind, ran_at DESC);
CREATE TRIGGER adapter_contract_runs_append_only BEFORE UPDATE OR DELETE ON adapter_contract_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE webhook_rejections (
  id          bigserial PRIMARY KEY,
  provider    text NOT NULL,
  reason      text NOT NULL,
  body_sha256 text NOT NULL,
  body_bytes  integer NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_rejections_time_idx ON webhook_rejections(received_at DESC);

CREATE TABLE monitoring_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key    text NOT NULL,
  owner_role    text NOT NULL REFERENCES roles(key),
  severity      text NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  value         numeric NOT NULL,
  detail        text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  note          text,
  resolved_at   timestamptz,
  CHECK (status <> 'ACKNOWLEDGED' OR (acknowledged_by IS NOT NULL AND note IS NOT NULL))
);
CREATE UNIQUE INDEX monitoring_alerts_one_open ON monitoring_alerts(signal_key) WHERE status <> 'RESOLVED';

INSERT INTO permissions(key, description) VALUES
  ('operations.view', 'Bewaking en koppelingen inzien'),
  ('finance.correct', 'Correctieboekingen aanvragen en uitvoeren (na goedkeuring)')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key, permission_key) VALUES
  ('FINANCE_OPERATOR', 'operations.view'), ('FINANCE_OPERATOR', 'finance.correct'),
  ('SUPPORT', 'operations.view'), ('APPROVER', 'operations.view')
ON CONFLICT DO NOTHING;

COMMIT;
