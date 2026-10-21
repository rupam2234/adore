// tests/parse-sql.test.ts
import { describe, it, expect } from 'vitest';
import { parseStatements } from '../scripts/lib/parse-sql';

describe('parseStatements', () => {
  it('splits simple single-line statements', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(parseStatements(sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('handles multi-line statements (CREATE TABLE with columns)', () => {
    const sql = `CREATE TABLE t (
  id UUID PRIMARY KEY,
  endpoint TEXT NOT NULL
);

CREATE INDEX idx_t ON t(id);`;
    const out = parseStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('CREATE TABLE t');
    expect(out[0]).toContain('endpoint TEXT NOT NULL');
    expect(out[1]).toContain('CREATE INDEX idx_t');
  });

  it('does NOT split on semicolons inside dollar-quoted function bodies', () => {
    const sql = `CREATE TABLE t (id UUID PRIMARY KEY);

CREATE OR REPLACE FUNCTION cleanup()
RETURNS void AS $$
BEGIN
  DELETE FROM t WHERE x = 1;
  DELETE FROM t WHERE y = 2;
END;
$$ LANGUAGE plpgsql;`;
    const out = parseStatements(sql);
    expect(out).toHaveLength(2);
    // The full function body must survive intact — both DELETEs inside statement 2
    expect(out[1]).toContain('DELETE FROM t WHERE x = 1;');
    expect(out[1]).toContain('DELETE FROM t WHERE y = 2;');
    expect(out[1]).toContain('$$ LANGUAGE plpgsql;');
  });

  it('skips full-line comments outside statements', () => {
    const sql = '-- a comment\n-- another\nSELECT 1;\n-- trailing comment';
    expect(parseStatements(sql)).toEqual(['SELECT 1;']);
  });

  it('handles the real hardening migration shape (ALTER + tables + function)', () => {
    const sql = `ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS a BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS b INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS cron_audit_log (
  run_id UUID PRIMARY KEY,
  order_ids JSONB NOT NULL
);

CREATE INDEX idx_a ON orders(a);

CREATE OR REPLACE FUNCTION cleanup_old_cron_records()
RETURNS void AS $$
BEGIN
  DELETE FROM cron_idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;`;
    const out = parseStatements(sql);
    expect(out).toHaveLength(4);
    expect(out[0].startsWith('ALTER TABLE orders')).toBe(true);
    expect(out[1].startsWith('CREATE TABLE IF NOT EXISTS cron_audit_log')).toBe(true);
    expect(out[2].startsWith('CREATE INDEX idx_a')).toBe(true);
    expect(out[3].startsWith('CREATE OR REPLACE FUNCTION cleanup_old_cron_records')).toBe(true);
    expect(out[3]).toContain("INTERVAL '24 hours';");
  });

  it('returns trailing statement without trailing semicolon', () => {
    expect(parseStatements('SELECT 1;')).toEqual(['SELECT 1;']);
    expect(parseStatements('SELECT 1')).toEqual(['SELECT 1']);
    expect(parseStatements('')).toEqual([]);
  });
});