import { NextResponse } from 'next/server';
import { drainEmailJobs, emailJobStats, oldestPendingAgeSeconds } from '@/utils/email-queue';

/**
 * POST /api/queues/send-email — Vercel Queues consumer (the fast path).
 *
 * Invoked by Vercel only when a message lands on the `email` topic, so there is
 * NO polling: an idle site makes zero calls. The producer side (enqueueEmail)
 * publishes after the order commits.
 *
 * The message body is intentionally IGNORED. It only signals "there is probably
 * work"; the actual jobs are read from `email_jobs`, which is the durable
 * ledger. That means a lost or duplicated queue message cannot lose or repeat an
 * email — the worst a bad message can do is trigger a drain that finds nothing.
 *
 * Auth: queue consumers are invoked by Vercel's infrastructure, not by users,
 * so there is no user-facing surface here. The CRON_SECRET check lives on the
 * backstop route, which IS a public URL.
 *
 * Configured by experimentalTriggers in vercel.json:
 *   { "type": "queue/v2beta", "topic": "email" }
 *
 * Body is drained in a loop because one queue message may correspond to several
 * enqueued jobs (a batch publish), and because a burst can enqueue more than one
 * batch size. Bounded so a spike cannot run past the function timeout.
 */

const MAX_BATCHES = 5;
const BATCH_SIZE = 10;

export async function POST() {
  const totals = { claimed: 0, sent: 0, retried: 0, dead: 0, requeued: 0 };

  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = await drainEmailJobs(BATCH_SIZE);
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[k] += batch[k];
      }
      // A short batch means the queue is drained; another pass would find
      // nothing and only cost a query.
      if (batch.claimed < BATCH_SIZE) break;
    }

    return NextResponse.json({ ok: true, ...totals });
  } catch (error) {
    console.error('[queues/send-email] failed:', error);
    // A non-2xx tells Vercel to redeliver the message, which is what we want:
    // the jobs are still PENDING in the database and the retry will find them.
    return NextResponse.json(
      { error: 'Email drain failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/queues/send-email — queue health.
 *
 * Deliberately a separate verb from POST so it is never confused with the
 * consumer callback, and so a health check cannot accidentally trigger a drain.
 * Surfaced rather than logged because "the queue is stuck" is the failure mode
 * nobody notices until a customer complains about missing mail.
 */
export async function GET() {
  const [stats, oldestPending] = await Promise.all([
    emailJobStats(),
    oldestPendingAgeSeconds(),
  ]);
  return NextResponse.json({
    ok: true,
    jobs: stats,
    oldestPendingAgeSeconds: oldestPending,
    // A job pending for over an hour means the queue or cron is not running.
    stalled: oldestPending !== null && oldestPending > 3600,
  });
}