// resend-check.mjs — READ-ONLY. Reports what the Resend account can actually send.
//
// Answers the questions that decide how the email templates must be addressed:
//   - Which domains are verified? (Only a verified domain can send from it.)
//   - Which sender identity is the default?
//   - Has anything been sent yet (delivery/bounce signal)?
//
// Reads RESEND_API_KEY from .env.local. Never prints the key.
//
// Usage: node scripts/resend-check.mjs
import { readFileSync } from 'node:fs';

let apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('RESEND_API_KEY='));
  apiKey = line?.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
}
if (!apiKey) {
  console.error('RESEND_API_KEY not found in .env.local');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
};

// The default endpoint already sees adore.ind.in, so the api.resend.com host is
// correct for this account and no region-specific host is needed. (A guessed
// `api.ap-northeast-1.resend.com` does not resolve, which is why this probe
// catches network errors instead of letting them crash the script.)
const ENDPOINTS = [
  { label: 'default (us-east-1)', base: 'https://api.resend.com' },
  { label: 'ap-northeast-1      ', base: 'https://api.ap-northeast-1.resend.com' },
];

async function api(path, base = ENDPOINTS[0].base) {
  let res;
  try {
    res = await fetch(`${base}${path}`, { headers });
  } catch (err) {
    // Unresolvable/unreachable host, not an API error.
    return { status: 0, body: { message: String(err.cause?.code ?? err.message) } };
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// --- Which endpoint actually sees our domain? ------------------------------
console.log('=== endpoint / region probe ===');
let activeBase = ENDPOINTS[0].base;
for (const ep of ENDPOINTS) {
  const probe = await api('/domains', ep.base);
  const names = (probe.body?.data ?? []).map(d => d.name);
  const hasAdore = names.includes('adore.ind.in');
  console.log(
    `  ${ep.label}  status=${probe.status}  domains=${names.length}` +
      (hasAdore ? '  <-- sees adore.ind.in' : '') +
      (probe.status === 0 ? `  (${probe.body.message})` : '')
  );
  if (hasAdore) activeBase = ep.base;
}
console.log(`  active endpoint: ${activeBase}`);

// --- Account ---------------------------------------------------------------
const domains = await api('/domains', activeBase);
console.log('=== domains ===');
if (!domains.body?.data?.length) {
  console.log('  NONE. No domain is verified, so nothing can be sent from a custom address.');
  console.log('  message:', domains.body?.message ?? domains.status);
} else {
  for (const d of domains.body.data) {
    console.log(
      `  ${d.name.padEnd(28)} status=${d.status}` +
        (d.region ? ` region=${d.region}` : '') +
        (d.created_at ? ` added=${d.created_at.slice(0, 10)}` : '')
    );
    // Per-record DNS status is the actionable part: it says what is still missing.
    if (Array.isArray(d.records) && d.records.length) {
      for (const r of d.records) {
        const ok = r.status === 'verified' || r.verified === true;
        console.log(`      ${ok ? 'verified  ' : 'PENDING   '} ${r.type}  ${r.name}`);
      }
    }
  }
}

// --- Sender identities -----------------------------------------------------
const addresses = await api('/addresses');
console.log('\n=== sender addresses ===');
if (!addresses.body?.data?.length) {
  console.log('  NONE.');
} else {
  for (const a of addresses.body.data) {
    console.log(`  ${String(a.email).padEnd(34)} verified=${a.verified}`);
  }
}

// --- Sending history -------------------------------------------------------
const sent = await api('/emails?limit=5');
console.log('\n=== recent sends ===');
if (!sent.body?.data?.length) {
  console.log('  none yet');
} else {
  for (const e of sent.body.data) {
    console.log(
      `  ${String(e.created_at).slice(0, 19)}  ${String(e.from).padEnd(30)} -> ${e.to}  [${e.last_event}]`
    );
  }
}