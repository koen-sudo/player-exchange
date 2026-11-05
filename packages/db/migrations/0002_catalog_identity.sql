-- Fase 2: catalogue import (resumable, idempotent, quarantined conflicts)
-- and identity/authorisation (permissions, terms, admission).
-- docs/07 "Importproces", docs/03 BR-01, BR-06, BR-07, docs/10 "Rollen".

BEGIN;

-- ---------------------------------------------------------------------------
-- Import runs: queue + resumable progress
-- ---------------------------------------------------------------------------
ALTER TABLE import_runs DROP CONSTRAINT import_runs_status_check;
ALTER TABLE import_runs
  ADD CONSTRAINT import_runs_status_check CHECK (status IN ('QUEUED','RUNNING','PAUSED','COMPLETED','FAILED')),
  ADD COLUMN requested_by uuid REFERENCES users(id),
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text,
  ADD COLUMN stats jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE import_runs ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE import_runs ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE import_runs ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- At most one active (queued or running) import per provider and scope.
CREATE UNIQUE INDEX import_runs_one_active ON import_runs(provider, scope) WHERE status IN ('QUEUED','RUNNING');

-- One row per unit of work (competition list, a competition's teams, a team's squad).
-- A resumed run skips completed steps; a step stores its page cursor.
CREATE TABLE import_run_steps (
  run_id       uuid NOT NULL REFERENCES import_runs(id),
  step_key     text NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  cursor       text,
  pages_done   integer NOT NULL DEFAULT 0,
  is_complete_snapshot boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  PRIMARY KEY (run_id, step_key)
);

-- Raw provider pages, kept for the permitted retention period (docs/07 step 2).
CREATE TABLE import_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES import_runs(id),
  step_key       text NOT NULL,
  page_no        integer NOT NULL,
  source_version text NOT NULL,
  payload        jsonb NOT NULL,
  retain_until   timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_key, page_no)
);

ALTER TABLE import_issues
  ADD COLUMN provider text,
  ADD COLUMN external_id text,
  ADD COLUMN resolved_by uuid REFERENCES users(id),
  ADD COLUMN resolved_at timestamptz;
-- An unresolved issue is recorded once per provider entity and kind.
CREATE UNIQUE INDEX import_issues_open_unique ON import_issues(provider, external_id, kind) WHERE resolution = 'OPEN';

-- ---------------------------------------------------------------------------
-- Catalogue identity constraints
-- ---------------------------------------------------------------------------
-- A player has at most one open membership per team, and at most one open
-- first-team membership overall (a transfer closes the old one).
CREATE UNIQUE INDEX player_team_memberships_open_per_team ON player_team_memberships(player_id, team_id) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX player_team_memberships_one_first_team ON player_team_memberships(player_id) WHERE valid_to IS NULL AND membership_type = 'FIRST_TEAM';
CREATE UNIQUE INDEX team_competition_memberships_open ON team_competition_memberships(team_id, competition_id) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX player_roles_open ON player_roles(player_id, role, source) WHERE valid_to IS NULL;

ALTER TABLE players ADD COLUMN source_version text;
ALTER TABLE players ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Search support for the catalogue (PRD-01/02, perf target 10k players).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE FUNCTION px_search_key(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;
CREATE INDEX players_search_trgm ON players USING gin (px_search_key(display_name) gin_trgm_ops);
CREATE INDEX players_name_id_idx ON players(display_name, id);

-- ---------------------------------------------------------------------------
-- Identity: terms, permissions
-- ---------------------------------------------------------------------------
CREATE TABLE terms_documents (
  document_key     text NOT NULL,
  document_version text NOT NULL,
  is_current       boolean NOT NULL DEFAULT false,
  is_placeholder   boolean NOT NULL DEFAULT true, -- O-07: final terms not yet available
  published_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_key, document_version)
);
CREATE UNIQUE INDEX terms_documents_one_current ON terms_documents(document_key) WHERE is_current;
INSERT INTO terms_documents(document_key, document_version, is_current) VALUES
  ('card_terms', 'demo-0', true),
  ('privacy', 'demo-0', true);

INSERT INTO permissions(key, description) VALUES
  ('admin.access', 'Beheeromgeving openen'),
  ('catalog.view', 'Catalogus en importstatus bekijken'),
  ('catalog.import', 'Catalogusimport starten'),
  ('catalog.resolve_issue', 'Importproblemen afhandelen'),
  ('users.view', 'Gebruikers en beperkingen bekijken'),
  ('users.restrict', 'Gebruikersbeperkingen instellen of beëindigen'),
  ('audit.view', 'Auditlog bekijken'),
  ('issuance.prepare', 'Uitgiftes voorbereiden'),
  ('valuation.prepare', 'Waarderingen voorbereiden'),
  ('finance.operate', 'Settlement en reconciliatie behandelen'),
  ('approvals.decide', 'Gevoelige handelingen goedkeuren'),
  ('roles.manage', 'Rollen beheren');

INSERT INTO role_permissions(role_key, permission_key) VALUES
  ('SUPPORT', 'admin.access'), ('SUPPORT', 'users.view'), ('SUPPORT', 'catalog.view'),
  ('CATALOG_MANAGER', 'admin.access'), ('CATALOG_MANAGER', 'catalog.view'), ('CATALOG_MANAGER', 'catalog.import'), ('CATALOG_MANAGER', 'catalog.resolve_issue'), ('CATALOG_MANAGER', 'audit.view'),
  ('ISSUANCE_OPERATOR', 'admin.access'), ('ISSUANCE_OPERATOR', 'catalog.view'), ('ISSUANCE_OPERATOR', 'issuance.prepare'),
  ('VALUATION_ANALYST', 'admin.access'), ('VALUATION_ANALYST', 'catalog.view'), ('VALUATION_ANALYST', 'valuation.prepare'),
  ('FINANCE_OPERATOR', 'admin.access'), ('FINANCE_OPERATOR', 'users.view'), ('FINANCE_OPERATOR', 'users.restrict'), ('FINANCE_OPERATOR', 'finance.operate'), ('FINANCE_OPERATOR', 'audit.view'),
  ('APPROVER', 'admin.access'), ('APPROVER', 'approvals.decide'), ('APPROVER', 'audit.view'),
  ('SUPERADMIN', 'admin.access'), ('SUPERADMIN', 'roles.manage'), ('SUPERADMIN', 'audit.view'), ('SUPERADMIN', 'users.view');

-- Allowed residence countries for money actions (A-01: Dutch adults first).
CREATE TABLE admitted_countries (
  country_code char(2) PRIMARY KEY,
  admitted_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admitted_countries(country_code) VALUES ('NL');

ALTER TABLE user_profiles ADD COLUMN birth_year_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN last_login_at timestamptz;

COMMIT;
