'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clearPendingOrder } from '@/utils/reservations';

export async function retryCheckout(formData: FormData) {
  const orderId = formData.get('orderId') as string | null;
  if (!orderId) return;

  await clearPendingOrder(orderId);

  revalidatePath('/account/orders');
  revalidatePath('/account/orders/[id]');

  redirect('/checkout');
}