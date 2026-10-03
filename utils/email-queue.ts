/**
 * Email outbox: enqueue, claim, settle.
 *
 * The design in one paragraph: `enqueue()` writes a durable row BEFORE any send
 * is attempted, so a crash can never lose an email. A worker then claims due
 * rows and sends them. Two independent guards stop duplicates â€” a UNIQUE
 * `dedupe_key` so the same logical email is only ever enqueued once, and that
 * same key passed to Resend as `Idempotency-Key` so at-least-once delivery
 * cannot produce a second email either.
 *
 * Writes go through rawQuery rather than Drizzle because claiming needs
 * `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)`, which the query
 * builder cannot express. Everything here is raw SQL for that reason, not for
 * style.
 *
 * Why SKIP LOCKED: two workers (the queue consumer and the backstop cron) can
 * run at once. SKIP LOCKED makes each claim a disjoint set of rows, so they
 * never block each other and never process the same job twice.
 *
 * IMPORTANT: this uses neon-http, which cannot open a multi-statement
 * transaction. So "enqueue in the same transaction as the order" is not
 * available. That is precisely why idempotency lives in the DATA (the unique
 * key) rather than in a transaction boundary â€” the property survives the
 * limitation.
 */
import { rawQuery, sql } from './db';
import { dispatchEmailJob } from './email';
import type { EmailFlow } from './schema';

import { MAX_ATTEMPTS, backoffMs, settleFailure, STALE_SENDING_SECONDS } from './email-lifecycle';
export { MAX_ATTEMPTS, backoffMs, settleFailure, buildDedupeKey, STALE_SENDING_SECONDS } from './email-lifecycle';

export type EmailJob = {
  id: string;
  flow: EmailFlow;
  to: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  attempts: number;
};

/**
 * Record that an email needs sending. Returns false if it was already queued.
 *
 * Never throws. Enqueueing happens on the checkout and returns paths, so a
 * failure here must not roll back a paid order â€” it is logged and dropped, and
 * a missing email is the acceptable trade against failing the payment.
 *
 * `dedupeKey` should be `<flow>/<entity-id>`: it is both our uniqueness key
 * and Resend's idempotency key.
 */
export async function enqueueEmail(input: {
  flow: EmailFlow;
  to: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}): Promise<boolean> {
  try {
    const rows = await rawQuery<{ id: string }>(sql`
      INSERT INTO email_jobs (flow, to, payload, dedupe_key)
      VALUES (
        ${input.flow},
        ${input.to},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.dedupeKey}
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `);
    return rows.length > 0;
  } catch (err) {
    console.error('[email-queue] enqueue failed:', input.dedupeKey, err);
    return false;
  }
}

/**
 * Atomically claim up to `limit` due jobs, moving them to SENDING.
 *
 * One statement does the whole claim: select due rows while locking them, then
 * flip them to SENDING and bump the attempt counter in the same UPDATE. Two
 * round-trips would leave a window where two workers select the same rows.
 *
 * WHY THE ROW IS FLIPPED TO SENDING, NOT LEFT PENDING
 * --------------------------------------------------
 * `FOR UPDATE SKIP LOCKED` only holds its lock for the duration of the
 * statement. If a claimed row stayed PENDING, a second worker running a
 * microsecond later would simply claim the same row again â€” verified against the
 * live database, where two consecutive claims returned the same job. That is not
 * a theoretical race: it means duplicate sends every time the queue consumer and
 * the backstop cron overlap.
 *
 * Flipping to SENDING inside the claiming UPDATE closes that window, because the
 * claim predicate only selects PENDING rows. A worker that then dies mid-send
 * leaves the job stuck in SENDING, which is what `requeueStuckJobs` is for.
 *
 * `attempts` is incremented on CLAIM, not on failure. That is deliberate: if a
 * worker dies mid-send the attempt is still counted, so a job that reliably
 * kills its worker eventually reaches DEAD instead of retrying forever.
 */
export async function claimEmailJobs(limit = 10): Promise<EmailJob[]> {
  const rows = await rawQuery<{
    id: string;
    flow: EmailFlow;
    to: string;
    payload: Record<string, unknown>;
    dedupe_key: string;
    attempts: number;
  }>(sql`
    WITH due AS (
      SELECT id
      FROM email_jobs
      WHERE status = 'PENDING' AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT ${Math.max(1, Math.min(limit, 50))}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_jobs j
    SET status = 'SENDING', attempts = j.attempts + 1
    FROM due
    WHERE j.id = due.id
    RETURNING j.id, j.flow, j."to", j.payload, j.dedupe_key, j.attempts
  `);
  return rows.map(r => ({
    id: r.id,
    flow: r.flow,
    to: r.to,
    payload: r.payload ?? {},
    dedupeKey: r.dedupe_key,
    attempts: Number(r.attempts),
  }));
}

/**
 * Return SENDING jobs that were claimed but never settled back to the worker
 * being killed (a deploy, an OOM, a timeout mid-send).
 *
 * Called at the start of every drain. Anything older than `staleAfterSeconds` is
 * treated as abandoned and made claimable again. The attempt counter is NOT
 * reset, so a job that reliably kills its worker still walks up to DEAD instead
 * of looping forever.
 */
export async function requeueStuckJobs(
  staleAfterSeconds = STALE_SENDING_SECONDS
): Promise<number> {
  const rows = await rawQuery<{ id: string }>(sql`
    UPDATE email_jobs
    SET status = 'PENDING', next_attempt_at = now()
    WHERE status = 'SENDING'
      AND next_attempt_at < now() - (${staleAfterSeconds}::text || ' seconds')::interval
    RETURNING id
  `);
  return rows.length;
}

/** Mark a job as delivered. */
export async function markEmailSent(
  id: string,
  providerId?: string
): Promise<void> {
  await rawQuery(sql`
    UPDATE email_jobs
    SET status = 'SENT', sent_at = now(), provider_id = ${providerId ?? null},
        last_error = NULL
    WHERE id = ${id}
  `);
}

/**
 * Record a failed attempt, then either schedule the retry or mark it DEAD.
 *
 * DEAD is a real terminal state rather than an error string: a job that has
 * exhausted its retries must be visible to a human, and the only way to make it
 * visible is to stop retrying it and leave it queryable.
 */
export async function markEmailFailed(
  id: string,
  error: string
): Promise<'RETRY' | 'DEAD'> {
  const attempt = await rawQuery<{ attempts: number }>(sql`
    SELECT attempts FROM email_jobs WHERE id = ${id}
  `);
  const attempts = Number(attempt[0]?.attempts ?? MAX_ATTEMPTS);
  const dead = settleFailure(attempts) === 'DEAD';

  await rawQuery(sql`
    UPDATE email_jobs
    SET status = ${dead ? 'DEAD' : 'PENDING'},
        last_error = ${error.slice(0, 500)},
        next_attempt_at = now() + (${backoffMs(attempts)}::text || ' milliseconds')::interval
    WHERE id = ${id}
  `);
  return dead ? 'DEAD' : 'RETRY';
}

/**
 * Counts for the health endpoint and for tests.
 *
 * Grouped in one round-trip because on neon-http each query is its own HTTP
 * request, and this is called from a status route where latency is visible.
 */
export async function emailJobStats(): Promise<
  Record<'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD', number>
> {
  const rows = await rawQuery<{ status: string; n: number }>(sql`
    SELECT status, COUNT(*)::int AS n
    FROM email_jobs
    GROUP BY status
  `);
  const out = {
    PENDING: 0,
    SENDING: 0,
    SENT: 0,
    FAILED: 0,
    DEAD: 0,
  } as Record<'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD', number>;
  for (const r of rows) {
    if (r.status in out) out[r.status as keyof typeof out] = Number(r.n);
  }
  return out;
}

/**
 * Nudge the queue so a drain happens promptly.
 *
 * BEST EFFORT BY DESIGN. The job row is already committed, so failing to publish
 * is not a lost email â€” it is a delayed one, which the daily backstop cron will
 * pick up. That is why this never throws: it is called from checkout, and a
 * queue outage must not fail a customer's payment.
 *
 * The `@vercel/queue` SDK is imported dynamically and by specifier string so the
 * module is not bundled unless the trigger is configured. Without it, or without
 * the topic, enqueueing still works and only the latency changes â€” the design
 * does not depend on this call succeeding.
 */
async function notifyQueue(): Promise<void> {
  try {
    const mod = await import('@vercel/queue' as string);
    // Signature is `send(topicName, payload)` — topic FIRST. This is the
    // top-level export, not `new QueueClient().send`; both exist, and the
    // top-level one reads its connection config from the deployment.
    const send = (mod as {
      send?: (
        topic: string,
        body: unknown
      ) => Promise<{ messageId: string | null }>;
    }).send;
    if (typeof send !== 'function') return;

    const result = await send('email', { at: Date.now() });

    // SendResult.messageId is null when Vercel accepted the message for
    // DEFERRED processing (server-side outage) instead of queueing it now. The
    // email is not lost — the row is still PENDING and the backstop cron will
    // find it — but the latency has silently changed, so it is worth a log line
    // rather than looking identical to a normal publish.
    if (result && result.messageId === null) {
      console.warn(
        '[email-queue] queue accepted the message for deferred processing; ' +
          'delivery will rely on the backstop cron'
      );
    }
  } catch (err) {
    // Logged, not thrown. The row is the ledger; this is only the courier.
    console.warn('[email-queue] queue notify failed (backstop will catch it):', err);
  }
}

export type EnqueueResult = {
  /** True if a new job row was created. False if it already existed. */
  enqueued: boolean;
};

/**
 * The ONE call sites should make: record the email, then ask for a drain.
 *
 * Combines the durable write and the best-effort queue publish so no trigger can
 * accidentally do one without the other.
 */
export async function enqueueAndNotify(input: {
  flow: EmailFlow;
  to: string;
  payload: Record<string, unknown>;
  /** `<flow>/<entity-id>`, e.g. 'order_confirmed/AD-1001'. */
  dedupeKey: string;
}): Promise<EnqueueResult> {
  const enqueued = await enqueueEmail(input);
  // Only nudge when something was actually enqueued: a duplicate should not
  // trigger a pointless drain (and therefore a pointless Resend round-trip).
  if (enqueued) await notifyQueue();
  return { enqueued };
}

/**
 * Drain the outbox: claim due jobs and send them.
 *
 * This is the ONE place that claims and settles jobs, shared by two callers:
 *
 *   - the Vercel Queues consumer (fast path, seconds after an order)
 *   - the daily backstop cron (catches rows whose queue message was lost)
 *
 * Sharing it means the retry, backoff and idempotency behaviour cannot drift
 * between the two, and both benefit from requeueing abandoned SENDING rows.
 *
 * Sequential on purpose. Resend's rate limit is per-second and a batch of 20 is
 * nothing to it, while 20 concurrent HTTP calls from one serverless instance
 * would just add latency and risk a 429. Correctness and simplicity beat
 * throughput at this volume.
 */
export async function drainEmailJobs(
  limit = 10
): Promise<{
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  requeued: number;
}> {
  // Recover anything a previous worker abandoned mid-send before claiming, so a
  // deploy during a send cannot strand a job in SENDING forever.
  const requeued = await requeueStuckJobs();

  const jobs = await claimEmailJobs(limit);
  const summary = { claimed: jobs.length, sent: 0, retried: 0, dead: 0, requeued };

  for (const job of jobs) {
    try {
      const result = await dispatchEmailJob({
        flow: job.flow,
        to: job.to,
        payload: job.payload,
        dedupeKey: job.dedupeKey,
      });

      if (result.ok) {
        await markEmailSent(job.id, result.providerId);
        summary.sent += 1;
        continue;
      }

      // A missing API key means email is not configured in this environment.
      // Retrying would just burn attempts, so settle it as DEAD immediately and
      // let the operator see the reason rather than a pile of silent failures.
      if (result.skipped) {
        console.warn('[email-queue] send skipped (no API key):', job.dedupeKey);
        await markEmailFailed(job.id, result.error ?? 'skipped');
        summary.dead += 1;
        continue;
      }

      const outcome = await markEmailFailed(
        job.id,
        result.error ?? 'send failed'
      );
      if (outcome === 'DEAD') summary.dead += 1;
      else summary.retried += 1;
    } catch (err) {
      // dispatchEmailJob swallows its own errors, so reaching here means the
      // DATABASE call failed (claim/settle). Never let one bad row abort the
      // rest of the batch.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[email-queue] job crashed:', job.dedupeKey, message);
      try {
        const outcome = await markEmailFailed(job.id, message);
        if (outcome === 'DEAD') summary.dead += 1;
        else summary.retried += 1;
      } catch {
        // Cannot even record the failure; it stays SENDING and is requeued by
        // the stale-job sweep on the next drain.
      }
    }
  }

  return summary;
}

/** Age of the oldest unsent job, for alerting on a stalled queue. */
export async function oldestPendingAgeSeconds(): Promise<number | null> {
  const rows = await rawQuery<{ age: number | null }>(sql`
    SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int AS age
    FROM email_jobs
    WHERE status = 'PENDING'
  `);
  const age = rows[0]?.age;
  return age === null || age === undefined ? null : Number(age);
}
