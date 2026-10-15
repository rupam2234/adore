// insert-test-promo.mjs — inserts TEST100 100% discount promo code
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

let url = process.env.adore_DATABASE_URL;
if (!url) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  url = line
    ?.split('=')[1]
    ?.replace(/^["']|["']$/g, '');
}
if (!url) throw new Error('adore_DATABASE_URL not found');

const sql = neon(url);

async function main() {
  console.log('Inserting TEST100 promo code...');
  
  const result = await sql`
    INSERT INTO promo_codes (
      code,
      description,
      discount_type,
      discount_value,
      min_subtotal,
      max_redemptions,
      is_active,
      starts_at,
      expires_at
    ) VALUES (
      'TEST100',
      '100% off for testing',
      'PERCENT',
      '100',
      0,
      1,
      true,
      NOW(),
      NOW() + INTERVAL '30 days'
    )
    ON CONFLICT (code) DO UPDATE SET
      description = EXCLUDED.description,
      discount_type = EXCLUDED.discount_type,
      discount_value = EXCLUDED.discount_value,
      min_subtotal = EXCLUDED.min_subtotal,
      max_redemptions = EXCLUDED.max_redemptions,
      is_active = EXCLUDED.is_active,
      starts_at = EXCLUDED.starts_at,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING id, code, description, discount_type, discount_value, min_subtotal, max_redemptions, is_active, starts_at, expires_at
  `;
  
  console.log('✅ Promo code created/updated:');
  console.log(result[0]);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});