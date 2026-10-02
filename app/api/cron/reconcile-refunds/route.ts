import { NextResponse } from 'next/server';
import { reconcileRefunds } from '@/utils/returns-ops';

/**
 * GET/POST /api/cron/reconcile-refunds
 *
 * The crash-recovery path for refunds. `settleRefund` claims a return, writes a
 * ledger row, and only THEN calls Razorpay — so if the process dies between the
 * claim and the response, we have a refund we know nothing about.
 *
 * This job resolves those by ASKING Razorpay what happened, never by blindly
 * sending another refund. That distinction is the whole point: a retry loop that
 * re-sends on every timeout is how a business pays the same customer twice.
 *
 * SCHEDULE (vercel.json): daily at 03:00 UTC. The project is on the Hobby plan,
 * which allows cron jobs but only once per day — a 15-minute schedule would be
 * rejected at deploy time. Daily is also the right cadence here anyway: this
 * only resolves refunds whose process died mid-call, so an hour of delay costs
 * a customer one extra day at worst. Move to Pro for tighter intervals.
 *
 * Auth: a bearer token compared in constant time. Cron endpoints are public URLs,
 * and an unauthenticated one here would let anyone trigger gateway calls.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically for scheduled
 * runs, so no manual token plumbing is needed once CRON_SECRET is set.
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
    const result = await reconcileRefunds(50);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron/reconcile-refunds] failed:', error);
    return NextResponse.json(
      { error: 'Reconciliation failed' },
      { status: 500 }
    );
  }
}