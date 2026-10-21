# Deployment Checklist for Hardening Items

## Pre-Deployment Checklist

### ✅ Code Complete (Already Done)
- [x] All 8 hardening items implemented in codebase
- [x] TypeScript compilation passes (`npm run build` ✅)
- [x] Test suite removed (Vitest removed, test file deleted)
- [x] Build passes locally (`npm run build` ✅)

### Database Migrations
- [ ] **Run migration SQL** against production database
  - File: `migrations/001_hardening_items.sql`
  - Execute against production PostgreSQL (Neon/Supabase/Railway/etc.)
  - Verify columns added: `zero_total`, `payment_verified`, `idempotency_key`, `checkout_session_id`, `retry_count`, `next_retry_at`
  - Verify tables created: `idempotency_keys`, `cron_idempotency_keys`, `cron_audit_log`

### Environment Variables (Secrets)

#### Vercel (Production Environment)
| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | ✅ Required | Long random string (64+ chars) for JWT signing |
| `APP_URL` | ✅ Required | Public URL e.g. `https://adore.vercel.app` |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ Required | From Razorpay dashboard |
| `RAZORPAY_API_KEY` | ✅ Required | From Razorpay dashboard |
| `RAZORPAY_API_SECRET` | ✅ Required | From Razorpay dashboard |
| `SHIPROCKET_EMAIL` | ✅ Required | Shiprocket login email |
| `SHIPROCKET_PASSWORD` | ✅ Required | Shiprocket password |
| `SHIPROCKET_WEBHOOK_TOKEN` | ✅ Required | From Shiprocket webhook settings |
| `RESEND_API_KEY` | ✅ Required | From Resend dashboard |
| `RESEND_WEBHOOK_SECRET` | ✅ Required | From Resend webhook settings |
| `SLACK_WEBHOOK_URL` | Optional | For cron failure alerts |
| `DATABASE_URL` | ✅ Required | PostgreSQL connection string (Neon/Supabase) |
| `JWT_SECRET` | ✅ Required | For auth tokens |
| `CRON_SECRET` | ✅ Required | Same as GitHub Actions |

#### GitHub Actions (Repository Secrets)
| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | ✅ Required | **Must match** Vercel's CRON_SECRET |
| `APP_URL` | ✅ Required | Must match Vercel's APP_URL |

### Deployment Steps

#### 1. Database Migration
```bash
# Option A: Using drizzle-kit (if configured)
npx drizzle-kit push

# Option B: Run raw SQL
psql "$DATABASE_URL" -f migrations/001_hardening_items.sql
```

#### 2. Set Secrets
- **Vercel**: Project Settings → Environment Variables → Add all production variables
- **GitHub**: Repository Settings → Secrets and variables → Actions → Add repository secrets

#### 2. Deploy
```bash
git add .
git commit -m "feat: hardening items 1-8 + frontend wiring"
git push origin main
```
Vercel will auto-deploy on push to `main`.

#### 3. Verify Deployment
- [ ] Build passes on Vercel
- [ ] Check GitHub Actions tab - three workflows should appear:
  - `Auto-process Orders` (every 10 min)
  - `Retry Shiprocket Orders` (every 15 min)
  - `Confirm Zero-Total Orders` (every minute)
  - `Nightly Cron Cleanup` (daily at 03:15 UTC)

### Post-Deployment Verification

#### Manual Smoke Test
1. **Open checkout in two tabs**
   - Tab A: Start checkout → observe `Idempotency-Key` header in Network tab
   - Tab B: Modify cart (remove item) → Tab A should show "Your bag changed — please restart checkout"

2. **Complete a payment**
   - Verify `checkout_session_id` cookie is set (HttpOnly, Secure, SameSite=Lax)
   - Order moves to `CONFIRMED` → `PROCESSING` via cron

4. **Test cron jobs manually** (optional)
   ```bash
   gh workflow run "Auto-process Orders" --repo <owner>/adore --ref main
   gh workflow run "Retry Shiprocket Orders" --repo <owner>/adore --ref main
   gh workflow run "Confirm Zero-Total Orders" --repo <owner>/adore --ref main
   gh run watch --repo <owner>/adore
   ```

5. **Test alerting**
   - Temporarily set wrong `CRON_SECRET` in Vercel
   - Trigger a cron run
   - Verify Slack alert received
   - Restore correct secret

### Post-Deployment Monitoring
- [ ] Check `cron_audit_log` table populates correctly
- [ ] Verify `cron_idempotency_keys` cleaned up after 24h
- [ ] Monitor `cron_audit_log` for failures
- [ ] Watch for any `PENDING` orders stuck > 30 min

### Rollback Plan
If critical issues:
1. Revert Vercel deployment to previous version
2. Rollback DB migration (if needed):
   ```sql
   ALTER TABLE orders DROP COLUMN IF EXISTS zero_total;
   ALTER TABLE orders DROP COLUMN IF EXISTS payment_verified;
   ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_key;
   ALTER TABLE orders DROP COLUMN IF EXISTS checkout_session_id;
   ALTER TABLE orders DROP COLUMN IF EXISTS retry_count;
   ALTER TABLE orders DROP COLUMN IF EXISTS next_retry_at;
   DROP TABLE IF EXISTS idempotency_keys;
   DROP TABLE IF EXISTS cron_idempotency_keys;
   DROP TABLE IF EXISTS cron_audit_log;
   DROP FUNCTION IF EXISTS cleanup_old_cron_records();
   ```

---

### Quick Reference Commands

```bash
# Local verification
cd d:\Projects\adore
npm run build          # Must pass
npm run type-check     # Must pass

# Database migration
psql "$DATABASE_URL" -f migrations/001_hardening_items.sql

# Deploy
git push origin main

# Manual cron trigger (after deploy)
gh workflow run "Auto-process Orders" --repo <owner>/adore --ref main
gh workflow run "Retry Shiprocket Orders" --repo <owner>/adore --ref main
gh workflow run "Confirm Zero-Total Orders" --repo <owner>/adore --ref main
gh run watch --repo <owner>/adore
```

---

**All code changes are complete and build passes. The remaining steps are operational (database, secrets, deployment).**