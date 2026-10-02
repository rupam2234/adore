/**
 * The returns audit log.
 *
 * Split out from utils/returns-ops.ts so the customer-facing submit path
 * (utils/returns-db.ts) can write its opening event without importing the
 * operations layer — and with it the Razorpay and Shiprocket adapters. A
 * customer submitting a return should not pay to load code that talks to our
 * payment provider.
 *
 * The table is append-only and is the shared source of truth for three things:
 *   - the customer-facing timeline (mapped through an allow-list);
 *   - the admin's per-request history;
 *   - the forensic record used when a refund is disputed.
 */

import { rawQuery, sql } from '@/utils/db';

export type ReturnEventInput = {
  returnRequestId: string;
  event: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor: string;
  data?: Record<string, unknown>;
};

/**
 * Append to the immutable event log.
 *
 * Called on every transition, and deliberately never allowed to fail the
 * transition: an audit write that blocks a customer's refund because of a
 * deadlock is a worse outcome than a missing audit row. Failures are logged
 * loudly instead, and the reconciler can rebuild gaps.
 */
export async function recordEvent(input: ReturnEventInput): Promise<void> {
  try {
    await rawQuery(sql`
      INSERT INTO return_events
        (id, return_request_id, event, from_status, to_status, actor, data)
      VALUES (
        ${crypto.randomUUID()},
        ${input.returnRequestId},
        ${input.event},
        ${input.fromStatus ?? null},
        ${input.toStatus ?? null},
        ${input.actor},
        ${JSON.stringify(input.data ?? {})}
      )
    `);
  } catch (error) {
    console.error(
      `[returns] audit write failed for ${input.returnRequestId}/${input.event}:`,
      error
    );
  }
}
