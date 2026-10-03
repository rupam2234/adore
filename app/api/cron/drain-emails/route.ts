import { NextResponse } from 'next/server';
import { drainEmailJobs, emailJobStats, oldestPendingAgeSeconds } from '@/utils/email-queue';

/**
 * GET/POST /api/cron/drain-emails — the backstop, not the main path.
 *
 * The queue consumer (app/api/queues/send-email) is what normally sends email.
 * This exists for the one case the queue cannot cover: a job written to
 * `email_jobs` whose queue message was never published or was dropped. Because
 * the row is the ledger, that job is still sitting there PENDING — this job
 * finds and sends it.
 *
 * It is deliberately DAILY, not every minute:
 *   - Vercel Hobby only permits once-daily crons anyway.
 *   - Cron invocations are free and unmetered on Vercel, so an idle day costs
 *     nothing.
 *   - The delay only matters for the rare dropped message, and a customer waiting
 *     a few hours for a retry is far better off than one who never gets it.
 * On Pro, tighten to every 15 minutes if you want faster recovery.
 *
 * Auth: a bearer token compared in constant time, copied from
 * /api/cron/reconcile-refunds. Cron endpoints are public URLs, and an
 * unauthenticated one here would let anyone trigger outbound email.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically for scheduled
 * runs, so no manual plumbing is needed once CRON_SECRET is set.
 */

const CRON_SECRET = process.env.CRON_SECRET ?? '';

function authorised(request: Request): boolean {
  if (!CRON_SECRET) return false; // fail closed if unconfigured
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token.length !== CRON_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ CRON_SECRET.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  try {
    const summary = await drainEmailJobs(25);
    const [stats, oldestPending] = await Promise.all([
      emailJobStats(),
      oldestPendingAgeSeconds(),
    ]);

    // DEAD jobs are reported rather than swallowed: they are emails a customer
    // will never receive, and this log line is the only signal that exists.
    if (summary.dead > 0) {
      console.error(
        `[cron/drain-emails] ${summary.dead} job(s) exhausted retries and are DEAD`,
        stats
      );
    }

    return NextResponse.json({
      ok: true,
      ...summary,
      jobs: stats,
      oldestPendingAgeSeconds: oldestPending,
      stalled: oldestPending !== null && oldestPending > 86400,
    });
  } catch (error) {
    console.error('[cron/drain-emails] failed:', error);
    return NextResponse.json(
      { error: 'Email drain failed' },
      { status: 500 }
    );
  }
}