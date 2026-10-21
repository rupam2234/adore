// scripts/generate-cron-token.js
// Zero-dependency HS256 JWT signer — uses Node's built-in crypto so cron
// workflows don't need an npm install step on the runner.
import crypto from 'crypto';

const b64url = (input) =>
  Buffer.from(input).toString('base64url');

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET not set');
  process.exit(1);
}

const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({
    iss: 'github-actions',
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
  })
);
const signingInput = `${header}.${payload}`;
const signature = crypto
  .createHmac('sha256', secret)
  .update(signingInput)
  .digest('base64url');

console.log(`${signingInput}.${signature}`);