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
  /** On dark panels — the muted ink colour is unreadable there. */
  mutedOnInk: 'rgba(250,248,243,0.72)',
} as const;

/**
 * TYPOGRAPHY
 * ----------
 * These mirror the storefront: Playfair Display for display/serif, Geist for
 * body. The fallback in each stack is what actually renders in most inboxes,
 * because web fonts in email are unreliable — Gmail strips `@font-face` from
 * many messages and Outlook uses its own engine regardless.
 *
 * So the stacks are ordered so that a client which cannot load the webfont
 * lands on something close rather than on Times New Roman:
 *   - serif -> Playfair Display -> Georgia -> Times New Roman -> serif
 *     Georgia is the deliberate fallback: it is the closest widely-installed
 *     face to Playfair's high-contrast serif style, and unlike Times it has
 *     the thinner, more modern look the brand relies on.
 *   - sans  -> Geist -> system UI stack -> Helvetica -> Arial -> sans-serif
 *     The system stack (-apple-system / Segoe UI) is what Outlook and most
 *     mobile clients will use, so it comes before Arial deliberately.
 *
 * See FONT_LINK below for how the webfonts are requested.
 */
const FONT = {
  serif: `'Playfair Display',Georgia,'Times New Roman',Times,serif`,
  sans: `Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`,
  /** Monospace stack, used only for promo codes. */
  mono: `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace`,
} as const;

/**
 * Google Fonts request for the two brand faces.
 *
 * `display=swap` matters more than it looks: without it a client that has
 * already cached the page will hold the text invisible until the font arrives.
 * `swap` renders the fallback immediately and swaps when the face loads.
 *
 * This is best-effort by design — the fallback stacks above are what make the
 * email readable if this never loads at all.
 */
const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Geist:wght@400;500;600&display=swap';

/** Replies to transactional mail land here rather than bouncing. */
export const REPLY_TO = 'hello@adore.ind.in';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://adore.ind.in';

/**
 * Absolute URL to the wordmark. Must be absolute — a relative path silently
 * resolves against nothing in an email client and shows a broken image.
 *
 * Served from /public, so it is already cached at the CDN edge in front of the
 * storefront.
 */
const LOGO_URL = `${SITE_URL}/images/Adore_logo.png`;

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
  return `<p style="margin:0 0 14px;font-family:${FONT.sans};font-size:15px;line-height:1.7;color:${BRAND.muted};">${text}</p>`;
}

/** Callout box for important values (order numbers, amounts, reasons). */
function callout(label: string, valueHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:10px;"><tr><td style="padding:16px 18px;"><p style="margin:0 0 4px;font-family:${FONT.sans};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};">${esc(label)}</p><p style="margin:0;font-family:${FONT.sans};font-size:16px;color:${BRAND.ink};">${valueHtml}</p></td></tr></table>`;
}

/**
 * The promo-code panel: dark background, monospace, deliberately small.
 *
 * WHY SMALLER AND MONOSPACED
 * A 15-character code in a display face is a shout. At 17px in Playfair it read
 * as the loudest thing in the email, which made the code look like a warning
 * rather than a gift. At 15px monospace it sits quietly while staying perfectly
 * legible — and monospace is not decoration: it means `WELCOME10-QB2CKU` cannot
 * be misread as `WELCOME1O-QB2CKU` or `WELCOME1O-OB2CKU` when someone types it
 * from a phone, which is where most of these get entered.
 *
 * The dark panel gives the cream code enough contrast to pass WCAG AA at this
 * size, and separates it from the surrounding white card without needing a
 * border. `line-height` is generous because a 15-character string in monospace
 * wraps on narrow mobile clients.
 */
function codePanel(code: string, note?: string): string {
  const noteRow = note
    ? `<p style="margin:10px 0 0;font-family:${FONT.sans};font-size:12px;line-height:1.6;color:${BRAND.mutedOnInk};">${esc(note)}</p>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${BRAND.ink};border-radius:10px;"><tr><td style="padding:18px 18px;text-align:center;"><p style="margin:0 0 8px;font-family:${FONT.sans};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.mutedOnInk};">Your welcome code</p><p style="margin:0;font-family:${FONT.mono};font-size:15px;font-weight:600;letter-spacing:0.06em;line-height:1.5;color:${BRAND.cream};word-break:break-all;">${esc(code)}</p>${noteRow}</td></tr></table>`;
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
  /**
   * Render `heading` as the visible <h1> inside the card. Defaults to true.
   *
   * Set false when the heading duplicates something the reader has already seen.
   * The welcome email is the case: its subject line is "Welcome to Adore — your
   * first-order offer" and the logo above is the wordmark, so a third "Welcome
   * to Adore" as a display heading is noise. `heading` still populates <title>
   * and the subject either way, so the accessible name and the inbox listing
   * are unaffected — only the repeated visible line goes.
   */
  showHeading?: boolean;
}): { html: string; text: string } {
  const {
    preheader,
    heading,
    bodyHtml,
    cta,
    footerNote,
    showHeading = true,
  } = opts;

  const ctaRow = cta
    ? `<tr><td align="center" style="padding:20px 32px 8px;"><a href="${esc(cta.url)}" style="display:inline-block;background:${BRAND.ink};color:${BRAND.cream};text-decoration:none;padding:14px 32px;border-radius:999px;font-family:${FONT.sans};font-size:15px;">${esc(cta.label)}</a></td></tr>`
    : '';

  /**
   * The heading row, or an empty string when suppressed.
   *
   * Kept as one table row rather than conditionally restructuring the markup so
   * the surrounding rows never shift — Outlook is notoriously sensitive to
   * template structure and a missing <tr> can reflow the whole card.
   */
  const headingRow = showHeading
    ? `<h1 style="margin:0 0 16px;font-family:${FONT.serif};font-size:22px;line-height:1.3;color:${BRAND.ink};font-weight:normal;">${esc(heading)}</h1>`
    : '';

  /**
   * Logo, with the wordmark as its alt text.
   *
   * Two reasons the alt is not decorative:
   *   - Any client that blocks remote images (Outlook by default, Gmail on
   *     "display images" prompts) shows alt text INSTEAD of the image, so a
   *     missing alt here means a blank header rather than the brand name.
   *   - It is also the accessible name for screen readers.
   *
   * Intrinsic size is 771x323 (2.39:1) but it is displayed at 96x40, because
   * email clients ignore `width` scaling consistently and declaring the real
   * dimensions makes Outlook reserve a 771px-tall header box on some renderers.
   * `display:block` removes the baseline gap under the image.
   */
  const logo = `<img src="${esc(LOGO_URL)}" width="96" alt="Adore" style="display:block;width:96px;height:auto;border:0;outline:none;text-decoration:none;">`;

  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<title>${esc(heading)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_LINK}">
<style>
  /* Clients that strip <link> still honour inline @font-face. */
  @import url('${FONT_LINK}');
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
  table{border-collapse:collapse!important;}
  body{margin:0!important;padding:0!important;width:100%!important;-webkit-font-smoothing:antialiased;}
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;">
<tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${BRAND.border};">
${logo}
</td></tr>
<tr><td style="padding:28px 32px 8px;">
${headingRow}
${bodyHtml}
</td></tr>
${ctaRow}
<tr><td style="padding:28px 32px;border-top:1px solid ${BRAND.border};">
<p style="margin:0;font-family:${FONT.sans};font-size:12px;line-height:1.7;color:${BRAND.muted};">
${footerNote ? esc(footerNote) + '<br>' : ''}
Need help? Reply to this email or write to <a href="mailto:${REPLY_TO}" style="color:${BRAND.olive};">${REPLY_TO}</a>.
</p>
<p style="margin:14px 0 0;font-family:${FONT.sans};font-size:12px;color:${BRAND.muted};">
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
      // Mirrors headingRow: suppressed in HTML, suppressed here too, so the two
      // renderings do not diverge.
      ...(showHeading ? [heading, ''] : []),
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

/* --- Order line items ------------------------------------------------------ */

/** One line in an order, as the templates need it. */
export type OrderLine = {
  name: string;
  qty?: number;
  /** Omitted by the shipping email, which shows no money. */
  price?: string;
  /** Absolute Cloudinary URL. Omitted when the product has no image. */
  imageUrl?: string;
};

/**
 * A 64px thumbnail, or nothing at all.
 *
 * Deliberately NOT a placeholder when `imageUrl` is missing: a grey box where a
 * dress should be reads as "this product is unavailable", which is a different
 * and worse message than simply showing the name.
 *
 * Outlook ignores `object-fit`, so the frame is a fixed square — the crop may be
 * imperfect on some senders, but the layout never breaks. Fixed width rather
 * than max-width, because Outlook ignores max-width entirely.
 */
function thumb(imageUrl: string | undefined, alt: string): string {
  if (!imageUrl) return '';
  return `<td width="64" valign="top" style="padding:12px 12px 12px 0;">
<img src="${esc(imageUrl)}" width="64" height="64" alt="${esc(alt)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid ${BRAND.border};display:block;">
</td>`;
}

/**
 * The line-item table shared by order_confirmed and order_shipped.
 *
 * Shared rather than duplicated so the two cannot drift apart visually — they
 * exist for different moments, but a customer should not be able to tell from
 * the layout that they came from different parts of the codebase.
 *
 * `showPrice` is false for the shipping email, where the useful information is
 * "these are the things arriving", not what they cost.
 */
function orderItemsTable(
  items: OrderLine[],
  opts: { showPrice: boolean; total?: string }
): string {
  const rows = items
    .map(item => {
      const qty =
        item.qty && item.qty > 1
          ? ` <span style="color:${BRAND.muted};">&times;${item.qty}</span>`
          : '';
      const priceCell =
        opts.showPrice && item.price
          ? `<td align="right" valign="top" style="padding:12px 0;border-bottom:1px solid ${BRAND.border};font-family:${FONT.sans};font-size:15px;color:${BRAND.ink};white-space:nowrap;">${esc(item.price)}</td>`
          : '';
      return `<tr>
${thumb(item.imageUrl, item.name)}
<td valign="top" style="padding:12px 0;border-bottom:1px solid ${BRAND.border};font-family:${FONT.sans};font-size:15px;line-height:1.5;color:${BRAND.ink};">${esc(item.name)}${qty}</td>
${priceCell}
</tr>`;
    })
    .join('');

  const totalRow =
    opts.showPrice && opts.total
      ? `<tr><td style="padding:14px 0 0;font-family:${FONT.sans};font-size:15px;color:${BRAND.ink};">Total</td>
<td align="right" style="padding:14px 0 0;font-family:${FONT.sans};font-size:17px;color:${BRAND.ink};font-weight:bold;white-space:nowrap;">${esc(opts.total)}</td></tr>`
      : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
${rows}
${totalRow}
</table>`;
}

export function orderConfirmed(input: {
  to: string;
  customerName: string;
  orderNumber: string;
  items: OrderLine[];
  total: string;
}): EmailTemplate {
  const itemsTable = orderItemsTable(input.items, {
    showPrice: true,
    total: input.total,
  });
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
    ? `<p style="margin:0 0 6px;font-family:${FONT.sans};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};">Photos from our inspection</p>
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
   6. WELCOME EMAIL
   The one email sent before the customer has any relationship with us, so it
   does the most work: it has to deliver the code we promised in the signup form
   ("Member perks like promo codes, straight away") and be worth opening.

   The code is the reason this email exists, so it gets a callout rather than
   being mentioned in a sentence. When there is no code — the migration has not
   been run, or issuing failed — the template still renders, just without the
   discount block, because a welcome email with no offer still beats no email.
   ========================================================================== */

export function welcomeEmail(input: {
  to: string;
  customerName: string;
  /** Null when no code could be issued for this account. */
  promoCode?: string | null;
  /** Human-readable expiry, e.g. "30 days". Omitted when there is no code. */
  promoValidFor?: string;
  discountPercent?: number;
  minimumOrder?: string;
}): EmailTemplate {
  const codeBlock = input.promoCode
    ? codePanel(
        input.promoCode,
        input.promoValidFor
          ? `Use it within ${input.promoValidFor} on your first order.`
          : undefined
      )
    : '';

  const valueLine = [
    input.discountPercent ? `${input.discountPercent}% off your first order` : '',
    input.minimumOrder ? `on orders over ${input.minimumOrder}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { html, text } = layout({
    preheader: input.promoCode
      ? `${valueLine || 'Your welcome offer is ready'} — code ${input.promoCode}.`
      : 'Welcome to Adore. Here is what happens next.',
    heading: 'Welcome to Adore',
    // The subject line already says "Welcome to Adore" and the logo above is
    // the wordmark, so repeating it as a 22px display heading was saying it a
    // third time. The body now opens on the greeting instead, which is what a
    // real letter does.
    showHeading: false,
    bodyHtml:
      greeting(input.customerName) +
      p(`Thank you for creating an account. Everything you need is here: your orders, your returns, and your addresses, all in one place.`) +
      codeBlock +
      (input.promoCode
        ? p(`Add the code in your bag before you check out. It is tied to your account, so nobody else can use it.`)
        : p(`We will send offers to this address from time to time. You can unsubscribe from any of them using the link below.`)) +
      p(`A note on delivery: we share order updates by email, so if anything looks wrong with an order you will hear from us rather than having to chase it.`),
    cta: { label: 'Start shopping', url: `${SITE_URL}/shop` },
    footerNote: `Signed up as ${input.to}`,
  });

  return { subject: 'Welcome to Adore — your first-order offer', html, text };
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
  /**
   * What's in the parcel. Optional so this email still renders if the caller
   * cannot supply items — a shipping notice with no list beats a 500.
   */
  items?: OrderLine[];
}): EmailTemplate {
  const courier = input.courierName ? ` via ${input.courierName}` : '';
  const tracking = input.trackingUrl
    ? callout('Track your parcel', `<a href="${esc(input.trackingUrl)}" style="color:${BRAND.olive};">${esc(input.trackingUrl)}</a>`)
    : '';

  // Showing what is actually in the box is the single most useful thing this
  // email can do: it is what stops "where is my second kurti?" tickets. Placed
  // after the tracking link so the actionable thing stays above the fold.
  const items = input.items?.length
    ? orderItemsTable(input.items, { showPrice: false })
    : '';

  const { html, text } = layout({
    preheader: `Order ${input.orderNumber} is on its way.`,
    heading: 'Your order has shipped',
    bodyHtml:
      greeting(input.customerName) +
      p(`Your parcel has left our warehouse${esc(courier)}.` ) +
      callout('Order number', esc(input.orderNumber)) +
      tracking +
      items +
      p(`Tracking can take up to 24 hours to show movement after the courier scans it. Please allow for that before checking again.`),
    cta: input.trackingUrl
      ? { label: 'Track your parcel', url: input.trackingUrl }
      : { label: 'View your order', url: `${SITE_URL}/account/orders` },
  });

  return { subject: `Order ${input.orderNumber} has shipped`, html, text };
}