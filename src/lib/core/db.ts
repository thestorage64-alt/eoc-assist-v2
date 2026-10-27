import { Pool } from "pg";

/**
 * One pool per process.
 *
 * DATABASE_URL is preferred because hosted Postgres (Supabase, Neon) exposes the
 * pooled connection on 6543; the direct 5432 endpoint is IPv6-only there and is
 * unreachable from serverless platforms. Migrations still use DIRECT_URL from
 * `scripts/migrate.mjs`, which runs outside the app.
 *
 * TLS is required by every hosted provider and must be off for localhost, so the
 * decision is made from the URL rather than an env flag that can drift.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
    if (!url) throw new Error("DATABASE_URL not configured");

    const local = /(^|@)(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: local ? undefined : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }> {
  const res = await getPool().query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount };
}
