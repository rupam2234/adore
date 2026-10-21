import { SignJWT } from 'jose';
import { TextEncoder } from 'util';

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET not set');
    process.exit(1);
  }
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ iss: 'github-actions' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .sign(key);
  console.log(token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});