import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';

if (!process.env.adore_DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined');
}

// Drizzle sits on top of the SAME neon serverless HTTP driver —
// same transport, same edge compatibility, typed queries on top.
const client = neon(process.env.adore_DATABASE_URL);

export const db = drizzle(client, { schema });

// Re-export tables so callers can `import { db, products } from "./db"`.
export * from './schema';

/**
 * Raw neon client. Kept only for one-off scripts that don't need Drizzle
 * (see scripts/migrate-featured.mjs). Application code should use `db`.
 */
export const pool = client;

/**
 * Escape hatch for complex SQL (JSON_AGG, DISTINCT ON, JOIN LATERAL, …)
 * that the query builder doesn't express cleanly. Fully parameterized,
 * typed on return.
 *
 * Usage: rawQuery<ProductRow>(sql`SELECT ... WHERE id = ${id}`)
 */
export async function rawQuery<T = Record<string, unknown>>(
  query: SQL
): Promise<T[]> {
  try {
    const result = await db.execute(query);
    return (result.rows ?? []) as T[];
  } catch (error) {
    // Drizzle wraps driver failures in DrizzleQueryError, whose own message is
    // only the SQL text — the real cause (Postgres message + SQLSTATE) lives in
    // `.cause`. Re-throw with that detail so failures aren't opaque at the call
    // site / in the Next.js error overlay.
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: string }).code;
      throw new Error(`${cause.message}${code ? ` [${code}]` : ''}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Extract the actionable Postgres message from a Drizzle/driver error.
 *
 * Drizzle wraps driver failures in DrizzleQueryError, whose own `message` is
 * only the SQL text. The real cause (Postgres message + SQLSTATE) lives in
 * `.cause`. Callers use this so admin writes can report *why* they failed
 * instead of a generic "something went wrong".
 */
export function describeDbError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  // Walk the cause chain — neon/drizzle can nest more than one level.
  for (let i = 0; i < 5 && current instanceof Error; i++) {
    parts.push(current.message);
    current = current.cause;
  }

  // SQLSTATE is on the cause as `.code` (e.g. '23505' unique violation).
  const code = (error as (Error & { code?: string }) | null)?.code;
  if (typeof code === 'string' && !parts[0]?.includes(code)) {
    parts.push(`[${code}]`);
  }

  // The top-level Drizzle message is just the SQL string — drop it if a more
  // specific cause follows, so the log leads with the real reason.
  const meaningful = parts.filter(p => !/^\s*(insert|select|update|delete) /i.test(p));
  return (meaningful.length > 0 ? meaningful : parts).join(' → ');
}

// Re-export so callers can build SQL fragments without importing drizzle-orm.
export { sql };
