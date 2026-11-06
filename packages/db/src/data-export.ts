/**
 * A person's own data, for inspection and export (privacy: right of access
 * and data portability). Only rows about this person; counterparties are
 * never named (they appear as "andere klant"). Money is in integer cents.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "./client.ts";

export async function exportUserData(db: Executor, userId: string) {
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute<Record<string, unknown>>(q)).rows;
  const profile = (await rows(sql`
    SELECT u.created_at, u.last_login_at, p.display_name, p.residence_country, p.verification_status::text, p.age_confirmed
      FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ${userId}`))[0] ?? null;
  return {
    exportedAt: new Date().toISOString(),
    note: "Bedragen in eurocenten. Tegenpartijen worden niet genoemd.",
    profile,
    termsAccepted: await rows(sql`SELECT document_key, document_version, accepted_at FROM terms_acceptances WHERE user_id = ${userId} ORDER BY accepted_at`),
    balances: await rows(sql`SELECT type::text, balance_cents FROM ledger_accounts WHERE owner_user_id = ${userId} ORDER BY type`),
    ledgerLines: await rows(sql`
      SELECT e.occurred_at, e.kind, a.type::text AS account, l.side, l.amount_cents
        FROM journal_lines l JOIN ledger_accounts a ON a.id = l.ledger_account_id JOIN journal_entries e ON e.id = l.journal_entry_id
       WHERE a.owner_user_id = ${userId} ORDER BY e.occurred_at, l.id`),
    deposits: await rows(sql`SELECT id, amount_cents, status, created_at, confirmed_at FROM deposits WHERE user_id = ${userId} ORDER BY created_at`),
    withdrawals: await rows(sql`SELECT id, amount_cents, status, created_at, completed_at FROM withdrawals WHERE user_id = ${userId} ORDER BY created_at`),
    payoutAccounts: await rows(sql`SELECT provider, status, display_ref, created_at FROM payment_accounts WHERE user_id = ${userId}`),
    orders: await rows(sql`
      SELECT o.id, p.display_name AS player, o.side::text, o.limit_price_cents, o.time_in_force::text, o.state::text,
             o.qty_original, o.qty_filled, o.qty_cancelled, o.qty_expired, o.accepted_at, o.expires_at, o.closed_at
        FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id JOIN players p ON p.id = pm.player_id
       WHERE o.user_id = ${userId} ORDER BY o.accepted_at`),
    trades: await rows(sql`
      SELECT x.id, p.display_name AS player, CASE WHEN x.buyer_user_id = ${userId} THEN 'BUY' ELSE 'SELL' END AS side,
             x.price_cents, CASE WHEN x.seller_user_id = ${userId} THEN x.fee_cents END AS commission_cents, x.status::text, x.matched_at, x.settled_at
        FROM executions x JOIN player_markets pm ON pm.id = x.player_market_id JOIN players p ON p.id = pm.player_id
       WHERE x.buyer_user_id = ${userId} OR x.seller_user_id = ${userId} ORDER BY x.matched_at`),
    cards: await rows(sql`
      SELECT c.id, p.display_name AS player, e.season_key, c.serial_number, c.status::text, c.cost_basis_cents
        FROM cards c JOIN editions e ON e.id = c.edition_id JOIN players p ON p.id = c.player_id
       WHERE c.owner_user_id = ${userId} ORDER BY p.display_name, c.serial_number`),
    subscriptions: await rows(sql`
      SELECT s.id, p.display_name AS player, s.status::text, s.price_cents, s.created_at, s.outcome_at
        FROM subscriptions s JOIN drops d ON d.id = s.drop_id JOIN editions e ON e.id = d.edition_id JOIN players p ON p.id = e.player_id
       WHERE s.user_id = ${userId} ORDER BY s.created_at`),
    notifications: await rows(sql`SELECT template, payload, created_at, read_at FROM notification_outbox WHERE user_id = ${userId} ORDER BY created_at`),
    activity: await rows(sql`SELECT occurred_at, action, entity_type FROM audit_events WHERE actor_id = ${userId} OR (entity_type = 'user' AND entity_id = ${userId}) ORDER BY occurred_at`),
  };
}
