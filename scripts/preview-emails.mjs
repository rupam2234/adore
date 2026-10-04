// preview-emails.mjs — writes one .html file per template to scripts/preview/.
//
// Email templates cannot be seen in a browser inside the app, which makes them
// easy to get wrong unnoticed. This renders the real templates with sample data
// so they can be opened, forwarded to a real inbox, or pasted into an online
// preview service. It uses the actual exported functions, so what you see here
// is exactly what a recipient gets — not a hand-copied approximation.
//
// Usage: node scripts/preview-emails.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  orderConfirmed,
  orderShipped,
  refundFailed,
  refundProcessed,
  returnRejected,
  welcomeEmail,
} from '../utils/email-templates.ts';

const OUT = join('scripts', 'preview');
mkdirSync(OUT, { recursive: true });

const customerName = 'Asha Rao';

/** Cloudinary-shaped URLs, so the preview shows real <img> tags. */
const IMG = id =>
  `https://res.cloudinary.com/adore/image/upload/f_auto,q_auto,w_128,h_128,c_fill/${id}.jpg`;

const TEMPLATES = {
  'order-confirmed': orderConfirmed({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    items: [
      {
        name: 'Floral Meadow',
        qty: 1,
        price: '₹2,499.00',
        imageUrl: IMG('adore/floral-meadow'),
      },
      {
        name: 'Jonaki Short Kurti',
        qty: 2,
        price: '₹1,899.00',
        imageUrl: IMG('adore/jonaki-short-kurti'),
      },
      // No image: proves the row still renders with just the name.
      { name: 'Ivory Bloom Sundress', qty: 1, price: '₹3,299.00' },
    ],
    total: '₹9,596.00',
  }),
  'order-shipped': orderShipped({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    trackingUrl: 'https://track.example/abc123',
    courierName: 'Shiprocket',
    items: [
      {
        name: 'Floral Meadow',
        qty: 1,
        imageUrl: IMG('adore/floral-meadow'),
      },
      {
        name: 'Jonaki Short Kurti',
        qty: 2,
        imageUrl: IMG('adore/jonaki-short-kurti'),
      },
    ],
  }),
  'return-rejected': returnRejected({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    reason: 'The item shows signs of wear, which our policy does not allow.',
    photoUrls: [
      'https://placehold.co/300x300/FAF8F3/2B2620?text=photo+1',
      'https://placehold.co/300x300/FAF8F3/2B2620?text=photo+2',
    ],
  }),
  'refund-processed': refundProcessed({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    amount: '₹2,499.00',
    method: 'UPI',
  }),
  'refund-failed': refundFailed({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    amount: '₹2,499.00',
  }),
  // Both variants: with a code (the normal path) and without, which is what a
  // customer gets when issueWelcomeCode could not run. Both must render.
  'welcome': welcomeEmail({
    to: 'asha@example.com',
    customerName,
    promoCode: 'WELCOME10-QB2CKU',
    promoValidFor: '30 days',
    discountPercent: 10,
    minimumOrder: '₹600',
  }),
  'welcome-no-code': welcomeEmail({
    to: 'asha@example.com',
    customerName,
    promoCode: null,
  }),
};

for (const [name, tpl] of Object.entries(TEMPLATES)) {
  writeFileSync(join(OUT, `${name}.html`), tpl.html, 'utf8');
  writeFileSync(join(OUT, `${name}.txt`), tpl.text, 'utf8');
  console.log(`  ${name}`);
  console.log(`    subject: ${tpl.subject}`);
}

console.log(`\nWrote ${Object.keys(TEMPLATES).length} template(s) to scripts/preview/`);
console.log('Open the .html files in a browser, or send them to a real inbox to check rendering.');