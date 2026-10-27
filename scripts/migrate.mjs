import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
try { process.loadEnvFile?.(resolve(ROOT, ".env.local")); } catch {}
try { process.loadEnvFile?.(resolve(ROOT, ".env")); } catch {}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL/DIRECT_URL not set");
  process.exit(1);
}

const { Client } = pg;
const local = /(^|@)(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new Client({
  connectionString: url,
  ssl: local ? undefined : { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS _migrations (id text primary key, applied_at bigint not null)"
  );
  const migDir = resolve(ROOT, "db", "migrations");
  const files = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const id = f.replace(/\.sql$/, "");
    const r = await client.query("SELECT 1 FROM _migrations WHERE id=$1", [id]);
    if (r.rowCount) continue;
    const sql = readFileSync(join(migDir, f), "utf8");
    console.log(`applying ${f}...`);
    await client.query(sql);
    await client.query("INSERT INTO _migrations(id, applied_at) VALUES ($1, $2)", [
      id,
      Date.now(),
    ]);
    console.log(`applied ${f}`);
  }
  console.log("migrations done");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.end();
}
if (process.exitCode) process.exit(process.exitCode);
