/**
 * Outbound transactional email.
 *
 * Deliberately does NOT depend on the `resend` SDK: Resend's REST API is one
 * `fetch` call, and a zero-dependency implementation means no supply-chain
 * surface, no version drift, and no build step for a feature that is essentially
 * "POST a JSON body". Swapping providers later means changing sendEmail() only.
 *
 * THE ONE RULE: sending must never break the thing that triggered it. A paid
 * order must not fail because Resend timed out, and a rejected return must not
 * fail to save because an email bounced. Every entry point here therefore
 * swallows provider errors and returns a result object instead of throwing.
 */

export type EmailResult = {
  ok: boolean;
  id?: string;
  /**
   * Resend's message id. Distinct from `id`, and needed to correlate a later
   * delivery/bounce webhook back to its job.
   */
  providerId?: string;
  /** Present when ok is false. Never surfaced to the customer. */
  error?: string;
  /** True when no API key is configured, i.e. email is silently skipped. */
  skipped?: boolean;
};

function getApiKey(): string | undefined {
  // Read lazily so importing this module never throws where env is absent.
  return process.env.RESEND_API_KEY;
}

/**
 * Default sender address.
 *
 * Overridable with RESEND_FROM. The default requires `adore.ind.in` to be a
 * VERIFIED domain in Resend; sending from an unverified domain silently drops
 * to spam, which is worse than not sending because it looks like it worked.
 */
const DEFAULT_FROM = 'Adore <hello@adore.ind.in>';

function resolveFrom(from?: string): string {
  return from ?? process.env.RESEND_FROM ?? DEFAULT_FROM;
}

/**
 * Send one email. Never throws.
 *
 * Errors are caught and returned rather than raised because every caller sits on
 * a critical path (checkout, returns approval, refund settlement) where a thrown
 * error would roll back or 500 a transaction the customer already paid for.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  /** Metadata for filtering in the Resend dashboard. */
  tags?: Array<{ name: string; value: string }>;
  /**
   * Suppresses duplicate sends. Resend retains these for 24 hours and returns
   * the original response instead of sending again, which is what makes
   * at-least-once queue delivery safe to retry. Max 256 chars.
   */
  idempotencyKey?: string;
}): Promise<EmailResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set, skipping:', input.subject);
    return { ok: false, skipped: true, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Header name and semantics per Resend's docs. Omitted entirely when
        // absent rather than sent empty, since an empty value is a 400.
        ...(input.idempotencyKey
          ? { 'Idempotency-Key': input.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from: resolveFrom(input.from),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
      }),
    });

    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) {
      const message =
        (body as { message?: string }).message ?? `HTTP ${res.status}`;
      console.error('[email] send failed:', input.subject, message);
      return { ok: false, error: message };
    }
    return {
      ok: true,
      id: (body as { id?: string }).id,
      // Resend returns the same id on an idempotent replay, so storing this
      // unconditionally is safe — a retry just rewrites the same value.
      providerId: (body as { id?: string }).id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[email] send threw:', input.subject, message);
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget send, for call sites that must not block the response.
 *
 * `void` is deliberate: the promise is intentionally not awaited, and sendEmail
 * already swallows its own errors, so this can never surface an unhandled
 * rejection. Use it where waiting would add latency to a user-facing request.
 */
export function sendEmailInBackground(
  input: Parameters<typeof sendEmail>[0]
): void {
  void sendEmail(input);
}

/**
 * Typed email flows.
 *
 * Each function builds a template and hands it to the transport. Keeping these
 * separate from the transport means a template can be rendered and asserted in a
 * test without network access, and a transport failure can never be mistaken for
 * a rendering bug.
 *
 * None of these throw; every one returns an EmailResult.
 */
import {
  orderConfirmed,
  orderShipped,
  refundFailed,
  refundProcessed,
  returnRejected,
  welcomeEmail,
  REPLY_TO,
  type EmailTemplate,
  type OrderLine,
} from './email-templates';

type SendArgs = {
  to: string;
  /** Only the first name is used in copy, to keep it human. */
  name: string;
  /**
   * Optional Resend idempotency key. The queue dispatcher always supplies the
   * job's dedupeKey so a retry can never send twice; direct calls omit it.
   */
  idempotencyKey?: string;
};

/**
 * Tag every send with its flow so bounces and complaints can be filtered per
 * flow in the Resend dashboard. Cheap to add now, painful to retrofit.
 */
function tags(flow: string, ref?: string) {
  return [
    { name: 'flow', value: flow },
    ...(ref ? [{ name: 'order', value: ref }] : []),
  ];
}

/**
 * Render then send.
 *
 * The public flow functions take `name` (what a caller naturally has on hand:
 * the user's display name) while the templates take `customerName`. Mapping
 * here keeps that rename in one place instead of at every call site.
 *
 * `T` is the template's own input type, so each template keeps full type
 * checking against its declared fields rather than being widened to a shape
 * that would accept anything.
 */
async function deliver<T extends { to: string; customerName: string }>(
  flow: string,
  ref: string | undefined,
  to: string,
  render: (args: T) => EmailTemplate,
  args: Omit<T, 'to' | 'customerName'> & SendArgs
): Promise<EmailResult> {
  // `name` and `idempotencyKey` are extras the templates ignore; the rest of
  // args matches T exactly. Cast through unknown because TS cannot prove the
  // Omit<T,...> & SendArgs intersection is assignable to the unresolved T.
  const tpl = render({ ...args, to, customerName: args.name } as unknown as T);
  const idempotencyKey = args.idempotencyKey;
  return sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    replyTo: REPLY_TO,
    tags: tags(flow, ref),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

/* --- Queue dispatch -------------------------------------------------------
 *
 * The queue worker does not call the send* helpers above directly: it only has
 * the stored `payload` jsonb, so it needs a single dispatcher that turns
 * (flow, payload) back into a send. Keeping that mapping in ONE place means
 * adding a flow touches the schema, the template and this table — not every
 * call site.
 */

export type QueueEmailPayload = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' ? v : fallback;
const arr = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];

/**
 * Render and send one enqueued job.
 *
 * Returns a result rather than throwing, because this runs inside a worker
 * where one bad job must not abort the batch. An unrecognised flow is reported
 * as a permanent failure so the job goes DEAD and becomes visible, rather than
 * retrying forever against a bug.
 */
export async function dispatchEmailJob(input: {
  flow: string;
  to: string;
  payload: QueueEmailPayload;
  dedupeKey: string;
}): Promise<EmailResult> {
  const { to, payload, dedupeKey } = input;
  const name = str(payload.customerName, 'there');
  const orderNumber = str(payload.orderNumber);

  // Every send below carries dedupeKey as Resend's Idempotency-Key, so a retry
  // of this exact job cannot produce a second email.
  switch (input.flow) {
    case 'order_confirmed':
      return sendOrderConfirmed({
        to,
        name,
        orderNumber,
        items: arr(payload.items).map(i => ({
          name: str(i.name),
          qty: num(i.qty, 1),
          price: str(i.price),
          imageUrl: typeof i.imageUrl === 'string' ? i.imageUrl : undefined,
        })),
        total: str(payload.total),
        idempotencyKey: dedupeKey,
      });

    case 'order_shipped':
      return sendOrderShipped({
        to,
        name,
        orderNumber,
        trackingUrl: typeof payload.trackingUrl === 'string' ? payload.trackingUrl : undefined,
        courierName: typeof payload.courierName === 'string' ? payload.courierName : undefined,
        items: arr(payload.items).map(i => ({
          name: str(i.name),
          qty: num(i.qty, 1),
          imageUrl: typeof i.imageUrl === 'string' ? i.imageUrl : undefined,
        })),
        idempotencyKey: dedupeKey,
      });

    case 'return_rejected':
      return sendReturnRejected({
        to,
        name,
        orderNumber,
        reason: str(payload.reason),
        photoUrls: arr(payload.photoUrls).map(p => str(p)).filter(Boolean),
        idempotencyKey: dedupeKey,
      });

    case 'refund_processed':
      return sendRefundProcessed({
        to,
        name,
        orderNumber,
        amount: str(payload.amount),
        method: typeof payload.method === 'string' ? payload.method : undefined,
        idempotencyKey: dedupeKey,
      });

    case 'refund_failed':
      return sendRefundFailed({ to, name, orderNumber, amount: str(payload.amount), idempotencyKey: dedupeKey });

    case 'welcome_email':
      return sendWelcomeEmail({
        to,
        name,
        promoCode: typeof payload.promoCode === 'string' ? payload.promoCode : null,
        promoValidFor:
          typeof payload.promoValidFor === 'string' ? payload.promoValidFor : undefined,
        discountPercent:
          typeof payload.discountPercent === 'number'
            ? payload.discountPercent
            : undefined,
        minimumOrder:
          typeof payload.minimumOrder === 'string'
            ? payload.minimumOrder
            : undefined,
        idempotencyKey: dedupeKey,
      });

    default:
      // Permanent: retrying an unknown flow cannot ever succeed.
      console.error('[email] unknown flow:', input.flow, 'key:', dedupeKey);
      return { ok: false, error: `unknown flow: ${input.flow}` };
  }
}

/* --- Order lifecycle ------------------------------------------------------ */

export function sendOrderConfirmed(
  args: SendArgs & {
    orderNumber: string;
    items: OrderLine[];
    total: string;
  }
): Promise<EmailResult> {
  return deliver('order_confirmed', args.orderNumber, args.to, orderConfirmed, args);
}

export function sendOrderShipped(
  args: SendArgs & {
    orderNumber: string;
    trackingUrl?: string;
    courierName?: string;
    items?: OrderLine[];
  }
): Promise<EmailResult> {
  return deliver('order_shipped', args.orderNumber, args.to, orderShipped, args);
}

/* --- Returns & refunds ---------------------------------------------------- */

export function sendReturnRejected(
  args: SendArgs & {
    orderNumber: string;
    reason: string;
    photoUrls?: string[];
  }
): Promise<EmailResult> {
  return deliver('return_rejected', args.orderNumber, args.to, returnRejected, args);
}

export function sendRefundProcessed(
  args: SendArgs & {
    orderNumber: string;
    amount: string;
    method?: string;
  }
): Promise<EmailResult> {
  return deliver('refund_processed', args.orderNumber, args.to, refundProcessed, args);
}

export function sendRefundFailed(
  args: SendArgs & { orderNumber: string; amount: string }
): Promise<EmailResult> {
  return deliver('refund_failed', args.orderNumber, args.to, refundFailed, args);
}

/* --- Lifecycle ------------------------------------------------------------ */

/**
 * The signup email. `ref` is the user id, not an order number, which is what
 * makes `welcome_email/<user-id>` a stable dedupe key: a retried signup cannot
 * send a second copy even though the user pressed the button twice.
 */
export function sendWelcomeEmail(
  args: SendArgs & {
    promoCode?: string | null;
    promoValidFor?: string;
    discountPercent?: number;
    minimumOrder?: string;
  }
): Promise<EmailResult> {
  return deliver('welcome_email', undefined, args.to, welcomeEmail, args);
}


