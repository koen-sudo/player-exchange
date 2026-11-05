/**
 * In-app notifications from the outbox (fase 6). E-mail and push follow with
 * a notification provider (NotificationProvider); the outbox already holds
 * one row per event (dedupe key), so nothing is announced twice.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "./client.ts";

export type NotificationRow = { id: string; template: string; payload: Record<string, unknown>; created_at: string; read_at: string | null };

export async function listNotifications(db: Executor, userId: string, limit = 50): Promise<NotificationRow[]> {
  return (await db.execute<NotificationRow>(sql`
    SELECT id, template, payload, created_at::text, read_at::text FROM notification_outbox
     WHERE user_id = ${userId} AND channel = 'IN_APP' ORDER BY created_at DESC LIMIT ${limit}`)).rows;
}

export async function unreadNotifications(db: Executor, userId: string): Promise<number> {
  return (await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM notification_outbox WHERE user_id = ${userId} AND channel = 'IN_APP' AND read_at IS NULL`)).rows[0]!.n;
}

export async function markNotificationsRead(db: Executor, userId: string): Promise<void> {
  await db.execute(sql`UPDATE notification_outbox SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`);
}
