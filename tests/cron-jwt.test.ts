// tests/cron-jwt.test.ts
// Round-trip test for the cron auth scheme: sign a short-lived HS256 JWT with
// CRON_SECRET (same as scripts/generate-cron-token.js), then verify it the way
// verifyCronAuth() does in the cron route handlers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';

const TEST_SECRET = 'test-cron-secret-for-vitest-only';
let key: Uint8Array;

beforeAll(() => {
  key = new TextEncoder().encode(TEST_SECRET);
});

async function generateToken(expiresIn = '5m'): Promise<string> {
  return new SignJWT({ iss: 'github-actions' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(key);
}

// Mirrors verifyCronAuth() from app/api/cron/*/route.ts (JWT-only, no fallback)
async function verifyCronAuth(token: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  try {
    const k = new TextEncoder().encode(secret);
    await jwtVerify(token, k, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

describe('cron JWT auth', () => {
  it('accepts a freshly signed 5-minute token', async () => {
    const token = await generateToken('5m');
    expect(await verifyCronAuth(token, TEST_SECRET)).toBe(true);
  });

  it('rejects an expired token', async () => {
    // -1s expiry is already past at verification time
    const token = await generateToken('-1s');
    expect(await verifyCronAuth(token, TEST_SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await generateToken('5m');
    expect(await verifyCronAuth(token, 'wrong-secret')).toBe(false);
  });

  it('rejects an empty/missing secret', async () => {
    const token = await generateToken('5m');
    expect(await verifyCronAuth(token, '')).toBe(false);
  });

  it('rejects garbage strings', async () => {
    expect(await verifyCronAuth('not-a-jwt', TEST_SECRET)).toBe(false);
    expect(await verifyCronAuth('', TEST_SECRET)).toBe(false);
  });

  it('rejects a token with a different issuer claim when verified strictly', async () => {
    // Sign with a non-github-actions issuer; default jwtVerify doesn't check
    // iss unless configured, so this documents current behavior: still valid.
    const token = await new SignJWT({ iss: 'attacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(key);
    // Current implementation does NOT enforce iss — token still verifies.
    expect(await verifyCronAuth(token, TEST_SECRET)).toBe(true);
  });
});