/**
 * Unit tests for the email templates.
 *
 * Run: node --test utils/email-templates.test.ts
 *
 * Pure string builders, so no network and no framework — same convention as the
 * other utils tests.
 *
 * These cases target the ways a template goes wrong in production: unescaped
 * user data reaching the HTML (injection), a missing plain-text alternative
 * (spam filter / screen reader), and a missing preheader (the inbox shows a
 * useless first line).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc,
  orderConfirmed,
  orderShipped,
  refundFailed,
  refundProcessed,
  returnRejected,
  welcomeEmail,
} from './email-templates.ts';

const base = { to: 'a@b.com', customerName: 'Asha Rao', orderNumber: 'AD-1001' };

/**
 * Count inspection photos by their alt text rather than by `<img`.
 *
 * Every template also carries the header logo, so a bare `<img` count is not a
 * count of photos and silently breaks whenever the shell gains another image.
 */
function countInspectionPhotos(html: string): number {
  return (html.match(/<img [^>]*alt="Inspection photo"/g) ?? []).length;
}

const ALL = {
  orderConfirmed: () =>
    orderConfirmed({
      ...base,
      items: [{ name: 'Floral Meadow', qty: 1, price: '₹2,499.00' }],
      total: '₹2,499.00',
    }),
  orderShipped: () =>
    orderShipped({
      ...base,
      trackingUrl: 'https://track.example/abc',
      courierName: 'Shiprocket',
    }),
  returnRejected: () =>
    returnRejected({ ...base, reason: 'Item was worn' }),
  refundProcessed: () =>
    refundProcessed({ ...base, amount: '₹2,499.00' }),
  refundFailed: () => refundFailed({ ...base, amount: '₹2,499.00' }),
};

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

test('esc neutralises the characters that break out of HTML', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(esc("it's"), 'it&#39;s');
});

test('esc handles null and undefined without producing the word "null"', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
  // A literal "null" in an email is a bug that ships to customers.
  assert.ok(!esc(null).includes('null'));
});

// ---------------------------------------------------------------------------
// Every template: structural requirements
// ---------------------------------------------------------------------------

for (const [name, build] of Object.entries(ALL)) {
  test(`${name}: produces a subject, html and a plain-text alternative`, () => {
    const tpl = build();
    assert.ok(tpl.subject.length > 0, 'subject must not be empty');
    assert.ok(tpl.html.startsWith('<!DOCTYPE html>'), 'must be a full document');
    assert.ok(tpl.text.length > 0, 'plain-text alternative is required');
  });

  test(`${name}: includes a hidden preheader for the inbox preview`, () => {
    // Without this the inbox shows the first body line as the preview, which is
    // usually "Adore" or a stray sentence.
    assert.match(build().html, /display:none;max-height:0/);
  });

  test(`${name}: html and text agree, with no unresolved values`, () => {
    const tpl = build();
    assert.ok(tpl.html.includes('AD-1001'));
    assert.ok(tpl.text.includes('AD-1001'));
    assert.ok(!tpl.html.includes('undefined'), 'no undefined in html');
    assert.ok(!tpl.text.includes('undefined'), 'no undefined in text');
  });
}

test('a product name containing HTML is escaped, not rendered', () => {
  const tpl = orderConfirmed({
    ...base,
    items: [{ name: '<img src=x onerror="alert(1)">', qty: 1, price: '₹100.00' }],
    total: '₹100.00',
  });
  assert.ok(!tpl.html.includes('<img src=x'), 'raw tag must not survive');
  assert.ok(tpl.html.includes('&lt;img'), 'tag should appear escaped');
});

test('a rejection reason containing a script tag is escaped', () => {
  const tpl = returnRejected({
    ...base,
    reason: '<script>alert("xss")</script>',
  });
  assert.ok(!tpl.html.includes('<script>alert'));
  assert.ok(tpl.html.includes('&lt;script&gt;'));
});

test('a tracking URL is escaped so it cannot break out of the href', () => {
  const tpl = orderShipped({
    ...base,
    trackingUrl: 'https://x.example/"><script>alert(1)</script>',
  });
  assert.ok(!tpl.html.includes('"><script>'));
});

test('only the first name is used in the greeting, so a tag is never rendered', () => {
  // The greeting takes customerName.split(' ')[0], so "<b>Admin</b>" reduces to
  // "Admin" before escaping ever runs. Asserting on the real behaviour: no raw
  // tag reaches the output either way.
  const tpl = refundFailed({
    ...base,
    customerName: '<b>Admin</b>',
    amount: 'INR 100.00',
  });
  assert.ok(!tpl.html.includes('<b>Admin</b>'), 'raw tag must not survive');
  assert.ok(tpl.html.includes('Admin'), 'the name itself should still appear');
});

test('a single-word name with a tag is escaped rather than dropped', () => {
  // No space, so split() keeps the whole string and esc() is what neutralises it.
  const tpl = refundFailed({
    ...base,
    customerName: '<script>x</script>',
    amount: 'INR 100.00',
  });
  assert.ok(!tpl.html.includes('<script>x'), 'raw tag must not survive');
  assert.ok(tpl.html.includes('&lt;script&gt;'), 'tag should appear escaped');
});

// ---------------------------------------------------------------------------
// Copy that matters for money and for tone
// ---------------------------------------------------------------------------

test('refundFailed tells the customer not to request the refund again', () => {
  // Without this the customer opens a second dispute and we lose the chargeback
  // case. This sentence is load-bearing, not decoration.
  const tpl = refundFailed({ ...base, amount: '₹100.00' });
  assert.match(tpl.text, /do not need to request it again/i);
});

test('returnRejected states the reason and offers human review', () => {
  const tpl = returnRejected({ ...base, reason: 'Item was worn' });
  assert.ok(tpl.html.includes('Item was worn'));
  // Matches the published returns policy, which promises a person reviews it.
  assert.match(tpl.text, /not an automated rule/i);
});

test('refundProcessed states the amount and the destination method', () => {
  const tpl = refundProcessed({ ...base, amount: '₹2,499.00', method: 'UPI' });
  assert.ok(tpl.text.includes('₹2,499.00'));
  assert.ok(tpl.text.includes('UPI'));
});

test('orderConfirmed shows a quantity multiplier only when qty > 1', () => {
  const one = orderConfirmed({
    ...base,
    items: [{ name: 'Dress', qty: 1, price: '₹100' }],
    total: '₹100',
  });
  assert.ok(!one.html.includes('&times;1'), 'no pointless "x1"');

  const two = orderConfirmed({
    ...base,
    items: [{ name: 'Dress', qty: 3, price: '₹300' }],
    total: '₹300',
  });
  assert.ok(two.html.includes('&times;3'));
});

test('orderShipped falls back to the orders page when tracking is unknown', () => {
  const tpl = orderShipped({ ...base });
  // Do not render an empty "Track your parcel" box when there is no link.
  assert.ok(!tpl.html.includes('Track your parcel'));
  assert.match(tpl.text, /View your order/);
});

test('orderShipped shows the tracking URL in text as well as the button', () => {
  const tpl = orderShipped({ ...base, trackingUrl: 'https://track.example/abc' });
  // The tracking link is the reason most people open this email, and it is the
  // part people copy out, so it must exist in the plain-text version too.
  assert.ok(tpl.text.includes('https://track.example/abc'));
});

test('inspection photos render as images with alt text', () => {
  const tpl = returnRejected({
    ...base,
    reason: 'Damaged',
    photoUrls: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
  });
  // Counted by the photo-specific alt text, NOT by `<img` — every template now
  // also carries the header logo, so a bare image count breaks every time the
  // shell gains an image.
  assert.equal(countInspectionPhotos(tpl.html), 2);
  assert.ok(tpl.html.includes('alt="Inspection photo"'));
});

test('blank photo URLs are dropped rather than rendering empty images', () => {
  const tpl = returnRejected({
    ...base,
    reason: 'Damaged',
    photoUrls: ['', 'https://cdn.example/2.jpg'],
  });
  assert.equal(countInspectionPhotos(tpl.html), 1);
});

/* --- Order emails ---------------------------------------------------------- */

const IMG = 'https://res.cloudinary.com/adore/image/upload/w_128/floral.jpg';

test('order emails show product names and thumbnails', () => {
  for (const tpl of [
    orderConfirmed({
      ...base,
      items: [{ name: 'Floral Meadow', qty: 1, price: '₹2,499.00', imageUrl: IMG }],
      total: '₹2,499.00',
    }),
    orderShipped({
      ...base,
      items: [{ name: 'Floral Meadow', qty: 1, imageUrl: IMG }],
    }),
  ]) {
    assert.ok(tpl.html.includes('Floral Meadow'), 'product name missing');
    assert.ok(tpl.html.includes(IMG), 'thumbnail missing');
    // Alt text carries the name, so a client that blocks images still says
    // what the order contains.
    assert.ok(tpl.html.includes('alt="Floral Meadow"'));
  }
});

test('an order line with no image still shows its name', () => {
  const tpl = orderConfirmed({
    ...base,
    items: [{ name: 'Ivory Bloom', qty: 1, price: '₹3,299.00' }],
    total: '₹3,299.00',
  });
  assert.ok(tpl.html.includes('Ivory Bloom'));
  // No placeholder: an empty grey box reads as "out of stock", which is a lie.
  assert.ok(!/placeholder/i.test(tpl.html));
  assert.equal(countInspectionPhotos(tpl.html), 0);
});

test('the shipping email lists items but no prices', () => {
  const tpl = orderShipped({
    ...base,
    trackingUrl: 'https://track.example/abc',
    items: [{ name: 'Floral Meadow', qty: 1, price: '₹2,499.00', imageUrl: IMG }],
  });
  assert.ok(tpl.html.includes('Floral Meadow'));
  // showPrice is false, so the price is deliberately absent even though the
  // caller supplied one — "these are arriving", not "this is what they cost".
  assert.ok(!tpl.html.includes('2,499'));
});

test('the shipping email renders when no items are supplied', () => {
  const tpl = orderShipped({ ...base });
  assert.ok(tpl.html.includes('Your order has shipped'));
});

/* --- Branding -------------------------------------------------------------- */

/** Every template, including the welcome email in both of its variants. */
const SHELL = () => [
  ...Object.entries(ALL).map(([name, build]) => [name, build().html] as const),
  ['welcome', welcomeEmail({ ...base, promoCode: 'WELCOME10-QB2CKU' }).html],
  ['welcome-no-code', welcomeEmail({ ...base, promoCode: null }).html],
];

test('every template carries the logo with an absolute URL and alt text', () => {
  for (const [name, html] of SHELL()) {
    assert.ok(
      html.includes('/images/Adore_logo.png'),
      `${name}: logo missing`
    );
    // A relative src renders as a broken image in every mail client.
    assert.ok(
      !/src="\/images\/Adore_logo\.png"/.test(html),
      `${name}: logo src must not be root-relative`
    );
    // Clients that block remote images show alt text instead, so a missing alt
    // would leave a blank header rather than the brand name.
    assert.ok(html.includes('alt="Adore"'), `${name}: logo needs alt text`);
  }
});

test('every template requests the brand fonts', () => {
  for (const [name, html] of SHELL()) {
    assert.ok(html.includes('fonts.googleapis.com'), `${name}: no font link`);
    assert.ok(html.includes('Geist'), `${name}: no sans stack`);
    // The SERIF stack is only present where a heading renders. The welcome
    // email suppresses its <h1>, so it correctly never emits one — asserting
    // it everywhere would be asserting a bug.
    const rendersHeading = html.includes('<h1');
    assert.equal(
      html.includes('Playfair Display'),
      rendersHeading,
      `${name}: serif stack should be present exactly when a heading renders`
    );
  }
});

test('the welcome code renders in a dark panel, monospace and smaller', () => {
  const tpl = welcomeEmail({
    to: 'a@b.com',
    customerName: 'Asha Rao',
    promoCode: 'WELCOME10-QB2CKU',
    promoValidFor: '30 days',
  });
  // Dark background behind the code.
  assert.ok(tpl.html.includes('background:#2B2620'));
  // Monospace, so WELCOME1O cannot be misread as WELCOME10.
  assert.ok(tpl.html.includes('SFMono-Regular'));
  // Small: the previous version rendered it at 20px.
  assert.ok(tpl.html.includes('font-size:15px'));
});

test('a welcome code is optional and the email survives without one', () => {
  const tpl = welcomeEmail({ ...base, promoCode: null });
  assert.ok(tpl.html.includes('Hello Asha'), 'body should still open on the greeting');
  assert.ok(!tpl.html.includes('Your welcome code'));
});

/**
 * showHeading defaults to true; only the welcome email opts out.
 *
 * Both halves matter. Without the first, a future refactor could flip the
 * default and silently strip headings from every transactional email. Without
 * the second, the opt-out could spread.
 */
test('only the welcome email suppresses its visible heading', () => {
  for (const [name, build] of Object.entries(ALL)) {
    assert.ok(build().html.includes('<h1'), `${name} lost its heading`);
  }

  const tpl = welcomeEmail({ ...base, promoCode: 'WELCOME10-QB2CKU' });
  // Suppressed in the visible body and in the plain-text alternative...
  assert.ok(!tpl.html.includes('<h1'));
  assert.ok(!tpl.text.includes('Welcome to Adore'));
  // ...but still carried by the subject and the <title>.
  assert.ok(tpl.subject.includes('Welcome to Adore'));
  assert.ok(tpl.html.includes('<title>Welcome to Adore</title>'));
});