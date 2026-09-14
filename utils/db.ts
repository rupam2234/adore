import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema";

if (!process.env.adore_DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined");
}

// Drizzle sits on top of the SAME neon serverless HTTP driver —
// same transport, same edge compatibility, typed queries on top.
const client = neon(process.env.adore_DATABASE_URL);

export const db = drizzle(client, { schema });

// Re-export tables so callers can `import { db, products } from "./db"`.
export * from "./schema";

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
    query: SQL,
): Promise<T[]> {
    const result = await db.execute(query);
    return (result.rows ?? []) as T[];
}

// Re-export so callers can build SQL fragments without importing drizzle-orm.
export { sql };
