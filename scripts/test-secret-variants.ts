// scripts/test-secret-variants.ts — probe which CRON_SECRET variant production accepts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { SignJWT } from 'jose';
import { readFileSync } from 'fs';

const raw = (readFileSync('.env.local', 'utf-8')
  .split('\n')
  .find(l => l.startsWith('CRON_SECRET=')) || '')
  .replace('CRON_SECRET=', '')
  .trim();

const variants: Array<[string, string]> = [
  ['plain (no quotes)', raw.replace(/^"|"$/g, '')],
  ['with literal quotes', raw],
  ['with trailing space', raw.replace(/^"|"$/g, '') + ' '],
];

const BASE = process.argv[2] || 'https://adore.ind.in';
const PATH = '/api/cron/auto-process';

async function main() {
  for (const [label, secret] of variants) {
    if (!secret) continue;
    const key = new TextEncoder().encode(secret);
    const token = await new SignJWT({ iss: 'probe' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('2m')
      .sign(key);

    const res = await fetch(BASE + PATH, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Request-Id': '22222222-2222-3333-4444-555555555555',
      },
    });
    const body = await res.text();
    console.log(`${label.padEnd(24)} -> HTTP ${res.status}  ${body.substring(0, 80)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });