import { Client } from "pg";
import { hashPassword } from "../src/lib/core/password";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile?.(resolve(ROOT, ".env.local")); } catch {}
try { process.loadEnvFile?.(resolve(ROOT, ".env")); } catch {}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const passwordHash = hashPassword("Eoc@2026");
const now = Date.now();

interface U {
  id: string;
  email: string;
  name: string;
  global_role: string;
  memberships: { cellId: string; role: "head" | "member" }[];
}

const users: U[] = [
  { id: "usr_principal", email: "principal@hkbk.edu.in", name: "Dr. Mohammed Riyaz Ahmed", global_role: "principal", memberships: [] },
  { id: "usr_chair", email: "chair@hkbk.edu.in", name: "Prof. Khallikkunaisa", global_role: "chair", memberships: [
    { cellId: "cell_03", role: "head" }, { cellId: "cell_08", role: "head" }, { cellId: "cell_09", role: "head" },
    { cellId: "cell_11", role: "head" }, { cellId: "cell_12", role: "head" }, { cellId: "cell_14", role: "head" },
  ]},
  { id: "usr_balaji", email: "balaji@hkbk.edu.in", name: "Dr. Balaji Vijayan V", global_role: "head", memberships: [{ cellId: "cell_01", role: "head" }] },
  { id: "usr_salim", email: "salim@hkbk.edu.in", name: "Dr. Salim Sharieff", global_role: "head", memberships: [{ cellId: "cell_02", role: "head" }] },
  { id: "usr_maaz", email: "maaz@hkbk.edu.in", name: "Dr. Maaz Ahmed", global_role: "head", memberships: [{ cellId: "cell_04", role: "head" }] },
  { id: "usr_naresh", email: "naresh@hkbk.edu.in", name: "Prof. Naresh MK", global_role: "head", memberships: [{ cellId: "cell_05", role: "head" }] },
  { id: "usr_sumaiya", email: "sumaiya@hkbk.edu.in", name: "Prof. Sumaiya Banu", global_role: "head", memberships: [{ cellId: "cell_06", role: "head" }] },
  { id: "usr_vinay", email: "vinay@hkbk.edu.in", name: "Vinay A L", global_role: "head", memberships: [{ cellId: "cell_07", role: "head" }] },
  { id: "usr_arshad", email: "arshad@hkbk.edu.in", name: "Dr. Arshad Pasha", global_role: "head", memberships: [{ cellId: "cell_10", role: "head" }] },
  { id: "usr_umme", email: "umme@hkbk.edu.in", name: "Prof. Umme Salma", global_role: "head", memberships: [{ cellId: "cell_13", role: "head" }] },
  { id: "usr_member", email: "member@hkbk.edu.in", name: "Prof. Bharath V", global_role: "member", memberships: [{ cellId: "cell_01", role: "member" }] },
  // A second ordinary member, in a different cell, so cross-cell visibility and
  // "a member cannot confirm" can be exercised by two distinct people.
  { id: "usr_member2", email: "member2@hkbk.edu.in", name: "Prof. Ayesha Anjum", global_role: "member", memberships: [{ cellId: "cell_04", role: "member" }] },
];

async function main() {
  const local = /(^|@)(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: local ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, designation, phone, global_role, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email, passwordHash, u.name, "", "", u.global_role, now]
      );
      for (const m of u.memberships) {
        const mid = `mem_${u.id}_${m.cellId}`;
        await client.query(
          `INSERT INTO memberships (id, user_id, cell_id, role, created_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, cell_id) DO NOTHING`,
          [mid, u.id, m.cellId, m.role, now]
        );
      }
    }
    console.log(`seeded ${users.length} users`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
