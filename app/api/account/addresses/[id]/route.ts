import { NextResponse } from "next/server";
import { getSessionUserId } from "@/utils/request-user";
import {
  ensureCustomerForUserId,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  listAddresses,
  parseAddressPayload,
} from "@/utils/account";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Context) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const customer = await ensureCustomerForUserId(userId);

    if (body.action === "setDefault") {
      await setDefaultAddress(customer.id, id);
      return NextResponse.json({ addresses: await listAddresses(customer.id) });
    }

    const payload = parseAddressPayload(body);
    if (typeof payload === "string") {
      return NextResponse.json({ error: payload }, { status: 400 });
    }
    await updateAddress(customer.id, id, payload);
    return NextResponse.json({ addresses: await listAddresses(customer.id) });
  } catch {
    return NextResponse.json({ error: "Could not update address" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Context) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  try {
    const customer = await ensureCustomerForUserId(userId);
    await deleteAddress(customer.id, id);
    return NextResponse.json({ addresses: await listAddresses(customer.id) });
  } catch {
    return NextResponse.json({ error: "Could not delete address" }, { status: 500 });
  }
}
