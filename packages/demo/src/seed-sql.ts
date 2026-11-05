/**
 * Emits SQL that loads the demo world into a database with the core schema.
 * Usage: node packages/demo/src/seed-sql.ts | psql "$DATABASE_URL"
 *
 * Refuses to run unless APP_MODE=demo (demo data must never reach production).
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoWorld, type Player } from "./world.ts";

/** Fictitious holder of the delivered demo cards that are not Anna's. Cannot log in (no demo: subject). */
export const COLLECTOR_ID = "d0000005-0000-4000-8000-000000000099";

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
  // A fictitious collector who holds the other delivered demo cards.
  out.push(`INSERT INTO users(id, auth_subject, is_test_account) VALUES (${q(COLLECTOR_ID)}, 'demo-holder:verzamelaar', true);`);
  out.push(`INSERT INTO user_profiles(user_id, display_name, residence_country) VALUES (${q(COLLECTOR_ID)}, 'Demo-verzamelaar', 'NL');`);
  for (const u of w.users) {
    out.push(`INSERT INTO users(id, auth_subject, is_test_account, is_staff) VALUES (${q(u.id)}, ${q(`demo:${u.login}`)}, true, ${u.role === "ADMIN"});`);
    out.push(`INSERT INTO user_profiles(user_id, display_name, residence_country, verification_status, age_confirmed) VALUES (${q(u.id)}, ${q(u.displayName)}, ${q(u.residenceCountry)}, ${q(u.verified ? "VERIFIED" : "NOT_STARTED")}, ${u.verified});`);
    for (const r of u.adminRoles) out.push(`INSERT INTO user_roles(user_id, role_key) VALUES (${q(u.id)}, ${q(r)});`);
    if (u.verified) {
      out.push(`INSERT INTO terms_acceptances(user_id, document_key, document_version) SELECT ${q(u.id)}, document_key, document_version FROM terms_documents WHERE is_current;`);
    }
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
    out.push(`INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at, is_opening_balance) VALUES (${q(edition)}, 1, ${p.supply.plannedThisSeason}, 'PUBLISHED', '2026-04-01T10:00:00Z', true);`);
    // Delivered cards are owned by a fictitious demo collector unless Anna holds them.
    out.push(
      `INSERT INTO cards(edition_id, player_id, serial_number, status, owner_user_id, cost_basis_cents) ` +
        `SELECT ${q(edition)}, ${q(p.id)}, g, 'OWNED', ${q(COLLECTOR_ID)}, ${p.reference?.amount ?? 100} FROM generate_series(1, ${p.supply.inCirculation}) g;`,
    );
    cardSeq += p.supply.inCirculation;
  }

  // Anna's holdings: re-assign specific serials to her with her cost basis.
  for (const [userId, cards] of Object.entries(w.holdings)) {
    for (const c of cards) {
      out.push(`UPDATE cards SET owner_user_id = ${q(userId)}, cost_basis_cents = ${c.costCents} FROM editions e WHERE cards.edition_id = e.id AND e.player_id = ${q(c.playerId)} AND cards.serial_number = ${c.serial};`);
    }
  }
  // Every owned card gets an explicit opening-balance ownership event (fase 3:
  // ownership only changes together with an event).
  const acquired = Object.values(w.holdings).flat()
    .map((c) => `(${q(c.playerId)}::uuid, ${c.serial}, ${ts(c.acquiredAt)}::timestamptz)`).join(", ");
  out.push(
    `WITH acq(player_id, serial, at) AS (VALUES ${acquired}) ` +
      `INSERT INTO ownership_events(card_id, new_owner_id, cause, reference, cost_basis_cents, occurred_at) ` +
      `SELECT c.id, c.owner_user_id, 'OPENING_BALANCE', 'demo-seed', c.cost_basis_cents, coalesce(acq.at, '2026-10-01T10:00:00Z') ` +
      `FROM cards c JOIN editions e ON e.id = c.edition_id LEFT JOIN acq ON acq.player_id = e.player_id AND acq.serial = c.serial_number ` +
      `WHERE c.status = 'OWNED';`,
  );

  // Anna's orders, so reservations and her order list come from the database.
  // Cash holds for buy orders follow with the ledger in fase 4.
  const seqByMarket = new Map<string, number>();
  for (const o of w.orders) {
    const seq = (seqByMarket.get(o.playerId) ?? 0) + 1;
    seqByMarket.set(o.playerId, seq);
    const state = o.qty.open + o.qty.pending > 0 ? "ACTIVE" : "CLOSED";
    out.push(
      `INSERT INTO orders(id, player_market_id, user_id, side, limit_price_cents, time_in_force, state, priority_sequence, qty_original, qty_open, qty_pending, qty_filled, qty_cancelled, qty_expired, accepted_at, expires_at) ` +
        `SELECT ${q(o.id)}, pm.id, ${q(o.userId)}, ${q(o.side)}, ${o.limitPriceCents}, ${q(o.timeInForce)}, ${q(state)}, ${seq}, ${o.qty.original}, ${o.qty.open}, ${o.qty.pending}, ${o.qty.filled}, ${o.qty.cancelled}, ${o.qty.expired}, ${ts(o.acceptedAt)}, ${ts(o.expiresAt)} ` +
        `FROM player_markets pm WHERE pm.player_id = ${q(o.playerId)};`,
    );
    for (const cardId of o.cardIds) {
      const held = Object.values(w.holdings).flat().find((c) => c.cardId === cardId)!;
      out.push(
        `INSERT INTO order_cards(order_id, card_id, active) SELECT ${q(o.id)}, c.id, ${state === "ACTIVE"} FROM cards c JOIN editions e ON e.id = c.edition_id ` +
          `WHERE e.player_id = ${q(held.playerId)} AND c.serial_number = ${held.serial};`,
      );
    }
  }
  for (const [playerId, seq] of seqByMarket) {
    out.push(`UPDATE player_markets SET next_order_sequence = ${seq + 1} WHERE player_id = ${q(playerId)};`);
  }

  // Fase 4: payment accounts, ledger opening balances and holds for open buy orders.
  for (const u of w.users.filter((x) => x.verified)) {
    out.push(`INSERT INTO payment_accounts(user_id, provider, provider_account_id, status, display_ref) VALUES (${q(u.id)}, 'demo', ${q(`demo-acct-${u.login}`)}, 'ACTIVE', 'NL•• DEMO •••• ${String(u.login.length * 1111).padStart(4, "0")}');`);
  }
  const acct = (type: string, userId: string | null) =>
    `(SELECT id FROM ledger_accounts WHERE type = '${type}' AND owner_user_id ${userId ? `= ${q(userId)}` : "IS NULL"})`;
  const entry = (eventId: string, kind: string, lines: [string, "DEBIT" | "CREDIT", number][]) => {
    out.push(`INSERT INTO journal_entries(business_event_id, kind, source, environment) VALUES (${q(eventId)}, ${q(kind)}, 'demo-seed', 'demo');`);
    for (const [account, side, amount] of lines) {
      out.push(`INSERT INTO journal_lines(journal_entry_id, ledger_account_id, side, amount_cents) VALUES ((SELECT id FROM journal_entries WHERE business_event_id = ${q(eventId)}), ${account}, '${side}', ${amount});`);
    }
  };
  for (const [userId, bal] of Object.entries(w.balances)) {
    const holds = w.orders.filter((o) => o.userId === userId && o.side === "BUY" && o.qty.open > 0).map((o) => ({ order: o, amount: o.qty.open * o.limitPriceCents }));
    const opening = bal.available + holds.reduce((n, h) => n + h.amount, 0);
    if (opening === 0) continue;
    out.push(`INSERT INTO ledger_accounts(type, owner_user_id) VALUES ('CUSTOMER_AVAILABLE', ${q(userId)}), ('CUSTOMER_RESERVED', ${q(userId)}) ON CONFLICT DO NOTHING;`);
    entry(`opening:${userId}:demo-seed`, "OPENING_BALANCE", [[acct("PSP_SETTLEMENT_ASSET", null), "DEBIT", opening], [acct("CUSTOMER_AVAILABLE", userId), "CREDIT", opening]]);
    // The simulated provider holds the same money, so reconciliation agrees from the start.
    out.push(`INSERT INTO psp_sim.operations(idempotency_key, reference, kind, account_ref, amount_cents, status, scenario, resolved_at) VALUES (${q(`opening-${userId}`)}, ${q(`sim-opening-${userId.slice(-6)}`)}, 'DEPOSIT', ${q(`user:${userId}`)}, ${opening}, 'SUCCEEDED', 'OPENING_BALANCE', now());`);
    // ...and the platform records it as a confirmed (opening) deposit linked to that operation.
    const ref = `sim-opening-${userId.slice(-6)}`;
    out.push(`INSERT INTO settlement_operations(type, idempotency_key, provider, provider_reference, amount_cents, status, financially_processed_at, outcome_known_at, user_id, created_at) VALUES ('DEPOSIT', ${q(`opening-${userId}`)}, 'demo', ${q(ref)}, ${opening}, 'SUCCEEDED', '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', ${q(userId)}, '2026-10-01T09:00:00Z');`);
    out.push(`INSERT INTO deposits(user_id, amount_cents, provider, provider_reference, status, created_at, confirmed_at, operation_id) VALUES (${q(userId)}, ${opening}, 'demo', ${q(ref)}, 'CONFIRMED', '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', (SELECT id FROM settlement_operations WHERE idempotency_key = ${q(`opening-${userId}`)}));`);
    for (const h of holds) {
      const holdId = `c${h.order.id.slice(1)}`;
      out.push(`INSERT INTO cash_holds(id, user_id, purpose, order_id, requested_amount_cents, confirmed_amount_cents, status) VALUES (${q(holdId)}, ${q(userId)}, 'BUY_ORDER', ${q(h.order.id)}, ${h.amount}, ${h.amount}, 'ACTIVE');`);
      entry(`hold:${holdId}:active`, "HOLD", [[acct("CUSTOMER_AVAILABLE", userId), "DEBIT", h.amount], [acct("CUSTOMER_RESERVED", userId), "CREDIT", h.amount]]);
    }
  }

  out.push(`-- ${cardSeq} delivered cards`);
  out.push("COMMIT;");
  return out.join("\n");
}

function playerSql(p: Player): string {
  // Same name split as the fixture provider, so a first import changes nothing.
  const [first = "", ...rest] = p.displayName.split(" ");
  return (
    `INSERT INTO players(id, display_name, first_name, last_name, birth_date, nationality, career_status, data_quality, primary_admission, is_fictional) VALUES ` +
    `(${q(p.id)}, ${q(p.displayName)}, ${q(first)}, ${q(rest.join(" "))}, ${q(p.birthDate)}, ${q(p.nationality)}, ${q(p.careerStatus)}, ${q(p.dataQuality)}, ${q(p.primaryAdmission)}, true);\n` +
    `INSERT INTO provider_player_mappings VALUES ('fixture', ${q(p.id)}, ${q(p.id)});\n` +
    `INSERT INTO player_team_memberships(player_id, team_id, membership_type, valid_from) VALUES (${q(p.id)}, ${q(p.teamId)}, 'FIRST_TEAM', ${q(p.previousTeamId ? "2026-09-01" : "2026-07-01")});` +
    (p.previousTeamId
      ? `\nINSERT INTO player_team_memberships(player_id, team_id, membership_type, valid_from, valid_to) VALUES (${q(p.id)}, ${q(p.previousTeamId)}, 'FIRST_TEAM', '2026-07-01', '2026-09-01');`
      : "")
  );
}

function isMainModule(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  if (process.env.APP_MODE !== "demo") {
    console.error("Seed geweigerd: demodata mag alleen in APP_MODE=demo worden geladen.");
    process.exit(1);
  }
  process.stdout.write(seedSql() + "\n");
}
