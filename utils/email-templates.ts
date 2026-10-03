/**
 * Email templates.
 *
 * WHY PLAIN TABLE HTML INSTEAD OF A REACT-EMAIL PIPELINE
 * -----------------------------------------------------
 * Outlook (Word engine) does not support flexbox, CSS grid, background images on
 * elements, or most modern selectors. A template built from modern layout
 * primitives looks fine in a browser preview and renders as an unreadable
 * single-column pile in Outlook. Everything below is tables and inline styles.
 *
 * That means no JSX, no build step, and a template is just a string: it can be
 * previewed by writing an .html file and unit-tested without a renderer.
 *
 * Every template returns BOTH html and text. The text version is not optional:
 * it is the fallback in Outlook's plain-text mode and for screen readers, and it
 * is part of what keeps a message out of the spam folder.
 *
 * Brand palette matches the storefront:
 *   ink #2B2620 · cream #FAF8F3 · olive #5C6B4B · gold #C9962E · rose #A45A4B
 */

const BRAND = {
  ink: '#2B2620',
  cream: '#FAF8F3',
  olive: '#5C6B4B',
  gold: '#C9962E',
  rose: '#A45A4B',
  muted: 'rgba(43,38,32,0.6)',
  border: 'rgba(43,38,32,0.15)',
} as const;

/** Replies to transactional mail land here rather than bouncing. */
export const REPLY_TO = 'hello@adore.ind.in';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://adore.ind.in';

export type EmailTemplate = { subject: string; html: string; text: string };

/** Escape untrusted text before it goes into HTML. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Paragraph helper, so templates stay readable. */
function p(text: string): string {
  return `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${BRAND.muted};">${text}</p>`;
}

/** Callout box for important values (order numbers, amounts, reasons). */
function callout(label: string, valueHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:10px;"><tr><td style="padding:16px 18px;"><p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};">${esc(label)}</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:${BRAND.ink};">${valueHtml}</p></td></tr></table>`;
}

/**
 * The greeting line every template opens with.
 *
 * This exists as a function rather than as copy pasted into each template
 * because an earlier version interpolated the name straight into `p(...)`, which
 * let raw HTML from `customers.first_name` through unescaped. Routing every
 * greeting through one esc()'d helper means a new template cannot reintroduce
 * the hole, and the tests can assert the behaviour once.
 *
 * Only the first name is used: a full name in an email subject-adjacent line
 * reads colder, and it halves the amount of user-controlled text exposed.
 */
function greeting(customerName: string): string {
  const first = (customerName ?? '').trim().split(/\s+/)[0] ?? '';
  return p(`Hello ${esc(first)},`);
}

/** Rough HTML->text for the plain alternative. Good enough for a fallback. */
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The shared shell every template renders into.
 *
 * `preheader` is the grey preview line shown in the inbox beside the subject. It
 * is the highest-leverage line in the email: most recipients decide whether to
 * open on it rather than the subject. Hidden with the standard zero-height
 * spacer trick so it does not render as body text.
 */
function layout(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}): { html: string; text: string } {
  const { preheader, heading, bodyHtml, cta, footerNote } = opts;

  const ctaRow = cta
    ? `<tr><td align="center" style="padding:20px 32px 8px;"><a href="${esc(cta.url)}" style="display:inline-block;background:${BRAND.ink};color:${BRAND.cream};text-decoration:none;padding:14px 32px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:15px;">${esc(cta.label)}</a></td></tr>`
    : '';

  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;">
<tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${BRAND.border};">
<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:0.08em;color:${BRAND.ink};text-transform:uppercase;">Adore</p>
</td></tr>
<tr><td style="padding:28px 32px 8px;">
<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:${BRAND.ink};font-weight:normal;">${esc(heading)}</h1>
${bodyHtml}
</td></tr>
${ctaRow}
<tr><td style="padding:28px 32px;border-top:1px solid ${BRAND.border};">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:${BRAND.muted};">
${footerNote ? esc(footerNote) + '<br>' : ''}
Need help? Reply to this email or write to <a href="mailto:${REPLY_TO}" style="color:${BRAND.olive};">${REPLY_TO}</a>.
</p>
<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.muted};">
You are receiving this because you have an order with Adore. <a href="${SITE_URL}" style="color:${BRAND.muted};">Visit our store</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,

    text: [
      'Adore',
      '',
      heading,
      '',
      stripTags(bodyHtml),
      ...(cta ? ['', cta.label, cta.url] : []),
      '',
      ...(footerNote ? [footerNote] : []),
      `Need help? Reply to this email or write to ${REPLY_TO}.`,
      '',
      `You are receiving this because you have an order with Adore.`,
      `Visit our store: ${SITE_URL}`,
    ].join('\n'),
  };
}

export function orderConfirmed(input: {
  to: string;
  customerName: string;
  orderNumber: string;
  items: Array<{ name: string; qty: number; price: string }>;
  total: string;
}): EmailTemplate {
  const rows = input.items
    .map(
      item => `<tr>
  <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${BRAND.ink};">${esc(item.name)}${item.qty > 1 ? ` <span style="color:${BRAND.muted};">&times;${item.qty}</span>` : ''}</td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${BRAND.ink};white-space:nowrap;">${esc(item.price)}</td>
</tr>`
    )
    .join('');

  const itemsTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
${rows}
<tr><td style="padding:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${BRAND.ink};">Total</td>
<td align="right" style="padding:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:17px;color:${BRAND.ink};font-weight:bold;white-space:nowrap;">${esc(input.total)}</td></tr>
</table>`;

  const { html, text } = layout({
    preheader: `Order ${input.orderNumber} confirmed. Total ${input.total}.`,
    heading: `Thank you, ${esc((input.customerName ?? '').trim().split(/\s+/)[0] ?? '')}`,
    bodyHtml:
      p(`We have your order and payment is confirmed. We are getting your pieces ready now, and you will get another email with tracking once the parcel is on its way.`) +
      callout('Order number', esc(input.orderNumber)) +
      itemsTable,
    cta: { label: 'View your order', url: `${SITE_URL}/account/orders` },
  });

  return { subject: `Order ${input.orderNumber} confirmed`, html, text };
}

/* ==========================================================================
   2. RETURN REJECTED
   The highest-stakes template in the set: it is the one your returns policy
   explicitly promises, it is emotionally charged to receive, and it is where
   silence turns into a chargeback. The reason is shown prominently and the tone
   is deliberately plain rather than apologetic, because a rejection is usually
   the customer's own doing and over-apologising invites argument.
   ========================================================================== */

export function returnRejected(input: {
  to: string;
  customerName: string;
  orderNumber: string;
  reason: string;
  photoUrls?: string[];
}): EmailTemplate {
  const photos = (input.photoUrls ?? []).filter(Boolean);

  // Photos go in a horizontally scrollable row: Outlook ignores max-width, so
  // the cells carry fixed widths instead of percentages.
  const photosBlock = photos.length
    ? `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};">Photos from our inspection</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
${photos
  .map(
    url =>
      `<td style="padding-right:8px;"><img src="${esc(url)}" width="140" alt="Inspection photo" style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:1px solid ${BRAND.border};display:block;"></td>`
  )
  .join('')}
</tr></table>`
    : '';

  const { html, text } = layout({
    preheader: `Your return for order ${input.orderNumber} was not accepted.`,
    heading: 'About your return',
    bodyHtml:
      greeting(input.customerName) +
      p(`We have finished inspecting the item from order ${esc(input.orderNumber)}.`) +
      p(`We were not able to accept this return. The reason is below, and it is the same one shown on your returns page.`) +
      callout('Reason', esc(input.reason)) +
      photosBlock +
      p(`If you think we have judged this unfairly, reply to this email. A person, not an automated rule, will review it and get back to you.`) +
      p(`If you would rather have the item sent back to you, the cost is yours to pay. Please collect it within 30 days, after which it may be disposed of.`),
    footerNote: `Order ${input.orderNumber}`,
    cta: { label: 'View your returns', url: `${SITE_URL}/account/returns` },
  });

  return { subject: `Your return for order ${input.orderNumber}`, html, text };
}

/* ==========================================================================
   3. REFUND PROCESSED
   Sent when a refund actually settles. Timing matters here: this is the email
   customers forward to their bank when they query a credit, so it states the
   amount and the destination method plainly rather than burying them.
   ========================================================================== */

export function refundProcessed(input: {
  to: string;
  customerName: string;
  orderNumber: string;
  amount: string;
  /** Net of fees, or gross? The customer cares about what lands in the account. */
  method?: string;
}): EmailTemplate {
  const methodRow = input.method
    ? callout('Refund amount', `<span style="font-size:18px;">${esc(input.amount)}</span> <span style="font-size:13px;color:${BRAND.muted};">to your ${esc(input.method)}</span>`)
    : callout('Refund amount', `<span style="font-size:18px;">${esc(input.amount)}</span>`);

  const { html, text } = layout({
    preheader: `${input.amount} refunded for order ${input.orderNumber}.`,
    heading: 'Your refund is on its way',
    bodyHtml:
      greeting(input.customerName) +
      p(`We have refunded your return and the money is leaving our account.`) +
      callout('Order number', esc(input.orderNumber)) +
      methodRow +
      p(`Bank transfers usually appear within 3 to 5 working days, depending on your bank. Nothing further is needed from you.`) +
      p(`If it has not reached you after a week, reply to this email with your bank reference and we will chase it for you.`),
    cta: { label: 'View your order', url: `${SITE_URL}/account/orders` },
  });

  return { subject: `Refund issued for order ${input.orderNumber}`, html, text };
}

/* ==========================================================================
   4. REFUND FAILED
   The one email nobody wants to send. The important design choice is that it
   does NOT apologise for a delay, because we do not know yet whether it is a
   bank error or a bug on our side. It states that the refund is safe, that the
   customer owes nothing, and that we are handling it. Saying "please do not
   duplicate it" prevents the customer opening a second dispute.
   ========================================================================== */

export function refundFailed(input: {
  to: string;
  customerName: string;
  orderNumber: string;
  amount: string;
}): EmailTemplate {
  const { html, text } = layout({
    preheader: `We are sorting out your refund for order ${input.orderNumber}.`,
    heading: 'Your refund needs attention',
    bodyHtml:
      greeting(input.customerName) +
      p(`We were not able to complete your refund automatically.`) +
      callout('Refund amount', `<span style="font-size:18px;">${esc(input.amount)}</span>`) +
      p(`Your refund is safe and our team is already on it. You do not need to do anything, and you do not need to request it again.`) +
      p(`If money leaves your account before we confirm, that is your bank reversing a pending authorisation, and we will chase it with them directly.`),
    footerNote: `Order ${input.orderNumber}`,
    cta: { label: 'View your returns', url: `${SITE_URL}/account/returns` },
  });

  return { subject: `We are sorting out your refund (order ${input.orderNumber})`, html, text };
}

/* ==========================================================================
   5. ORDER SHIPPED
   Carries the tracking link, which is the only reason most recipients open it.
   The tracking URL is placed in a callout as well as the button, because that is
   the part that gets copy-pasted into a search.
   ========================================================================== */

export function orderShipped(input: {
  to: string;
  customerName: string;
  orderNumber: string;
  trackingUrl?: string;
  courierName?: string;
}): EmailTemplate {
  const courier = input.courierName ? ` via ${input.courierName}` : '';
  const tracking = input.trackingUrl
    ? callout('Track your parcel', `<a href="${esc(input.trackingUrl)}" style="color:${BRAND.olive};">${esc(input.trackingUrl)}</a>`)
    : '';

  const { html, text } = layout({
    preheader: `Order ${input.orderNumber} is on its way.`,
    heading: 'Your order has shipped',
    bodyHtml:
      greeting(input.customerName) +
      p(`Your parcel has left our warehouse${esc(courier)}.` ) +
      callout('Order number', esc(input.orderNumber)) +
      tracking +
      p(`Tracking can take up to 24 hours to show movement after the courier scans it. Please allow for that before checking again.`),
    cta: input.trackingUrl
      ? { label: 'Track your parcel', url: input.trackingUrl }
      : { label: 'View your order', url: `${SITE_URL}/account/orders` },
  });

  return { subject: `Order ${input.orderNumber} has shipped`, html, text };
}