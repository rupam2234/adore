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
} from '../utils/email-templates.ts';

const OUT = join('scripts', 'preview');
mkdirSync(OUT, { recursive: true });

const customerName = 'Asha Rao';

const TEMPLATES = {
  'order-confirmed': orderConfirmed({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    items: [
      { name: 'Floral Meadow', qty: 1, price: '₹2,499.00' },
      { name: 'Jonaki Short Kurti', qty: 2, price: '₹1,899.00' },
    ],
    total: '₹6,297.00',
  }),
  'order-shipped': orderShipped({
    to: 'asha@example.com',
    customerName,
    orderNumber: 'AD-1001',
    trackingUrl: 'https://track.example/abc123',
    courierName: 'Shiprocket',
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
};

for (const [name, tpl] of Object.entries(TEMPLATES)) {
  writeFileSync(join(OUT, `${name}.html`), tpl.html, 'utf8');
  writeFileSync(join(OUT, `${name}.txt`), tpl.text, 'utf8');
  console.log(`  ${name}`);
  console.log(`    subject: ${tpl.subject}`);
}

console.log(`\nWrote ${Object.keys(TEMPLATES).length} template(s) to scripts/preview/`);
console.log('Open the .html files in a browser, or send them to a real inbox to check rendering.');