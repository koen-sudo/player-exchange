-- Fase 3: player admission and quarantine handling permissions.
BEGIN;

INSERT INTO permissions(key, description) VALUES
  ('players.admit', 'Spelers toelaten tot primaire uitgifte en marktstatus wijzigen');

INSERT INTO role_permissions(role_key, permission_key) VALUES
  ('CATALOG_MANAGER', 'players.admit'),
  ('ISSUANCE_OPERATOR', 'players.admit');

-- Resolution of a quarantined import issue records what was decided.
ALTER TABLE import_issues
  ADD COLUMN resolution_note text,
  ADD COLUMN resolved_player_id uuid REFERENCES players(id);

COMMIT;
