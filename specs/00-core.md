# Task 00 — core (implement exactly; do not redesign)

You are implementing the foundation of `eoc-v2`. Types are frozen in
`src/lib/contracts.ts` — **read it first and never edit it.** Nothing else exists yet.

Working directory: `E:\GEARS Presentation project\eoc-v2`

Database is already running at `postgres://postgres:eoc@localhost:55433/eoc`
(`.env.local` already has it).

## Files you must create

```
db/migrations/001_init.sql
scripts/migrate.mjs
scripts/seed.ts
src/lib/core/db.ts
src/lib/core/password.ts
src/lib/core/auth.ts
src/lib/core/permissions.ts
src/lib/core/audit.ts
src/app/api/health/route.ts
src/app/api/auth/login/route.ts
src/app/api/auth/logout/route.ts
src/app/api/me/route.ts
src/app/api/cells/route.ts
tests/permissions.test.ts
```

You may edit `package.json` only to change `db:seed` to `tsx scripts/seed.ts`.

## 1. Schema — `db/migrations/001_init.sql`

One file, wrapped in `BEGIN; … COMMIT;`. Use exactly these tables and columns.

```sql
CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  designation text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  global_role text NOT NULL CHECK (global_role IN ('principal','chair','head','member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at bigint NOT NULL
);

CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  revoked_at bigint
);

CREATE TABLE cells (
  id text PRIMARY KEY,
  number integer NOT NULL UNIQUE,
  name text NOT NULL,
  mandate text NOT NULL DEFAULT ''
);

CREATE TABLE memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell_id text NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('head','member')),
  created_at bigint NOT NULL,
  UNIQUE (user_id, cell_id)
);

CREATE TABLE circulars (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  received_at bigint NOT NULL,
  due_at bigint,
  state text NOT NULL DEFAULT 'intake'
    CHECK (state IN ('intake','route','convene','pre_meeting','meeting','implement','verify','report','done')),
  cell_id text REFERENCES cells(id),
  assigned_to text REFERENCES users(id),
  created_by text NOT NULL REFERENCES users(id),
  confidential boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE classifications (
  circular_id text PRIMARY KEY REFERENCES circulars(id) ON DELETE CASCADE,
  suggestion jsonb,
  final jsonb,
  verdict text CHECK (verdict IN ('confirmed','corrected')),
  decided_by text REFERENCES users(id),
  decided_at bigint,
  CONSTRAINT verdict_needs_final CHECK (verdict IS NULL OR final IS NOT NULL)
);

CREATE TABLE meetings (
  id text PRIMARY KEY,
  circular_id text NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  held_at bigint NOT NULL,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','held','signed')),
  minutes_md text,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  signed_by text REFERENCES users(id),
  signed_at bigint,
  created_at bigint NOT NULL
);

CREATE TABLE actions (
  id text PRIMARY KEY,
  circular_id text NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  meeting_id text REFERENCES meetings(id) ON DELETE SET NULL,
  title text NOT NULL,
  owner_id text REFERENCES users(id),
  due_at bigint,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  completed_at bigint,
  created_at bigint NOT NULL
);

CREATE TABLE documents (
  id text PRIMARY KEY,
  circular_id text NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
  kind text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content_md text NOT NULL,
  created_by text REFERENCES users(id),
  approved_by text REFERENCES users(id),
  approved_at bigint,
  created_at bigint NOT NULL,
  UNIQUE (circular_id, kind, version)
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  actor_id text REFERENCES users(id),
  action text NOT NULL,
  entity_type text,
  entity_id text,
  cell_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at bigint NOT NULL
);
```

Indexes: `circulars(state)`, `circulars(cell_id)`, `circulars(due_at)`,
`actions(circular_id)`, `actions(owner_id, status)`, `audit_events(entity_type, entity_id)`,
`audit_events(at)`.

Seed the 14 cells from `CELL_SPEC` in `contracts.ts`, `ON CONFLICT (id) DO NOTHING`.

## 2. Migrations runner — `scripts/migrate.mjs`

Plain Node, `pg`. Connect with `process.env.DIRECT_URL ?? process.env.DATABASE_URL`.
Create `_migrations(id text primary key, applied_at bigint not null)` if missing.
Apply each `db/migrations/*.sql` in filename order when its id (filename without `.sql`)
is not recorded. Run each file as one batch (files own their transaction). Record the id
after success. Never print the connection string. Stop at first failure with exit 1.

## 3. Password + sessions

`src/lib/core/password.ts` — **pure, no `server-only` import** (the seed script uses it):

```ts
export function hashPassword(pw: string): string
export function verifyPassword(pw: string, stored: string): boolean
```

Use `node:crypto` `scryptSync` with a 16-byte random salt, N=16384. Store as
`scrypt$<saltHex>$<hashHex>`. Compare with `timingSafeEqual`.

`src/lib/core/auth.ts` (`import "server-only"`):

- `createSession(userId): Promise<{ token: string; sessionId: string }>` — 32 random bytes
  base64url; store sha256 hex of the token in `auth_sessions`.
- `resolveActor(req: Request): Promise<Actor | null>` — accept `Authorization: Bearer <token>`
  or cookie `eoc_session`; look up by token hash where `revoked_at IS NULL`; reject disabled
  users; update `last_seen_at`; load memberships; map DB rows to the `Actor` type.
- `setSessionCookie(res: NextResponse, token: string): void` — `eoc_session`, `httpOnly`,
  `sameSite: "lax"`, `path: "/"`, `secure: process.env.NODE_ENV === "production"`,
  maxAge 30 days.
- `clearSessionCookie(res): void`
- `revokeSession(sessionId): Promise<void>` — set `revoked_at`.

## 4. Permissions — `src/lib/core/permissions.ts`

Pure functions over `Actor` from contracts. **This is the heart of the product.**

```ts
export function cellRoleOf(actor: Actor, cellId: string | null): CellRole | null
export function isChair(actor: Actor): boolean      // global_role === 'chair'
export function isPrincipal(actor: Actor): boolean  // global_role === 'principal'
export function canReadCircular(actor, c: { cellId, confidential }): boolean
export function canCreateCircular(actor): boolean
export function canEditCircular(actor, c): boolean
export function canConfirmClassification(actor, cellId): boolean
export function canAdvance(actor, c): boolean
export function canSignMinutes(actor, cellId): boolean
export function canCloseAction(actor, ownerId, cellId): boolean
export function canExport(actor): boolean           // anyone signed in
export function canReadAudit(actor, cellId): boolean
```

Rules:
- `canReadCircular`: confidential ⇒ principal, chair, or member of that cell; otherwise
  any authenticated actor (institutional transparency).
- `canCreateCircular`: everyone except principal (read-only).
- `canEditCircular` / `canAdvance` / `canSignMinutes`: chair, or head of that cell.
- `canConfirmClassification`: chair, or head of the routed cell. **Members cannot.**
- `canCloseAction`: the owner, or chair, or head of the action's cell.
- `canReadAudit`: chair, principal, or head for their own cell.
- Principal is read-only everywhere: every write predicate returns false for principal.

## 5. Routes

All handlers: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
Success `{ ok: true, ... }`, failure `{ error }` with a truthful status.

- `GET /api/health` → `{ ok, database: boolean, aiConfigured: boolean }` (SELECT 1).
- `POST /api/auth/login` `{ email, password }` → `{ ok, user, memberships }` + cookie.
  401 generic message for both unknown email and wrong password. 429 after 10 attempts
  per `ip|email` per minute (in-process Map is fine).
- `POST /api/auth/logout` → revoke + clear cookie.
- `GET /api/me` → `{ ok, user, memberships }` or 401.
- `GET /api/cells` → `{ ok, cells: Cell[] }` — 14 cells with head name and open-circular
  count. Requires an actor.

## 6. Seed — `scripts/seed.ts`

Run with `tsx`. Insert users (password `Eoc@2026` for all, `mustChangePassword` concept does
not exist in v2), memberships, using `hashPassword` from `src/lib/core/password.ts`.
Idempotent (`ON CONFLICT DO NOTHING`).

Users (id = `usr_<slug>`):

| email | name | global_role | membership |
|---|---|---|---|
| principal@hkbk.edu.in | Dr. Mohammed Riyaz Ahmed | principal | — |
| chair@hkbk.edu.in | Prof. Khallikkunaisa | chair | head of cell_03, cell_08, cell_09, cell_11, cell_12, cell_14 |
| balaji@hkbk.edu.in | Dr. Balaji Vijayan V | head | head cell_01 |
| salim@hkbk.edu.in | Dr. Salim Sharieff | head | head cell_02 |
| maaz@hkbk.edu.in | Dr. Maaz Ahmed | head | head cell_04 |
| naresh@hkbk.edu.in | Prof. Naresh MK | head | head cell_05 |
| sumaiya@hkbk.edu.in | Prof. Sumaiya Banu | head | head cell_06 |
| vinay@hkbk.edu.in | Vinay A L | head | head cell_07 |
| arshad@hkbk.edu.in | Dr. Arshad Pasha | head | head cell_10 |
| umme@hkbk.edu.in | Prof. Umme Salma | head | head cell_13 |
| member@hkbk.edu.in | Prof. Bharath V | member | member cell_01 |

## 7. Tests — `tests/permissions.test.ts`

Use `node:test` + `node:assert/strict`. Cover at minimum:
1. a member cannot confirm a classification; a head of that cell can; a head of another cell cannot
2. the chair can confirm any cell
3. the principal can confirm nothing and cannot create circulars
4. a confidential circular is invisible to a member of another cell, visible to its own cell,
   the chair and the principal
5. `canCloseAction` allows the owner and the cell head, not an unrelated member
6. `canReadAudit` allows chair/principal, and a head only for their own cell

## Acceptance (run these yourself and paste the output)

```
npm install
node scripts/migrate.mjs
npm run db:seed
npm run typecheck
npm test
npm run dev -- -p 3001   (background, then curl)
```

- `GET /api/health` → `{ok:true, database:true}`
- login as `chair@hkbk.edu.in` / `Eoc@2026` → 200 + cookie
- `GET /api/cells` with the cookie → 14 cells
- `npm test` → all permission tests pass

## Boundaries

- **Do not edit** `src/lib/contracts.ts`, `.env.local`, `package.json` dependencies.
- **Do not build** any UI, any circular/meeting/report module. Only the files listed.
- No new dependencies.
- Do not touch the sibling app `EOC-Assist-App`.
