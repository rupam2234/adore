// strip-em-dashes.mjs — rewrites the em dash "—" out of CUSTOMER-FACING copy.
//
// Why this is an explicit table rather than a regex: the em dash does several
// different jobs here, and only a human knows which one each site is doing. A
// blanket " -> ," was tried first and produced worse copy ("No pieces yet,
// check back soon.") plus corrupted comment lines. So every replacement below
// was chosen per site, and the script FAILS LOUDLY on any pair that no longer
// matches rather than silently skipping it.
//
// Deliberately NOT touched:
//   - Code comments (developer-facing; the dash reads fine as an aside).
//   - console.* logging.
//   - Test names/descriptions.
//   - Bare "'—'" table placeholders standing in for a null cell. That is a data
//     glyph in an admin table, not prose; a comma there reads as a typo.
//
// Usage: node scripts/strip-em-dashes.mjs          (dry run)
//        node scripts/strip-em-dashes.mjs --write
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const apply = process.argv.includes('--write');
const D = '—';

/** [file, before, after] — exact substrings, so a reword fails loudly. */
const EDITS = [
  // --- account -----------------------------------------------------------
  ['app/account/orders/[id]/page.tsx',
    `all items are available anymore ${D} stock ran out while your payment`,
    'all items are available anymore. Stock ran out while your payment'],
  ['app/account/page.tsx',
    `No address saved yet ${D} add one to speed up checkout.`,
    'No address saved yet. Add one to speed up checkout.'],

  // --- admin (titles become "| Admin", matching the storefront pattern) ----
  ['app/admin/ledger/page.tsx', `title: 'Order ledger ${D} Admin',`, `title: 'Order ledger | Admin',`],
  ['app/admin/ledger/page.tsx',
    `error = 'Could not load the ledger ${D} check the database connection.';`,
    `error = 'Could not load the ledger. Check the database connection.';`],
  ['app/admin/ledger/page.tsx', `label: 'Revenue ${D} latest paid orders',`, `label: 'Revenue, latest paid orders',`],
  ['app/admin/ledger/page.tsx',
    `No paid orders yet ${D} the ledger fills up as orders are confirmed.`,
    'No paid orders yet. The ledger fills up as orders are confirmed.'],
  ['app/admin/login/login-form.tsx',
    `setError('Network error ${D} is the server running?');`,
    `setError('Network error. Is the server running?');`],
  ['app/admin/products/new/page.tsx', `title: 'New product ${D} Admin',`, `title: 'New product | Admin',`],
  ['app/admin/products/new/page.tsx',
    `Saved as a draft first ${D} upload images, then activate when ready.`,
    'Saved as a draft first. Upload images, then activate when ready.'],
  ['app/admin/products/[id]/page.tsx', `title: 'Edit product ${D} Admin',`, `title: 'Edit product | Admin',`],
  ['app/admin/promos/page.tsx', `title: 'Promo Codes ${D} Admin',`, `title: 'Promo Codes | Admin',`],
  ['app/admin/promos/page.tsx',
    `error = 'Could not load promo codes ${D} check the database connection.';`,
    `error = 'Could not load promo codes. Check the database connection.';`],
  ['app/admin/page.tsx', `title: 'Products ${D} Admin',`, `title: 'Products | Admin',`],
  ['app/admin/page.tsx',
    `error = 'Could not load products ${D} check the database connection.';`,
    `error = 'Could not load products. Check the database connection.';`],
  ['app/admin/page.tsx', `: 'No products yet ${D} create the first one.'}`, `: 'No products yet. Create the first one.'}`],

  // --- reviews API -------------------------------------------------------
  ['app/api/products/[slug]/reviews/route.ts',
    `'Your session has expired ${D} please log in again.'`,
    `'Your session has expired. Please log in again.'`],
  ['app/api/products/[slug]/reviews/route.ts',
    `'Too many reviews ${D} please try again later.'`,
    `'Too many reviews. Please try again later.'`],

  // --- storefront / marketing -------------------------------------------
  ['app/contact/contact-form.tsx', `Thank you ${D} note received`, 'Thank you. Note received'],
  ['app/contact/page.tsx',
    `"Get in touch with the Adore team ${D} we'd love to hear from you."`,
    `"Get in touch with the Adore team. We'd love to hear from you."`],
  ['app/products/[slug]/page.tsx', '`${product.name} ' + D + ' Adore`', '`${product.name} | Adore`'],
  ['app/page.tsx', `No pieces yet ${D} check back soon.`, 'No pieces yet. Check back soon.'],
  ['app/shop/page.tsx', `title: 'Shop all ${D} dresses & kurtis',`, `title: 'Shop all | dresses & kurtis',`],
  ['app/shop/page.tsx',
    `'Browse the full Adore collection ${D} dresses and kurtis, thoughtfully made in small batches.'`,
    `'Browse the full Adore collection: dresses and kurtis, thoughtfully made in small batches.'`],
  ['app/shop/[slug]/page.tsx',
    `No {category.name.toLowerCase()} styles yet ${D} check back`,
    'No {category.name.toLowerCase()} styles yet. Check back'],
  // --- policy pages ------------------------------------------------------
  ['app/privacy/page.tsx',
    `<strong>Order information</strong> ${D} name, shipping and billing`,
    '<strong>Order information</strong>: name, shipping and billing'],
  ['app/privacy/page.tsx',
    `<strong>Payment information</strong> ${D} handled by our payment`,
    '<strong>Payment information</strong>: handled by our payment'],
  ['app/privacy/page.tsx',
    `<strong>Account information</strong> ${D} email address and password`,
    '<strong>Account information</strong>: email address and password'],
  ['app/privacy/page.tsx',
    `<strong>Usage data</strong> ${D} pages viewed, cart activity, and`,
    '<strong>Usage data</strong>: pages viewed, cart activity, and'],
  // These two wrap across lines, so each closing dash needs its own pair.
  ['app/privacy/page.tsx', `store\n          ${D} payment processors`, 'store\n          with payment processors'],
  ['app/privacy/page.tsx', `email delivery services ${D}\n          under agreements`, 'email delivery services\n          under agreements'],

  ['app/returns/page.tsx',
    `'How to return or exchange an Adore order ${D} eligibility, the reverse pickup process, timelines, and your refund.'`,
    `'How to return or exchange an Adore order: eligibility, the reverse pickup process, timelines, and your refund.'`],
  ['app/returns/page.tsx',
    `body: 'We check eligibility, then schedule a reverse pickup from your address ${D} usually within 24 hours.'`,
    `body: 'We check eligibility, then schedule a reverse pickup from your address, usually within 24 hours.'`],
  ['app/returns/page.tsx', 'detail: `Yes ' + D + ' same size', 'detail: `Yes, same size'],
  ['app/returns/page.tsx',
    `detail: 'Exchange or store credit only ${D} no refund on sale purchases.'`,
    `detail: 'Exchange or store credit only. No refund on sale purchases.'`],
  ['app/returns/page.tsx',
    `'Everything is raised from your account ${D} there is no separate portal or app to install.'`,
    `'Everything is raised from your account. There is no separate portal or app to install.'`],
  ['app/returns/page.tsx', `Pickups occasionally fail ${D} your PIN code`, 'Pickups occasionally fail. Your PIN code'],
  ['app/returns/page.tsx', `The handover details are wrong ${D} the wrong item`, 'The handover details are wrong. The wrong item'],
  ['app/returns/page.tsx', `catch people out here ${D} we simply`, 'catch people out here. We simply'],
  ['app/returns/page.tsx', `a photo of the parcel ${D} we can&rsquo;t verify those`, `a photo of the parcel. We can&rsquo;t verify those`],

  ['app/shipping/page.tsx',
    `'How Adore processes, dispatches and delivers your order ${D} timelines, charges, tracking, and what to do if something goes wrong.'`,
    `'How Adore processes, dispatches and delivers your order: timelines, charges, tracking, and what to do if something goes wrong.'`],
  ['app/shipping/page.tsx',
    `'Possible before dispatch ${D} contact us quickly.`,
    `'Possible before dispatch. Contact us quickly.`],
  ['app/shipping/page.tsx', `This summary is for convenience ${D} the detailed terms`, 'This summary is for convenience. The detailed terms'],
  ['app/shipping/page.tsx', `rather than take your money ${D} a pickup point`, 'rather than take your money. A pickup point'],
  ['app/shipping/page.tsx', `not guarantees ${D} couriers operate on`, 'not guarantees. Couriers operate on'],
  ['app/shipping/page.tsx', `defective or incorrect ${D} in which case we`, 'defective or incorrect. In which case we'],
  ['app/shipping/page.tsx', `Please double-check your details ${D}\n            it saves everyone time.`,
    `Please double-check your details;\n            it saves everyone time.`],
  ['app/shipping/page.tsx', `outside our reasonable control ${D} courier failures`, 'outside our reasonable control: courier failures'],
  ['app/shipping/page.tsx', `into it straight away ${D} the more detail you share`, 'into it straight away. The more detail you share'],
  // These two wrap with a trailing space before the newline, which is why the
  // first pass (line-anchored matching) missed them.
  ['app/shipping/page.tsx', `email, message or phone ${D} if anyone claiming`, 'email, message or phone. If anyone claiming'],
  ['app/shipping/page.tsx', `before paying ${D} couriers deliver`, 'before paying. Couriers deliver'],

  ['app/terms/page.tsx',
    `'Terms of service for shopping with Adore ${D} orders, returns, and fraud prevention.'`,
    `'Terms of service for shopping with Adore: orders, returns, and fraud prevention.'`],
  ['app/terms/page.tsx', `We want you to love what you ordered ${D} but returns must be fair`, 'We want you to love what you ordered, but returns must be fair'],
  ['app/terms/page.tsx', `or full refund ${D} including`, 'or full refund, including'],
  ['app/terms/page.tsx', `shipping costs ${D} at our choice.`, 'shipping costs, at our choice.'],
  ['app/terms/page.tsx', `original payment method ${D} never to a`, 'original payment method, never to a'],
  ['app/terms/page.tsx', `&rdquo;)</strong> ${D}\n`, `&rdquo;)</strong>:\n`],
  ['app/terms/page.tsx', `<strong>Item swapping</strong> ${D} returning`, '<strong>Item swapping</strong>: returning'],
  ['app/terms/page.tsx', `<strong>Serial returning</strong> ${D} repeatedly`, '<strong>Serial returning</strong>: repeatedly'],
  ['app/terms/page.tsx', `<strong>Empty-box or short-ship claims</strong> ${D} claiming`, '<strong>Empty-box or short-ship claims</strong>: claiming'],
  ['app/terms/page.tsx', `<strong>Refund manipulation</strong> ${D} requesting`, '<strong>Refund manipulation</strong>: requesting'],
  ['app/terms/page.tsx', `All content on this site ${D} text, photography, logos, and design ${D} is`, 'All content on this site, including text, photography, logos, and design, is'],
  // --- account components ------------------------------------------------
  ['components/account/customer-returns-list.tsx', `label: 'Received ${D} being checked',`, `label: 'Received, being checked',`],
  ['components/account/customer-returns-list.tsx', `label: 'Checked ${D} refund in progress',`, `label: 'Checked, refund in progress',`],
  ['components/account/customer-returns-list.tsx',
    `The reason is below ${D} reply to us`, 'The reason is below. Reply to us'],
  ['components/account/customer-returns-list.tsx',
    `Our team is on it ${D} you do not need to do anything.`,
    'Our team is on it. You do not need to do anything.'],
  ['components/account/return-request-form.tsx', `Return or exchange ${D} {productName}`, 'Return or exchange: {productName}'],
  ['components/account/return-request-form.tsx', `{v.color} ${D} {v.size}`, '{v.color} in {v.size}'],

  // --- admin components --------------------------------------------------
  ['components/admin/delete-product-button.tsx', `setError('Network error ${D} is the server running?');`, `setError('Network error. Is the server running?');`],
  ['components/admin/product-form.tsx', '`${data.error} ' + D + ' ${data.detail}`', '`${data.error}: ${data.detail}`'],
  ['components/admin/product-form.tsx',
    `'Something went wrong ${D} fix the errors and retry.'`,
    `'Something went wrong. Fix the errors and retry.'`],
  ['components/admin/product-form.tsx',
    `text: 'Network error ${D} the request did not go through. Try again.'`,
    `text: 'Network error. The request did not go through. Try again.'`],
  ['components/admin/product-form.tsx',
    `Packed weight per unit ${D} used for shipping rates.`,
    'Packed weight per unit. Used for shipping rates.'],
  ['components/admin/product-form.tsx',
    `Needs ≥1 variant and ≥1 image ${D} upload images below first if new.`,
    'Needs ≥1 variant and ≥1 image. Upload images below first if new.'],
  ['components/admin/return-row.tsx', `APPROVED: 'Approved ${D} book pickup',`, `APPROVED: 'Approved, book pickup',`],
  ['components/admin/return-row.tsx', `RECEIVED: 'Received ${D} needs QC',`, `RECEIVED: 'Received, needs QC',`],
  ['components/admin/return-row.tsx', `QC_PASSED: 'Passed QC ${D} refund due',`, `QC_PASSED: 'Passed QC, refund due',`],

  // --- checkout ----------------------------------------------------------
  ['components/checkout/checkout-form.tsx', `No saved addresses yet ${D} enter one below`, 'No saved addresses yet. Enter one below'],
  ['components/checkout/checkout-form.tsx', `Email (optional ${D} for delivery updates)`, 'Email (optional, for delivery updates)'],
  ['components/checkout/order-receipt.tsx', `looks off ${D}\n          we&apos;ll sort it out.`, `looks off.\n          We&apos;ll sort it out.`],
  ['components/checkout/order-receipt.tsx', `retrying on our side\n            ${D} no action needed.`, 'retrying on our side.\n            No action needed.'],

  // --- shop components ---------------------------------------------------
  ['components/shop/pin-checker.tsx', `yet ${D} we&apos;re expanding to new PIN`, `yet. We&apos;re expanding to new PIN`],
  ['components/shop/product-card.tsx', '`Add to bag ' + D + ' ${selectedSize}`', '`Add to bag (${selectedSize})`'],
  ['components/shop/product-detail.tsx', `s'} ${D} jump to reviews`, `s'}. Jump to reviews`],
  ['components/shop/product-detail.tsx', '`${s.size} ' + D + ' ${formatPrice(', '`${s.size} ${formatPrice('],
  ['components/shop/product-detail.tsx', '`Add to basket ' + D + ' ${selectedSize}`', '`Add to basket (${selectedSize})`'],
  ['components/shop/product-reviews.tsx', `No reviews yet ${D} be the first to share your love.`, 'No reviews yet. Be the first to share your love.'],

  // --- utils (customer-facing strings) -----------------------------------
  ['utils/categories.ts', '`${category.name} ' + D + ' dresses & kurtis`', '`${category.name} | Dresses & Kurtis`'],
  ['utils/checkout.ts', `} left ${D} please update your bag.`, '} left. Please update your bag.'],
  ['utils/checkout.ts', `'That address has no phone number ${D} please add one in your account.'`, `'That address has no phone number. Please add one in your account.'`],
  ['utils/checkout.ts', `yet ${D} we're expanding to new PIN codes soon.`, `yet. We're expanding to new PIN codes soon.`],
  ['utils/checkout.ts', `match this order ${D} please contact support.`, 'match this order. Please contact support.'],
  ['utils/reservations.ts', '`Only ${available} left ' + D + ' someone else just reserved this item.`', '`Only ${available} left. Someone else just reserved this item.`'],
  ['utils/returns-db.ts', `refund_failed: 'We could not process your refund ${D} our team is on it',`, `refund_failed: 'We could not process your refund. Our team is on it',`],
  ['utils/returns-ops.ts', `and retry ${D} please do not duplicate it.`, 'and retry. Please do not duplicate it.'],
  ['utils/returns-ops.ts', `'Chargeback lost ${D} the bank returned`, `'Chargeback lost: the bank returned`],
  ['utils/review-format.ts', `review this product ${D} yours must contain at least one`, 'review this product. Yours must contain at least one'],
];

let applied = 0;
const failures = [];

for (const [file, before, after] of EDITS) {
  const full = join(ROOT, file);
  let src;
  try {
    src = readFileSync(full, 'utf8');
  } catch {
    failures.push(`${file}: cannot read`);
    continue;
  }
  if (!src.includes(before)) {
    failures.push(`${file}: no match for ${JSON.stringify(before.slice(0, 60))}`);
    continue;
  }
  if (apply) writeFileSync(full, src.replace(before, after), 'utf8');
  applied += 1;
}

console.log(`${applied}/${EDITS.length} replacement(s) ${apply ? 'applied' : 'matched (dry run)'}.`);
if (failures.length > 0) {
  console.log('\nUNMATCHED (fix these by hand):');
  for (const f of failures) console.log('  ' + f);
  process.exitCode = 1;
}