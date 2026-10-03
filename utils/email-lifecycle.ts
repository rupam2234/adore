
/**
 * Email job lifecycle RULES, with no database or network dependency.
 *
 * Split from utils/email-queue.ts so these can be unit-tested without importing
 * utils/db (which throws at module load when DATABASE_URL is absent). The queue
 * module imports from here; nothing here imports back.
 *
 * One copy of each rule, so the queue consumer and the backstop cron cannot
 * disagree about when a job dies.
 */

/** Give up after this many attempts and mark the job DEAD for inspection. */
export const MAX_ATTEMPTS = 5;

/**
 * Exponential backoff, capped at 15 minutes.
 *
 * 1m, 2m, 4m, 8m, 15m... A permanent failure (a 422 from Resend) is retried this
 * way too, which is why the backoff is capped rather than unbounded: the job
 * still reaches DEAD in well under an hour instead of drifting into next week
 * where nobody would notice it.
 */
export function backoffMs(attempts: number): number {
  const base = 60_000;
  return Math.min(base * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

/** Every status an email job can be in. */
export type EmailJobStatus =
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'DEAD';

/**
 * Decide whether a claimed job should be retried or written off.
 *
 * `attempts` is the value AFTER the claim incremented it, so the very first
 * send is attempts = 1.
 */
export function settleFailure(attempts: number): 'RETRY' | 'DEAD' {
  return attempts >= MAX_ATTEMPTS ? 'DEAD' : 'RETRY';
}

/**
 * How long a SENDING row may sit before it is presumed abandoned.
 *
 * A worker killed mid-send (deploy, OOM, timeout) leaves the row in SENDING
 * forever. Five minutes is far longer than a single Resend call, so a slow but
 * alive worker is never robbed of its job.
 */
export const STALE_SENDING_SECONDS = 300;

/**
 * The Resend `Idempotency-Key` and UNIQUE column value for one logical email.
 *
 * The shape is a contract, not a convention:
 *   - `<flow>/<entity-id>` keeps it unique per email, so two orders cannot
 *     collide and silently drop the second order confirmation.
 *   - It must NOT contain a timestamp. A retry that recomputed the key from
 *     Date.now() would produce a NEW key and Resend would treat it as a new
 *     email, which is the exact duplicate this exists to prevent.
 *   - Must fit Resend's 256-character limit.
 */
export function buildDedupeKey(flow: string, entityId: string): string {
  return `${flow}/${entityId}`;
}
