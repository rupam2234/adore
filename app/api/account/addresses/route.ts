import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/utils/request-user';
import {
  ensureCustomerForUserId,
  createAddress,
  listAddresses,
  parseAddressPayload,
} from '@/utils/account';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const customer = await ensureCustomerForUserId(userId);
    return NextResponse.json({ addresses: await listAddresses(customer.id) });
  } catch {
    return NextResponse.json(
      { error: 'Could not load addresses' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payload = parseAddressPayload(body);
  if (typeof payload === 'string') {
    return NextResponse.json({ error: payload }, { status: 400 });
  }

  try {
    const customer = await ensureCustomerForUserId(userId);
    await createAddress(customer.id, payload);
    return NextResponse.json(
      { addresses: await listAddresses(customer.id) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Could not save address' },
      { status: 500 }
    );
  }
}
