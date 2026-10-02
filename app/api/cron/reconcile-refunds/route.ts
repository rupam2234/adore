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
 * Auth: a bearer token compared in constant time. Cron endpoints are public URLs,
 * and an unauthenticated one here would let anyone trigger gateway calls.
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