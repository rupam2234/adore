import { NextResponse } from 'next/server';
import { requireAdminPage } from '@/utils/admin-session';
import { revalidatePath } from 'next/cache';
import { isAdminRequest } from '@/utils/admin-auth';
import {
  bookReversePickup,
  fulfilExchange,
  markReceived,
  recordQcVerdict,
  ReturnsOpsError,
  reviewReturn,
  settleRefund,
} from '@/utils/returns-ops';

/**
 * The action an admin is taking. Deliberately a closed union — the endpoint
 * dispatches on it, so an unrecognised string cannot reach any handler.
 */
const ACTIONS = [
  'approve',
  'reject',
  'book_pickup',
  'mark_received',
  'qc_pass',
  'qc_fail',
  'settle',
  'fulfil_exchange',
] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/admin/returns/[id] — perform one operations action.
 *
 * Every action is a separate, idempotent call rather than a batch, so a
 * double-click, a browser retry, or two admins working the same queue can never
 * compound into a double refund: each call re-reads state, and the state
 * machine plus the compare-and-set writes make a repeat a no-op.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as Action)) {
    return NextResponse.json(
      { error: 'Unknown action', code: 'BAD_ACTION' },
      { status: 400 }
    );
  }

  // Who is doing this. An audit log that records only "admin" is worthless the
  // first time a refund needs defending.
  const admin = await requireAdminPage();
  const actor = admin.email;

  // Free-text fields are length-capped before they reach the database. An
  // unbounded string in `notes` is a storage-abuse vector, and it would be
  // rendered straight back into the admin UI.
  const note = (v: unknown) =>
    typeof v === 'string' ? v.trim().slice(0, 2000) : undefined;
  const reason = (v: unknown) =>
    typeof v === 'string' ? v.trim().slice(0, 1000) : undefined;

  try {
    switch (action as Action) {
      case 'approve': {
        const result = await reviewReturn(id, actor, {
          approve: true,
          notes: note(body.notes),
        });
        if (!result.ok) {
          return NextResponse.json(
            {
              error: result.message,
              code: result.code,
              blockReason: result.blockReason,
            },
            { status: result.code === 'STALE' ? 409 : 422 }
          );
        }
        break;
      }

      case 'reject': {
        const rejectionReason = reason(body.reason);
        if (!rejectionReason) {
          return NextResponse.json(
            {
              error: 'A reason is required to refuse a return.',
              code: 'REASON_REQUIRED',
            },
            { status: 400 }
          );
        }
        const result = await reviewReturn(id, actor, {
          approve: false,
          rejectionReason,
          notes: note(body.notes),
        });
        if (!result.ok) {
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: 409 }
          );
        }
        break;
      }

      case 'book_pickup': {
        const result = await bookReversePickup(id, actor);
        if (!result.ok) {
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: result.code === 'STALE' ? 409 : 422 }
          );
        }
        return NextResponse.json({ ...result, ok: true });
      }

      case 'mark_received': {
        const result = await markReceived(id, actor);
        if (!result.ok) {
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: 422 }
          );
        }
        break;
      }

      case 'qc_pass': {
        const result = await recordQcVerdict(id, actor, true, {
          restockable: body.restockable !== false,
        });
        if (!result.ok) {
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: 422 }
          );
        }
        break;
      }

      case 'qc_fail': {
        const result = await recordQcVerdict(id, actor, false, {
          reason: reason(body.reason),
        });
        if (!result.ok) {
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: 400 }
          );
        }
        break;
      }

      case 'settle': {
        const result = await settleRefund(id, actor);
        // GATEWAY_PENDING is success-shaped: the money IS on its way. Reporting
        // it as an error would make an admin click again, and the second click
        // is the exact thing this system exists to survive.
        if (!result.ok && result.code !== 'GATEWAY_PENDING') {
          return NextResponse.json(
            { error: result.message, code: result.code },
            {
              status:
                result.code === 'IN_FLIGHT' || result.code === 'STALE'
                  ? 409
                  : 422,
            }
          );
        }
        return NextResponse.json({ ...result, ok: true });
      }

      case 'fulfil_exchange': {
        const result = await fulfilExchange(id, actor);
        if (!result.ok) {
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: 422 }
          );
        }
        return NextResponse.json({ ...result, ok: true });
      }
    }

    revalidatePath('/admin/returns');
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ReturnsOpsError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error('[admin/returns] action failed:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
