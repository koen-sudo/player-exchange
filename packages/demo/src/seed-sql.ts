/**
 * Emits SQL that loads the demo world into a database with the core schema.
 * Usage: node packages/demo/src/seed-sql.ts | psql "$DATABASE_URL"
 *
 * Refuses to run unless APP_MODE=demo (demo data must never reach production).
 */
import { demoWorld, type Player } from "./world.ts";

const q = (v: string | null | undefined) => (v === null || v === undefined ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const ts = (d: Date | null | undefined) => (d ? q(d.toISOString()) : "NULL");

export function seedSql(): string {
  const w = demoWorld();
  const out: string[] = ["BEGIN;", "INSERT INTO environment_marker(mode) VALUES ('demo') ON CONFLICT (singleton) DO NOTHING;"];
  const demoModel = "d0000000-0000-4000-8000-00000000a001";
  const demoRun = "d0000000-0000-4000-8000-00000000a002";

  for (const c of w.competitions) {
    out.push(`INSERT INTO competitions(id, provider, provider_id, name, country_code) VALUES (${q(c.id)}, 'fixture', ${q(c.id)}, ${q(c.name)}, ${q(c.countryCode)});`);
  }
  for (const t of w.teams) {
    out.push(`INSERT INTO teams(id, name) VALUES (${q(t.id)}, ${q(t.name)});`);
    out.push(`INSERT INTO provider_team_mappings VALUES ('fixture', ${q(t.id)}, ${q(t.id)});`);
    out.push(`INSERT INTO team_competition_memberships(team_id, competition_id, valid_from) VALUES (${q(t.id)}, ${q(t.competitionId)}, '2026-07-01');`);
  }
  for (const u of w.users) {
    out.push(`INSERT INTO users(id, auth_subject, is_test_account, is_staff) VALUES (${q(u.id)}, ${q(`demo:${u.login}`)}, true, ${u.role === "ADMIN"});`);
    out.push(`INSERT INTO user_profiles(user_id, display_name, residence_country, verification_status, age_confirmed) VALUES (${q(u.id)}, ${q(u.displayName)}, ${q(u.residenceCountry)}, ${q(u.verified ? "VERIFIED" : "NOT_STARTED")}, ${u.verified});`);
    for (const r of u.adminRoles) out.push(`INSERT INTO user_roles(user_id, role_key) VALUES (${q(u.id)}, ${q(r)});`);
  }

  out.push(`INSERT INTO valuation_model_versions(id, version_key, is_demo, parameters, code_version, status) VALUES (${q(demoModel)}, 'demo-v0', true, '{"note":"demomodel, geen productieformule"}', 'demo', 'APPROVED');`);
  out.push(`INSERT INTO valuation_runs(id, model_version_id, scope, data_version, information_as_of, status, computed_at, published_at) VALUES (${q(demoRun)}, ${q(demoModel)}, 'all', 'fixture-1', '2026-11-02T06:00:00Z', 'PUBLISHED', '2026-11-02T16:30:00Z', '2026-11-02T17:00:00Z');`);

  let cardSeq = 0;
  for (const p of w.players) {
    out.push(playerSql(p));
    if (p.reference) {
      out.push(`INSERT INTO player_reference_values(player_id, run_id, amount_cents, confidence, explanations, is_historical) VALUES (${q(p.id)}, ${q(demoRun)}, ${p.reference.amount}, ${q(p.reference.confidence)}, ${q(JSON.stringify(p.reference.reasons))}, ${p.reference.isHistorical});`);
    }
    out.push(`INSERT INTO player_markets(player_id, status) VALUES (${q(p.id)}, ${q(p.marketStatus)});`);
    if (p.marketStatus !== "OPEN") continue;
    const edition = `e${p.id.slice(1)}`;
    out.push(`INSERT INTO editions(id, player_id, season_key) VALUES (${q(edition)}, ${q(p.id)}, ${q(w.season)});`);
    out.push(`INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at) VALUES (${q(edition)}, 1, ${p.supply.plannedThisSeason}, 'PUBLISHED', '2026-04-01T10:00:00Z');`);
    // Delivered cards are owned by an anonymous demo collector unless Anna holds them.
    out.push(
      `INSERT INTO cards(edition_id, player_id, serial_number, status, owner_user_id, cost_basis_cents) ` +
        `SELECT ${q(edition)}, ${q(p.id)}, g, 'OWNED', ${q(w.users[1]!.id)}, ${p.reference?.amount ?? 100} FROM generate_series(1, ${p.supply.inCirculation}) g;`,
    );
    cardSeq += p.supply.inCirculation;
  }

  // Anna's holdings: re-assign specific serials to her with her cost basis.
  for (const [userId, cards] of Object.entries(w.holdings)) {
    for (const c of cards) {
      out.push(`UPDATE cards SET owner_user_id = ${q(userId)}, cost_basis_cents = ${c.costCents} FROM editions e WHERE cards.edition_id = e.id AND e.player_id = ${q(c.playerId)} AND cards.serial_number = ${c.serial};`);
    }
  }
  out.push(`-- ${cardSeq} delivered cards`);
  out.push("COMMIT;");
  return out.join("\n");
}

function playerSql(p: Player): string {
  return (
    `INSERT INTO players(id, display_name, birth_date, nationality, career_status, data_quality, primary_admission, is_fictional) VALUES ` +
    `(${q(p.id)}, ${q(p.displayName)}, ${q(p.birthDate)}, ${q(p.nationality)}, ${q(p.careerStatus)}, ${q(p.dataQuality)}, ${q(p.primaryAdmission)}, true);\n` +
    `INSERT INTO provider_player_mappings VALUES ('fixture', ${q(p.id)}, ${q(p.id)});\n` +
    `INSERT INTO player_team_memberships(player_id, team_id, membership_type, valid_from) VALUES (${q(p.id)}, ${q(p.teamId)}, 'FIRST_TEAM', ${q(p.previousTeamId ? "2026-09-01" : "2026-07-01")});` +
    (p.previousTeamId
      ? `\nINSERT INTO player_team_memberships(player_id, team_id, membership_type, valid_from, valid_to) VALUES (${q(p.id)}, ${q(p.previousTeamId)}, 'FIRST_TEAM', '2026-07-01', '2026-09-01');`
      : "")
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.APP_MODE !== "demo") {
    console.error("Seed geweigerd: demodata mag alleen in APP_MODE=demo worden geladen.");
    process.exit(1);
  }
  process.stdout.write(seedSql() + "\n");
}
