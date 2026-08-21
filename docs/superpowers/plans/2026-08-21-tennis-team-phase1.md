# Tennis Team Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an invite-only web app where a tennis team's members sign in by emailed link, maintain player profiles with photos and weekly availability, and record match results that produce per-player win/loss records.

**Architecture:** One npm-workspaces repo producing a single Docker image: a Fastify API that also serves the built React client, so there is one origin, no CORS, and cookie sessions that simply work. Request and response shapes live once in `packages/contracts` as TypeBox schemas, validated at runtime by Fastify and imported as types by the client. The API is built by a `buildApp({ db, mailer, storage, now })` factory so every dependency has a test double and every route is testable via `app.inject()`.

**Tech Stack:** Node 22, Fastify 5, TypeBox, Kysely over node-postgres, PostgreSQL 16, React 19, Vite 6, Tailwind CSS 4, React Router 7, TanStack Query 5, React Hook Form with the TypeBox resolver, Vitest, Playwright, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-21-tennis-team-phase1-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Node `>=22`. All packages are ESM (`"type": "module"`). TypeScript `strict: true`.
- One team per deployment. No multi-tenancy anywhere in the schema or API.
- Every request and response shape is a TypeBox schema in `packages/contracts`. No route may declare an inline schema, and no client may hand-write a request type.
- Every route except `POST /api/auth/request-link`, `GET /api/auth/callback`, and `GET /health` requires an authenticated session.
- Authorisation is declared on the route definition, never checked inside a handler body.
- Every protected route gets an integration test asserting `401` unauthenticated, and every admin-only route additionally asserts `403` as a `player`.
- Error responses always use the envelope `{ "error": { "code", "message", "details"? } }`.
- Logs never contain an email address, a token, or a session id. Log `member_id`.
- Timestamps are `timestamptz`. Emails are `citext`. Primary keys are `bigint generated always as identity`, except `player_profiles`, keyed by `member_id`.
- Migrations are numbered, forward-only `.sql` files. Never edit an applied migration; add a new one.
- No secret value is ever committed. `.env.example` documents every variable.
- Layouts are authored at 360 px and widened at the `sm` (640 px) and `lg` (1024 px) breakpoints. Interactive targets are at least 44 px. No interaction depends on hover.
- Commit after every task. Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`).

---

## File Structure

```
tennis-team/
├─ package.json                     workspaces root, shared scripts
├─ tsconfig.base.json               strict compiler options, shared
├─ eslint.config.js                 flat config, TS + react-hooks
├─ docker-compose.yml               Postgres 16 for local dev and tests
├─ Dockerfile                       3-stage: deps → build → runtime
├─ .env.example                     every variable, no values
├─ .github/workflows/ci.yml         typecheck, lint, unit, integration, e2e
├─ db/
│  ├─ migrations/0001_members.sql … 0006_matches.sql, 0007_player_records.sql
│  └─ README.md                     how to add a migration
├─ packages/contracts/src/
│  ├─ index.ts                      barrel re-export
│  ├─ common.ts                     ErrorEnvelope, Id, IsoDate, Pagination
│  ├─ member.ts                     MemberRole/Status, Member, InviteBody, PatchMemberBody
│  ├─ profile.ts                    PlayerProfile, ProfileSetupBody, PatchProfileBody
│  ├─ availability.ts              Weekday, Block, AvailabilityGrid, WhoIsFreeQuery
│  ├─ match.ts                      MatchFormat, Match, CreateMatchBody, MatchListQuery
│  └─ photo.ts                      PresignBody, PresignResponse, ConfirmPhotoBody
├─ apps/api/src/
│  ├─ index.ts                      process entry: config → deps → buildApp → listen
│  ├─ app.ts                        buildApp factory; plugin + route registration order
│  ├─ config.ts                     env parsing, fails fast on missing vars
│  ├─ db/schema.ts                  Kysely Database interface
│  ├─ db/client.ts                  pool + Kysely construction
│  ├─ db/migrate.ts                 migration runner (also the release command)
│  ├─ db/bootstrap.ts               idempotent first-admin bootstrap
│  ├─ plugins/error-handler.ts      envelope, request-id, 500 redaction
│  ├─ plugins/origin-guard.ts       Origin check on state-changing methods
│  ├─ plugins/session.ts            cookie → request.member; requireAuth/requireRole
│  ├─ auth/tokens.ts                token generation, hashing, expiry (pure)
│  ├─ auth/sessions.ts              session create / resolve / revoke
│  ├─ auth/mailer.ts                Mailer port + Resend impl + FakeMailer
│  ├─ storage/object-store.ts       ObjectStore port + S3 impl + FakeStore
│  ├─ storage/images.ts             re-encode + EXIF strip (sharp)
│  ├─ routes/auth.ts                request-link, callback, logout, me
│  ├─ routes/members.ts             roster, invite, patch, remove, resend
│  ├─ routes/profiles.ts            get, setup, patch, photo presign/confirm
│  ├─ routes/availability.ts        get, replace, who-is-free
│  ├─ routes/matches.ts             list, get, create, patch, delete, record
│  ├─ routes/health.ts              DB ping
│  ├─ routes/test-only.ts           last-token lookup, registered only in test
│  ├─ jobs/cleanup.ts               hourly expired-row sweep
│  └─ static.ts                     serve built client, SPA fallback
├─ apps/api/test/
│  ├─ setup/global.ts               apply migrations once against TEST_DATABASE_URL
│  ├─ setup/harness.ts              per-test transaction + buildApp with fakes
│  └─ *.test.ts                     one file per route module + unit tests
├─ apps/web/src/
│  ├─ main.tsx, App.tsx, routes.tsx
│  ├─ index.css                     Tailwind import + @theme design tokens
│  ├─ api/client.ts                 fetch wrapper, envelope → typed error
│  ├─ api/queries.ts                TanStack Query hooks, one per endpoint
│  ├─ auth/SessionGate.tsx          redirects unauthenticated → /login, no profile → /setup
│  ├─ components/                   Button, Card, Field, Avatar, Toggle, AppShell, BottomTabs
│  └─ screens/                      Login, Setup, Roster, Player, Me, Matches, RecordMatch, Admin
└─ e2e/                             Playwright config + one full-journey spec
```

Two boundaries carry most of the weight. `buildApp` takes its dependencies as arguments, so tests never touch the network or a real bucket. And the `Mailer` and `ObjectStore` ports mean the two external services are each one small interface with a fake — Phase 2's video upload will extend `ObjectStore` rather than rewrite it.

---

### Task 1: Workspace, tooling, and green CI

Produces a repo where `npm test`, `npm run typecheck`, and `npm run lint` all pass, and CI runs them on push. Everything later builds on this, so it ships with one real (if trivial) contract test to prove the wiring.

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/common.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/common.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `@tennis/contracts` exporting `ErrorEnvelope` (TypeBox schema), `Id = Type.Integer({ minimum: 1 })`, `IsoDate = Type.String({ format: 'date' })`. Root scripts `npm run typecheck`, `npm run lint`, `npm test`.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "tennis-team",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "test": "npm run test --workspaces --if-present",
    "db:up": "docker compose up -d db",
    "db:down": "docker compose down"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.18.0",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "composite": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

Root `tsconfig.json` is a solution file only:

```json
{ "files": [], "references": [{ "path": "packages/contracts" }] }
```

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/playwright-report/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/consistent-type-imports': 'error' } },
)
```

- [ ] **Step 2: Create the contracts package**

`packages/contracts/package.json`:

```json
{
  "name": "@tennis/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": { "@sinclair/typebox": "^0.34.9" }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`packages/contracts/src/common.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'

export const Id = Type.Integer({ minimum: 1 })
export const IsoDate = Type.String({ format: 'date' })

export const ErrorEnvelope = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
})
export type ErrorEnvelope = Static<typeof ErrorEnvelope>
```

`packages/contracts/src/index.ts`:

```ts
export * from './common.js'
```

- [ ] **Step 3: Write the failing test**

`packages/contracts/test/common.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { ErrorEnvelope, Id } from '../src/index.js'

describe('contracts', () => {
  it('accepts a well-formed error envelope', () => {
    const ok = { error: { code: 'not_found', message: 'No such member' } }
    expect(Value.Check(ErrorEnvelope, ok)).toBe(true)
  })

  it('rejects an envelope missing a code', () => {
    expect(Value.Check(ErrorEnvelope, { error: { message: 'x' } })).toBe(false)
  })

  it('rejects a non-positive id', () => {
    expect(Value.Check(Id, 0)).toBe(false)
    expect(Value.Check(Id, 7)).toBe(true)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test --workspace @tennis/contracts`
Expected: FAIL — `Cannot find module '../src/index.js'` until Step 2's files exist; if Step 2 is already done, this passes and you skip to Step 5.

- [ ] **Step 5: Install, typecheck, lint, and test**

```bash
npm install
npm run typecheck
npm run lint
npm test
```

Expected: all four succeed. `typecheck` emits `packages/contracts/dist`.

- [ ] **Step 6: Add Postgres for local development**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: tennis
      POSTGRES_USER: tennis
      POSTGRES_DB: tennis
    ports: ['5433:5432']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U tennis -d tennis']
      interval: 5s
      timeout: 5s
      retries: 20
```

Port 5433 deliberately, so this never collides with a Postgres already listening on 5432.

`.env.example`:

```
DATABASE_URL=postgres://tennis:tennis@localhost:5433/tennis
TEST_DATABASE_URL=postgres://tennis:tennis@localhost:5433/tennis_test
SESSION_SECRET=generate-32-plus-random-bytes
APP_ORIGIN=http://localhost:3000
BOOTSTRAP_ADMIN_EMAIL=you@example.com
RESEND_API_KEY=
MAIL_FROM=Tennis Team <noreply@example.com>
STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
PORT=3000
NODE_ENV=development
```

- [ ] **Step 7: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: tennis
          POSTGRES_USER: tennis
          POSTGRES_DB: tennis_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tennis" --health-interval 5s
          --health-timeout 5s --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://tennis:tennis@localhost:5432/tennis_test
      SESSION_SECRET: ci-secret-value-at-least-32-chars-long
      APP_ORIGIN: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

The Playwright job is added in Task 20; do not add a placeholder for it now.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold workspace, contracts package, and CI"
git push
```

Then confirm the run is green: `gh run watch --exit-status`.

---

### Task 2: Schema, migration runner, and the integration test harness

The single most leveraged task: every later backend task depends on the harness this produces. It ships the whole schema at once because the tables are meaningless individually and a reviewer would accept or reject them as one design.

**Files:**
- Create: `db/migrations/0001_extensions.sql` … `0007_player_records.sql`, `db/README.md`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/config.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/db/migrate.ts`
- Create: `apps/api/test/setup/global.ts`, `apps/api/test/setup/harness.ts`
- Modify: root `tsconfig.json` (add the `apps/api` reference)
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Consumes: `@tennis/contracts`.
- Produces:
  - `config: { databaseUrl, sessionSecret, appOrigin, port, nodeEnv, bootstrapAdminEmail, mail, storage }` from `src/config.ts`, throwing on a missing required variable.
  - `type Database` (Kysely) and `createDb(url: string): Kysely<Database>` from `src/db/client.ts`.
  - `runMigrations(db: Kysely<Database>): Promise<string[]>` from `src/db/migrate.ts`, returning the filenames applied.
  - `withTx(fn: (db: Kysely<Database>) => Promise<void>): Promise<void>` from `test/setup/harness.ts` — runs `fn` inside a transaction that is always rolled back.

- [ ] **Step 1: Create the api package**

`apps/api/package.json`:

```json
{
  "name": "@tennis/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "test": "vitest run",
    "migrate": "node dist/db/migrate.js"
  },
  "dependencies": {
    "@tennis/contracts": "*",
    "kysely": "^0.27.5",
    "pg": "^8.13.1"
  },
  "devDependencies": { "@types/pg": "^8.11.10" }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../../packages/contracts" }]
}
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/global.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
```

`fileParallelism: false` because every test file shares one Postgres database. Parallel files would deadlock on the same rows.

- [ ] **Step 2: Write the migrations**

`0001_extensions.sql`:

```sql
create extension if not exists citext;
```

`0002_members.sql`:

```sql
create table members (
  id            bigint generated always as identity primary key,
  email         citext not null unique,
  role          text   not null default 'player' check (role in ('admin','player')),
  status        text   not null default 'invited' check (status in ('invited','active','removed')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create index members_status_idx on members (status);
```

`0003_player_profiles.sql`:

```sql
create table player_profiles (
  member_id        bigint primary key references members(id) on delete cascade,
  display_name     text not null check (length(trim(display_name)) between 1 and 60),
  nickname         text check (length(nickname) <= 40),
  phone            text check (length(phone) <= 32),
  photo_key        text,
  dominant_hand    text check (dominant_hand in ('left','right')),
  backhand         text check (backhand in ('one','two')),
  preferred_format text check (preferred_format in ('singles','doubles','both')),
  rating_system    text not null default 'none' check (rating_system in ('utr','ntrp','club','none')),
  rating_value     text check (length(rating_value) <= 16),
  racquet          text check (length(racquet) <= 80),
  bio              text check (length(bio) <= 500),
  updated_at       timestamptz not null default now(),
  constraint rating_value_requires_system
    check (rating_system <> 'none' or rating_value is null)
);
```

`0004_auth.sql`:

```sql
create table login_tokens (
  id          bigint generated always as identity primary key,
  member_id   bigint not null references members(id) on delete cascade,
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index login_tokens_member_idx on login_tokens (member_id, created_at desc);

create table sessions (
  id           bigint generated always as identity primary key,
  member_id    bigint not null references members(id) on delete cascade,
  token_hash   bytea not null unique,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  user_agent   text
);
create index sessions_member_idx on sessions (member_id);
create index sessions_expiry_idx on sessions (expires_at);
```

`0005_availability.sql`:

```sql
create table availability (
  member_id bigint not null references members(id) on delete cascade,
  weekday   smallint not null check (weekday between 0 and 6),
  block     text not null check (block in ('morning','afternoon','evening')),
  primary key (member_id, weekday, block)
);
create index availability_slot_idx on availability (weekday, block);
```

`0006_matches.sql`:

```sql
create table matches (
  id           bigint generated always as identity primary key,
  played_on    date not null,
  format       text not null check (format in ('singles','doubles')),
  venue        text check (length(venue) <= 120),
  notes        text check (length(notes) <= 500),
  winner_side  smallint not null check (winner_side in (1,2)),
  recorded_by  bigint not null references members(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index matches_recent_idx on matches (played_on desc, id desc);

create table match_players (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references matches(id) on delete cascade,
  side       smallint not null check (side in (1,2)),
  member_id  bigint references members(id),
  guest_name text check (length(guest_name) <= 80),
  constraint exactly_one_identity check (
    (member_id is not null and guest_name is null) or
    (member_id is null and guest_name is not null)
  )
);
create index match_players_match_idx on match_players (match_id);
create index match_players_member_idx on match_players (member_id);

create table match_sets (
  id           bigint generated always as identity primary key,
  match_id     bigint not null references matches(id) on delete cascade,
  set_number   smallint not null check (set_number between 1 and 5),
  side1_games  smallint not null check (side1_games between 0 and 99),
  side2_games  smallint not null check (side2_games between 0 and 99),
  unique (match_id, set_number)
);
```

`0007_player_records.sql`:

```sql
create view player_records as
select
  m.id as member_id,
  count(mp.id) as matches_played,
  count(*) filter (where mp.side = mt.winner_side) as wins,
  count(*) filter (where mp.id is not null and mp.side <> mt.winner_side) as losses
from members m
left join match_players mp on mp.member_id = m.id
left join matches mt on mt.id = mp.match_id
group by m.id;
```

`count(mp.id)` ignores nulls, so a member with no matches reports zero rather than one.

- [ ] **Step 3: Write the Kysely schema and client**

`apps/api/src/db/schema.ts`:

```ts
import type { ColumnType, Generated } from 'kysely'

type Ts = ColumnType<Date, Date | string | undefined, Date | string>

export interface MembersTable {
  id: Generated<number>
  email: string
  role: 'admin' | 'player'
  status: 'invited' | 'active' | 'removed'
  created_at: Generated<Ts>
  last_seen_at: Ts | null
}

export interface PlayerProfilesTable {
  member_id: number
  display_name: string
  nickname: string | null
  phone: string | null
  photo_key: string | null
  dominant_hand: 'left' | 'right' | null
  backhand: 'one' | 'two' | null
  preferred_format: 'singles' | 'doubles' | 'both' | null
  rating_system: 'utr' | 'ntrp' | 'club' | 'none'
  rating_value: string | null
  racquet: string | null
  bio: string | null
  updated_at: Generated<Ts>
}

export interface LoginTokensTable {
  id: Generated<number>
  member_id: number
  token_hash: Buffer
  expires_at: Ts
  consumed_at: Ts | null
  created_at: Generated<Ts>
}

export interface SessionsTable {
  id: Generated<number>
  member_id: number
  token_hash: Buffer
  expires_at: Ts
  created_at: Generated<Ts>
  last_used_at: Generated<Ts>
  user_agent: string | null
}

export interface AvailabilityTable {
  member_id: number
  weekday: number
  block: 'morning' | 'afternoon' | 'evening'
}

export interface MatchesTable {
  id: Generated<number>
  played_on: ColumnType<string, string, string>
  format: 'singles' | 'doubles'
  venue: string | null
  notes: string | null
  winner_side: 1 | 2
  recorded_by: number
  created_at: Generated<Ts>
  updated_at: Generated<Ts>
}

export interface MatchPlayersTable {
  id: Generated<number>
  match_id: number
  side: 1 | 2
  member_id: number | null
  guest_name: string | null
}

export interface MatchSetsTable {
  id: Generated<number>
  match_id: number
  set_number: number
  side1_games: number
  side2_games: number
}

export interface PlayerRecordsView {
  member_id: number
  matches_played: number
  wins: number
  losses: number
}

export interface Database {
  members: MembersTable
  player_profiles: PlayerProfilesTable
  login_tokens: LoginTokensTable
  sessions: SessionsTable
  availability: AvailabilityTable
  matches: MatchesTable
  match_players: MatchPlayersTable
  match_sets: MatchSetsTable
  player_records: PlayerRecordsView
}
```

`apps/api/src/db/client.ts`:

```ts
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

// count(...) returns bigint; without this every aggregate arrives as a string.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 })
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}
```

- [ ] **Step 4: Write the migration runner**

`apps/api/src/db/migrate.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql, type Kysely } from 'kysely'
import type { Database } from './schema.js'

const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(here, '../../../../db/migrations')

export async function runMigrations(db: Kysely<Database>): Promise<string[]> {
  await sql`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `.execute(db)

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set(
    (await sql<{ name: string }>`select name from _migrations`.execute(db)).rows.map((r) => r.name),
  )

  const ran: string[] = []
  for (const name of files) {
    if (applied.has(name)) continue
    const body = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    await db.transaction().execute(async (tx) => {
      await sql.raw(body).execute(tx)
      await sql`insert into _migrations (name) values (${name})`.execute(tx)
    })
    ran.push(name)
  }
  return ran
}
```

Each migration runs in its own transaction, so a failure half-way leaves the earlier ones applied and the failing one wholly rolled back.

- [ ] **Step 5: Write config parsing**

`apps/api/src/config.ts`:

```ts
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined
}

export interface Config {
  nodeEnv: string
  port: number
  databaseUrl: string
  sessionSecret: string
  appOrigin: string
  bootstrapAdminEmail: string | undefined
  mail: { apiKey: string | undefined; from: string }
  storage: {
    endpoint: string | undefined
    bucket: string | undefined
    accessKeyId: string | undefined
    secretAccessKey: string | undefined
  }
}

export function loadConfig(): Config {
  const sessionSecret = required('SESSION_SECRET')
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sessionSecret,
    appOrigin: required('APP_ORIGIN'),
    bootstrapAdminEmail: optional('BOOTSTRAP_ADMIN_EMAIL'),
    mail: { apiKey: optional('RESEND_API_KEY'), from: process.env.MAIL_FROM ?? 'Tennis Team <noreply@localhost>' },
    storage: {
      endpoint: optional('STORAGE_ENDPOINT'),
      bucket: optional('STORAGE_BUCKET'),
      accessKeyId: optional('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: optional('STORAGE_SECRET_ACCESS_KEY'),
    },
  }
}
```

- [ ] **Step 6: Write the test harness**

`apps/api/test/setup/global.ts`:

```ts
import { createDb, createPool } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is required to run integration tests')
  const pool = createPool(url)
  const db = createDb(pool)
  try {
    await runMigrations(db)
  } finally {
    await db.destroy()
  }
}
```

`apps/api/test/setup/harness.ts`:

```ts
import { afterAll } from 'vitest'
import type { Kysely } from 'kysely'
import { createDb, createPool } from '../../src/db/client.js'
import type { Database } from '../../src/db/schema.js'

const pool = createPool(process.env.TEST_DATABASE_URL!)
const root = createDb(pool)

afterAll(async () => {
  await root.destroy()
})

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, so tests share
 * one migrated database without leaking rows into each other.
 */
export async function withTx(fn: (db: Kysely<Database>) => Promise<void>): Promise<void> {
  const sentinel = new Error('rollback')
  try {
    await root.transaction().execute(async (tx) => {
      await fn(tx)
      throw sentinel
    })
  } catch (err) {
    if (err !== sentinel) throw err
  }
}
```

- [ ] **Step 7: Write the failing schema test**

`apps/api/test/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { withTx } from './setup/harness.js'

describe('schema', () => {
  it('stores a member and cascades the profile on delete', async () => {
    await withTx(async (db) => {
      const member = await db
        .insertInto('members')
        .values({ email: 'A.Player@Example.com', role: 'player', status: 'invited' })
        .returning(['id', 'email'])
        .executeTakeFirstOrThrow()

      // citext: the stored address compares case-insensitively.
      const found = await db
        .selectFrom('members')
        .selectAll()
        .where('email', '=', 'a.player@example.com')
        .executeTakeFirst()
      expect(found?.id).toBe(member.id)

      await db
        .insertInto('player_profiles')
        .values({ member_id: member.id, display_name: 'A Player' })
        .execute()

      await db.deleteFrom('members').where('id', '=', member.id).execute()
      const orphan = await db
        .selectFrom('player_profiles')
        .selectAll()
        .where('member_id', '=', member.id)
        .executeTakeFirst()
      expect(orphan).toBeUndefined()
    })
  })

  it('rejects a rating value when the rating system is none', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'r@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await expect(
        db
          .insertInto('player_profiles')
          .values({ member_id: m.id, display_name: 'R', rating_system: 'none', rating_value: '4.0' })
          .execute(),
      ).rejects.toThrow(/rating_value_requires_system/)
    })
  })

  it('rejects a match player that is both a member and a guest', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'g@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const match = await db
        .insertInto('matches')
        .values({ played_on: '2026-08-01', format: 'singles', winner_side: 1, recorded_by: m.id })
        .returning('id')
        .executeTakeFirstOrThrow()

      await expect(
        db
          .insertInto('match_players')
          .values({ match_id: match.id, side: 1, member_id: m.id, guest_name: 'Nope' })
          .execute(),
      ).rejects.toThrow(/exactly_one_identity/)
    })
  })

  it('reports zero counts for a member who has played no matches', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'zero@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const rec = await db
        .selectFrom('player_records')
        .selectAll()
        .where('member_id', '=', m.id)
        .executeTakeFirstOrThrow()
      expect(rec).toMatchObject({ matches_played: 0, wins: 0, losses: 0 })
    })
  })

  it('counts a win for the member on the winning side', async () => {
    await withTx(async (db) => {
      const [winner, loser] = await Promise.all([
        db.insertInto('members').values({ email: 'w@example.com' }).returning('id').executeTakeFirstOrThrow(),
        db.insertInto('members').values({ email: 'l@example.com' }).returning('id').executeTakeFirstOrThrow(),
      ])
      const match = await db
        .insertInto('matches')
        .values({ played_on: '2026-08-02', format: 'singles', winner_side: 1, recorded_by: winner.id })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db
        .insertInto('match_players')
        .values([
          { match_id: match.id, side: 1, member_id: winner.id },
          { match_id: match.id, side: 2, member_id: loser.id },
        ])
        .execute()

      const rows = await db
        .selectFrom('player_records')
        .selectAll()
        .where('member_id', 'in', [winner.id, loser.id])
        .execute()
      expect(rows.find((r) => r.member_id === winner.id)).toMatchObject({ wins: 1, losses: 0, matches_played: 1 })
      expect(rows.find((r) => r.member_id === loser.id)).toMatchObject({ wins: 0, losses: 1, matches_played: 1 })
    })
  })
})
```

- [ ] **Step 8: Run the test to verify it fails**

```bash
npm run db:up
docker compose exec -T db psql -U tennis -d tennis -c "create database tennis_test"
npm test --workspace @tennis/api
```

Expected: FAIL — `relation "members" does not exist` if migrations are missing, or an assertion failure. Confirm the failure names the missing piece before implementing.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test --workspace @tennis/api`
Expected: PASS, 5 tests. Then `npm run typecheck` and `npm run lint` clean.

- [ ] **Step 10: Document how to add a migration**

`db/README.md`:

```markdown
# Migrations

Numbered, forward-only SQL. Applied in filename order by `apps/api/src/db/migrate.ts`,
each inside its own transaction, tracked in the `_migrations` table.

- Add a new file: `NNNN_short_name.sql`, next number in sequence.
- NEVER edit a file that has been applied anywhere. Add a new migration instead.
- No `down` migrations. To reverse something, write a forward migration that undoes it.
- Run locally: `npm run db:up && npm run migrate --workspace @tennis/api`
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add schema, migration runner, and integration test harness"
git push
```

---

### Task 3: Fastify app factory, error envelope, origin guard, health

Establishes the seam every later route hangs off. The `buildApp` factory takes its dependencies as arguments so no test ever touches a real mailer or bucket.

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/error-handler.ts`, `apps/api/src/plugins/origin-guard.ts`, `apps/api/src/routes/health.ts`
- Modify: `apps/api/package.json` (add fastify deps)
- Test: `apps/api/test/app.test.ts`

**Interfaces:**
- Consumes: `createDb`, `Database`, `Config` from Task 2.
- Produces:
  - `interface Deps { db: Kysely<Database>; config: Config; mailer: Mailer; storage: ObjectStore; now: () => Date }`
  - `buildApp(deps: Deps): Promise<FastifyInstance>` from `src/app.ts`.
  - `class AppError extends Error { statusCode: number; code: string; details?: unknown }` from `src/plugins/error-handler.ts`, plus helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`.
  - `Mailer` and `ObjectStore` are declared as minimal interfaces here and implemented in Tasks 4 and 9. Declare them in this task exactly as:

```ts
export interface Mailer {
  sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void>
}
export interface ObjectStore {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<string>
  get(key: string): Promise<Buffer>
  put(key: string, body: Buffer, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  publicUrl(key: string): string
}
```

- [ ] **Step 1: Add dependencies**

```bash
npm install --workspace @tennis/api fastify @fastify/cookie @fastify/helmet @fastify/rate-limit @fastify/static
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'

describe('app', () => {
  it('reports healthy when the database answers', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ status: 'ok' })
    })
  })

  it('returns the error envelope for an unknown route', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/nope' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: { code: 'not_found' } })
    })
  })

  it('hides internal detail behind a request id on an unexpected error', async () => {
    await buildTestApp(async (app) => {
      app.get('/api/boom', () => {
        throw new Error('secret internal detail')
      })
      const res = await app.inject({ method: 'GET', url: '/api/boom' })
      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(JSON.stringify(body)).not.toContain('secret internal detail')
      expect(body.error.details).toHaveProperty('requestId')
    })
  })

  it('rejects a state-changing request with a foreign Origin', async () => {
    await buildTestApp(async (app) => {
      app.post('/api/echo', () => ({ ok: true }))
      const res = await app.inject({
        method: 'POST',
        url: '/api/echo',
        headers: { origin: 'https://evil.example' },
        payload: {},
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: { code: 'bad_origin' } })
    })
  })

  it('allows a state-changing request from the app origin', async () => {
    await buildTestApp(async (app) => {
      app.post('/api/echo', () => ({ ok: true }))
      const res = await app.inject({
        method: 'POST',
        url: '/api/echo',
        headers: { origin: 'http://localhost:3000' },
        payload: {},
      })
      expect(res.statusCode).toBe(200)
    })
  })

  it('allows a GET with no Origin header', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    })
  })
})
```

- [ ] **Step 3: Extend the harness with `buildTestApp`**

Append to `apps/api/test/setup/harness.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import type { Mailer, ObjectStore } from '../../src/app.js'

export const testConfig: Config = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: process.env.TEST_DATABASE_URL!,
  sessionSecret: 'test-secret-value-that-is-long-enough-ok',
  appOrigin: 'http://localhost:3000',
  bootstrapAdminEmail: undefined,
  mail: { apiKey: undefined, from: 'Tennis Team <noreply@localhost>' },
  storage: { endpoint: undefined, bucket: undefined, accessKeyId: undefined, secretAccessKey: undefined },
}

export interface SentMail {
  to: string
  url: string
  kind: 'invite' | 'signin'
}

export class FakeMailer implements Mailer {
  readonly sent: SentMail[] = []
  async sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    this.sent.push({ to, url, kind })
  }
  get last(): SentMail | undefined {
    return this.sent.at(-1)
  }
}

export class FakeStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()
  async presignPut(key: string): Promise<string> {
    return `https://fake-storage.local/${key}?signed=1`
  }
  async get(key: string): Promise<Buffer> {
    const o = this.objects.get(key)
    if (!o) throw new Error(`no such object: ${key}`)
    return o.body
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType })
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
  publicUrl(key: string): string {
    return `https://fake-storage.local/${key}`
  }
}

export interface TestCtx {
  db: Kysely<Database>
  mailer: FakeMailer
  storage: FakeStore
  clock: { now: Date }
}

/**
 * Builds an app bound to a rolled-back transaction, with fake mailer and storage.
 * The clock is mutable so tests can advance time to expire tokens and sessions.
 */
export async function buildTestApp(
  fn: (app: FastifyInstance, ctx: TestCtx) => Promise<void>,
): Promise<void> {
  await withTx(async (db) => {
    const ctx: TestCtx = {
      db,
      mailer: new FakeMailer(),
      storage: new FakeStore(),
      clock: { now: new Date('2026-08-21T10:00:00Z') },
    }
    const app = await buildApp({
      db,
      config: testConfig,
      mailer: ctx.mailer,
      storage: ctx.storage,
      now: () => ctx.clock.now,
    })
    try {
      await fn(app, ctx)
    } finally {
      await app.close()
    }
  })
}
```

The injected `now` is what makes expiry testable without `setTimeout`. Nothing in `src/` may call `new Date()` directly; it calls `deps.now()`.

- [ ] **Step 4: Write the error handler**

`apps/api/src/plugins/error-handler.ts`:

```ts
import type { FastifyInstance } from 'fastify'

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details)
export const unauthorized = (msg = 'Sign in required') => new AppError(401, 'unauthorized', msg)
export const forbidden = (msg = 'Not permitted') => new AppError(403, 'forbidden', msg)
export const notFound = (msg = 'Not found') => new AppError(404, 'not_found', msg)
export const conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg)

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'No such route' } })
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const payload = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
      reply.code(err.statusCode).send({ error: payload })
      return
    }

    // Fastify's schema validation failures.
    if ('validation' in err && err.validation) {
      reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Request did not match the expected shape',
          details: { fields: err.validation.map((v) => ({ path: v.instancePath, message: v.message })) },
        },
      })
      return
    }

    if (err.statusCode === 429) {
      reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } })
      return
    }

    // Never leak internals; give the caller only the correlation id.
    req.log.error({ err, reqId: req.id }, 'unhandled error')
    reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side.',
        details: { requestId: req.id },
      },
    })
  })
}
```

- [ ] **Step 5: Write the origin guard**

`apps/api/src/plugins/origin-guard.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { AppError } from './error-handler.js'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Backs up SameSite=Lax: a state-changing request must either carry no Origin
 * (non-browser client) or carry exactly our own. Browsers always send Origin on
 * POST/PATCH/PUT/DELETE, so a cross-site form post cannot pass this.
 */
export function registerOriginGuard(app: FastifyInstance, appOrigin: string): void {
  app.addHook('onRequest', async (req) => {
    if (SAFE.has(req.method)) return
    const origin = req.headers.origin
    if (origin === undefined) return
    if (origin !== appOrigin) {
      throw new AppError(403, 'bad_origin', 'Request origin is not permitted')
    }
  })
}
```

- [ ] **Step 6: Write the app factory and health route**

`apps/api/src/routes/health.ts`:

```ts
import { sql } from 'kysely'
import type { FastifyInstance } from 'fastify'
import type { Deps } from '../app.js'

export async function healthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/health', async () => {
    await sql`select 1`.execute(deps.db)
    return { status: 'ok' }
  })
}
```

`apps/api/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { Kysely } from 'kysely'
import type { Database } from './db/schema.js'
import type { Config } from './config.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerOriginGuard } from './plugins/origin-guard.js'
import { healthRoutes } from './routes/health.js'

export interface Mailer {
  sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void>
}

export interface ObjectStore {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<string>
  get(key: string): Promise<Buffer>
  put(key: string, body: Buffer, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  publicUrl(key: string): string
}

export interface Deps {
  db: Kysely<Database>
  config: Config
  mailer: Mailer
  storage: ObjectStore
  now: () => Date
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.nodeEnv === 'test' ? 'silent' : 'info',
      // Belt and braces: even a stray log of these keys is scrubbed.
      redact: ['req.headers.cookie', 'req.headers.authorization', '*.email', '*.token'],
    },
    disableRequestLogging: deps.config.nodeEnv === 'test',
    trustProxy: true,
  })

  registerErrorHandler(app)
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cookie, { secret: deps.config.sessionSecret })
  await app.register(rateLimit, { global: false })
  registerOriginGuard(app, deps.config.appOrigin)

  await app.register(healthRoutes, deps)
  return app
}
```

`contentSecurityPolicy: false` here only because the client is not built yet; Task 19 turns it on with the real directives.

`apps/api/src/index.ts`:

```ts
import { loadConfig } from './config.js'
import { createDb, createPool } from './db/client.js'
import { buildApp } from './app.js'
import { createMailer } from './auth/mailer.js'
import { createObjectStore } from './storage/object-store.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl)
const db = createDb(pool)

const app = await buildApp({
  db,
  config,
  mailer: createMailer(config),
  storage: createObjectStore(config),
  now: () => new Date(),
})

await app.listen({ port: config.port, host: '0.0.0.0' })
```

`createMailer` and `createObjectStore` do not exist yet. Write `index.ts` in Task 4 (mailer) and Task 9 (storage) instead of stubbing them — for this task, stop at `app.ts` and let the test drive it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api`
Expected: PASS — the 5 schema tests plus the 6 app tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add app factory, error envelope, origin guard, and health check"
git push
```

---

### Task 4: Token core, sessions, mailer port, and the session plugin

The security heart of the app. Split from the auth routes deliberately: a reviewer should be able to reject the token/session mechanics without rejecting the HTTP surface, and the pure functions here deserve their own unit tests.

**Files:**
- Create: `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/mailer.ts`, `apps/api/src/plugins/session.ts`
- Modify: `apps/api/src/app.ts` (register the session plugin), `apps/api/src/index.ts` (real mailer)
- Test: `apps/api/test/tokens.test.ts`, `apps/api/test/session-plugin.test.ts`

**Interfaces:**
- Consumes: `Deps`, `AppError` helpers, `withTx`/`buildTestApp`.
- Produces:
  - `src/auth/tokens.ts`: `newToken(): { token: string; hash: Buffer }`, `hashToken(token: string): Buffer`, `TOKEN_TTL_MS = 15 * 60 * 1000`.
  - `src/auth/sessions.ts`: `SESSION_COOKIE = 'tt_session'`, `SESSION_TTL_MS = 30 * 864e5`, `createSession(deps, memberId, userAgent): Promise<string>` returning the plaintext cookie value, `resolveSession(deps, token): Promise<SessionMember | null>`, `revokeSession(deps, token): Promise<void>`, `revokeAllForMember(deps, memberId): Promise<void>`, and `type SessionMember = { id: number; email: string; role: 'admin' | 'player'; hasProfile: boolean }`.
  - `src/auth/mailer.ts`: `createMailer(config): Mailer` (Resend when `RESEND_API_KEY` is set, otherwise a console mailer that logs the link for local development).
  - `src/plugins/session.ts`: `requireAuth` and `requireRole('admin')`, both `preHandler` functions, and a `request.member: SessionMember` declaration.

- [ ] **Step 1: Write the failing unit test for tokens**

`apps/api/test/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hashToken, newToken, TOKEN_TTL_MS } from '../src/auth/tokens.js'

describe('tokens', () => {
  it('generates a URL-safe token of at least 32 bytes of entropy', () => {
    const { token } = newToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })

  it('never repeats a token', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newToken().token))
    expect(seen.size).toBe(500)
  })

  it('hashes deterministically to 32 bytes and does not embed the token', () => {
    const { token, hash } = newToken()
    expect(hash).toEqual(hashToken(token))
    expect(hash).toHaveLength(32)
    expect(hash.toString('utf8')).not.toContain(token)
  })

  it('expires tokens after fifteen minutes', () => {
    expect(TOKEN_TTL_MS).toBe(900_000)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- tokens`
Expected: FAIL — `Cannot find module '../src/auth/tokens.js'`.

- [ ] **Step 3: Implement tokens**

`apps/api/src/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'

export const TOKEN_TTL_MS = 15 * 60 * 1000

/** Only the hash is ever persisted; the plaintext lives only in the emailed URL. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @tennis/api -- tokens`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for sessions and the session plugin**

`apps/api/test/session-plugin.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js'
import { requireAuth, requireRole } from '../src/plugins/session.js'

async function seedMember(
  db: Parameters<Parameters<typeof buildTestApp>[0]>[1]['db'],
  email: string,
  role: 'admin' | 'player',
  withProfile = true,
) {
  const m = await db
    .insertInto('members')
    .values({ email, role, status: 'active' })
    .returning(['id'])
    .executeTakeFirstOrThrow()
  if (withProfile) {
    await db.insertInto('player_profiles').values({ member_id: m.id, display_name: email }).execute()
  }
  return m.id
}

describe('session plugin', () => {
  it('rejects a request with no cookie', async () => {
    await buildTestApp(async (app) => {
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret' })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } })
    })
  })

  it('rejects a forged cookie', async () => {
    await buildTestApp(async (app) => {
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({
        method: 'GET',
        url: '/api/secret',
        cookies: { [SESSION_COOKIE]: 'not-a-real-token' },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  it('resolves a valid session onto request.member', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'player@example.com', 'player')
      const token = await createSession(
        { db: ctx.db, now: () => ctx.clock.now },
        id,
        'vitest',
      )
      app.get('/api/whoami', { preHandler: requireAuth }, (req) => req.member)

      const res = await app.inject({
        method: 'GET',
        url: '/api/whoami',
        cookies: { [SESSION_COOKIE]: token },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id, role: 'player', hasProfile: true })
    })
  })

  it('rejects an expired session', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'stale@example.com', 'player')
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, id, 'vitest')
      ctx.clock.now = new Date('2026-12-01T10:00:00Z') // more than 30 days later
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(res.statusCode).toBe(401)
    })
  })

  it('rejects a session whose member has been removed', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'gone@example.com', 'player')
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, id, 'vitest')
      await ctx.db.updateTable('members').set({ status: 'removed' }).where('id', '=', id).execute()
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(res.statusCode).toBe(401)
    })
  })

  it('refuses a player on an admin-only route and allows an admin', async () => {
    await buildTestApp(async (app, ctx) => {
      const playerId = await seedMember(ctx.db, 'p@example.com', 'player')
      const adminId = await seedMember(ctx.db, 'a@example.com', 'admin')
      const clock = { db: ctx.db, now: () => ctx.clock.now }
      const playerToken = await createSession(clock, playerId, 'vitest')
      const adminToken = await createSession(clock, adminId, 'vitest')

      app.get('/api/admin-only', { preHandler: requireRole('admin') }, () => ({ ok: true }))

      const denied = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        cookies: { [SESSION_COOKIE]: playerToken },
      })
      expect(denied.statusCode).toBe(403)
      expect(denied.json()).toMatchObject({ error: { code: 'forbidden' } })

      const allowed = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        cookies: { [SESSION_COOKIE]: adminToken },
      })
      expect(allowed.statusCode).toBe(200)
    })
  })

  it('reports hasProfile false for a member who has not completed setup', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'new@example.com', 'player', false)
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, id, 'vitest')
      app.get('/api/whoami', { preHandler: requireAuth }, (req) => req.member)
      const res = await app.inject({ method: 'GET', url: '/api/whoami', cookies: { [SESSION_COOKIE]: token } })
      expect(res.json()).toMatchObject({ hasProfile: false })
    })
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- session-plugin`
Expected: FAIL — `Cannot find module '../src/auth/sessions.js'`.

- [ ] **Step 7: Implement sessions**

`apps/api/src/auth/sessions.ts`:

```ts
import type { Kysely } from 'kysely'
import type { Database } from '../db/schema.js'
import { hashToken, newToken } from './tokens.js'

export const SESSION_COOKIE = 'tt_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionMember {
  id: number
  email: string
  role: 'admin' | 'player'
  hasProfile: boolean
}

/** Minimal slice of Deps these functions need, so tests can pass a bare object. */
export interface SessionDeps {
  db: Kysely<Database>
  now: () => Date
}

export async function createSession(
  deps: SessionDeps,
  memberId: number,
  userAgent: string | undefined,
): Promise<string> {
  const { token, hash } = newToken()
  await deps.db
    .insertInto('sessions')
    .values({
      member_id: memberId,
      token_hash: hash,
      expires_at: new Date(deps.now().getTime() + SESSION_TTL_MS),
      user_agent: userAgent?.slice(0, 255) ?? null,
    })
    .execute()
  return token
}

export async function resolveSession(deps: SessionDeps, token: string): Promise<SessionMember | null> {
  const now = deps.now()
  const row = await deps.db
    .selectFrom('sessions as s')
    .innerJoin('members as m', 'm.id', 's.member_id')
    .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
    .select([
      's.id as session_id',
      'm.id as id',
      'm.email as email',
      'm.role as role',
      'm.status as status',
      'p.member_id as profile_id',
    ])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    .executeTakeFirst()

  if (!row || row.status !== 'active') return null

  // Sliding expiry: every use pushes the window out, capped at SESSION_TTL_MS.
  await deps.db
    .updateTable('sessions')
    .set({ last_used_at: now, expires_at: new Date(now.getTime() + SESSION_TTL_MS) })
    .where('id', '=', row.session_id)
    .execute()
  await deps.db.updateTable('members').set({ last_seen_at: now }).where('id', '=', row.id).execute()

  return { id: row.id, email: row.email, role: row.role, hasProfile: row.profile_id !== null }
}

export async function revokeSession(deps: SessionDeps, token: string): Promise<void> {
  await deps.db.deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute()
}

export async function revokeAllForMember(deps: SessionDeps, memberId: number): Promise<void> {
  await deps.db.deleteFrom('sessions').where('member_id', '=', memberId).execute()
}
```

- [ ] **Step 8: Implement the session plugin**

`apps/api/src/plugins/session.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import { forbidden, unauthorized } from './error-handler.js'
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS, type SessionMember } from '../auth/sessions.js'
import type { Deps } from '../app.js'

declare module 'fastify' {
  interface FastifyRequest {
    member: SessionMember
  }
  interface FastifyInstance {
    deps: Deps
  }
}

export async function requireAuth(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) throw unauthorized()
  const member = await resolveSession(req.server.deps, token)
  if (!member) throw unauthorized()
  req.member = member
}

export function requireRole(role: 'admin') {
  return async function (req: FastifyRequest): Promise<void> {
    await requireAuth(req)
    if (req.member.role !== role) throw forbidden()
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
```

`requireRole` calls `requireAuth` itself rather than being chained after it, so a route can never accidentally declare the role check without the auth check.

- [ ] **Step 9: Expose `deps` on the instance**

In `apps/api/src/app.ts`, immediately after creating `app`:

```ts
app.decorate('deps', deps)
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api`
Expected: PASS — schema 5, app 6, tokens 4, session-plugin 7.

- [ ] **Step 11: Implement the mailer**

`apps/api/src/auth/mailer.ts`:

```ts
import type { Mailer } from '../app.js'
import type { Config } from '../config.js'

const SUBJECTS = {
  invite: 'You have been added to the tennis team',
  signin: 'Your sign-in link',
} as const

function body(url: string, kind: 'invite' | 'signin'): string {
  const lead =
    kind === 'invite'
      ? 'You have been added to the team. Use the link below to set up your profile.'
      : 'Use the link below to sign in.'
  return `${lead}\n\n${url}\n\nThis link works once and expires in 15 minutes.`
}

class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject: SUBJECTS[kind], text: body(url, kind) }),
    })
    if (!res.ok) {
      // Deliberately does not include `to`: the address must not reach the logs.
      throw new Error(`Mail send failed with status ${res.status}`)
    }
  }
}

class ConsoleMailer implements Mailer {
  async sendSignInLink(_to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    // Local development only. Prints the link so you can sign in without a mail provider.
    console.log(`[mail:${kind}] ${url}`)
  }
}

export function createMailer(config: Config): Mailer {
  if (config.mail.apiKey) return new ResendMailer(config.mail.apiKey, config.mail.from)
  if (config.nodeEnv === 'production') {
    throw new Error('RESEND_API_KEY is required in production; sign-in would be impossible without it')
  }
  return new ConsoleMailer()
}
```

The production guard matters: without it, a missing key in production silently downgrades to logging links to stdout, and every sign-in appears to work while nobody receives mail.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add token core, revocable sessions, mailer port, and session plugin"
git push
```

---

### Task 5: Auth routes — request link, callback, logout, me

**Files:**
- Create: `packages/contracts/src/auth.ts`, `apps/api/src/routes/auth.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: `newToken`, `hashToken`, `TOKEN_TTL_MS`, `createSession`, `revokeSession`, `SESSION_COOKIE`, `setSessionCookie`, `clearSessionCookie`, `requireAuth`.
- Produces: contracts `RequestLinkBody = { email: string }`, `MeResponse = { id, email, role, hasProfile }`; routes `POST /api/auth/request-link`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/auth/me`.

- [ ] **Step 1: Write the contracts**

`packages/contracts/src/auth.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

export const Email = Type.String({ format: 'email', minLength: 3, maxLength: 254 })

export const RequestLinkBody = Type.Object({ email: Email }, { additionalProperties: false })
export type RequestLinkBody = Static<typeof RequestLinkBody>

export const CallbackQuery = Type.Object({ token: Type.String({ minLength: 20, maxLength: 200 }) })
export type CallbackQuery = Static<typeof CallbackQuery>

export const MeResponse = Type.Object({
  id: Id,
  email: Email,
  role: Type.Union([Type.Literal('admin'), Type.Literal('player')]),
  hasProfile: Type.Boolean(),
})
export type MeResponse = Static<typeof MeResponse>
```

Add `export * from './auth.js'` to `packages/contracts/src/index.ts`.

Fastify's `format: 'email'` needs the ajv formats package: `npm install --workspace @tennis/api ajv-formats`, then in `buildApp`:

```ts
import addFormats from 'ajv-formats'
// inside Fastify({ ... })
ajv: { plugins: [addFormats] },
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/auth-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'
import { SESSION_COOKIE } from '../src/auth/sessions.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('auth routes', () => {
  it('emails a link to a known member', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'known@example.com', status: 'active' }).execute()
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'known@example.com' },
      })
      expect(res.statusCode).toBe(202)
      expect(ctx.mailer.last?.to).toBe('known@example.com')
      expect(ctx.mailer.last?.url).toContain('/api/auth/callback?token=')
    })
  })

  it('answers identically for an unknown address and sends nothing', async () => {
    await buildTestApp(async (app, ctx) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'stranger@example.com' },
      })
      expect(res.statusCode).toBe(202)
      expect(res.json()).toEqual({ status: 'sent' })
      expect(ctx.mailer.sent).toHaveLength(0)
    })
  })

  it('sends nothing to a removed member', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'ex@example.com', status: 'removed' }).execute()
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'ex@example.com' },
      })
      expect(res.statusCode).toBe(202)
      expect(ctx.mailer.sent).toHaveLength(0)
    })
  })

  it('matches the address case-insensitively', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'Mixed.Case@Example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'mixed.case@example.com' },
      })
      expect(ctx.mailer.sent).toHaveLength(1)
    })
  })

  it('signs in an invited member, activates them, and redirects to setup', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'new@example.com', status: 'invited' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'new@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!

      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/setup')
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.httpOnly).toBe(true)

      const member = await ctx.db
        .selectFrom('members')
        .select('status')
        .where('email', '=', 'new@example.com')
        .executeTakeFirstOrThrow()
      expect(member.status).toBe('active')
    })
  })

  it('redirects an existing member with a profile to the roster', async () => {
    await buildTestApp(async (app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'old@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()
      await ctx.db.insertInto('player_profiles').values({ member_id: m.id, display_name: 'Old' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'old@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.headers.location).toBe('/')
    })
  })

  it('refuses to reuse a consumed token', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'once@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'once@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!

      const first = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(first.statusCode).toBe(302)
      const second = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(second.statusCode).toBe(302)
      expect(second.headers.location).toBe('/login?error=link_invalid')
    })
  })

  it('refuses an expired token', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'slow@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'slow@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      ctx.clock.now = new Date('2026-08-21T10:16:00Z') // 16 minutes later

      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.headers.location).toBe('/login?error=link_invalid')
    })
  })

  it('returns the current member and clears the session on logout', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'me@example.com', status: 'active', role: 'admin' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'me@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const cb = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: session } })
      expect(me.json()).toMatchObject({ email: 'me@example.com', role: 'admin', hasProfile: false })

      const out = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: ORIGIN,
        cookies: { [SESSION_COOKIE]: session },
      })
      expect(out.statusCode).toBe(204)

      const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: session } })
      expect(after.statusCode).toBe(401)
    })
  })

  it('requires authentication for me', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
      expect(res.statusCode).toBe(401)
    })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- auth-routes`
Expected: FAIL — every case 404s, because the routes are not registered yet.

- [ ] **Step 4: Implement the routes**

`apps/api/src/routes/auth.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { CallbackQuery, MeResponse, RequestLinkBody } from '@tennis/contracts'
import type { Deps } from '../app.js'
import { hashToken, newToken, TOKEN_TTL_MS } from '../auth/tokens.js'
import { createSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.js'
import { clearSessionCookie, requireAuth, setSessionCookie } from '../plugins/session.js'

const INVALID = '/login?error=link_invalid'

export async function authRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const secureCookies = deps.config.appOrigin.startsWith('https://')

  app.post(
    '/api/auth/request-link',
    {
      schema: { body: RequestLinkBody },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          // Keyed on address AND caller, so neither one alone can flood a mailbox.
          keyGenerator: (req) => `${req.ip}:${(req.body as RequestLinkBody).email.toLowerCase()}`,
        },
      },
    },
    async (req, reply) => {
      const { email } = req.body as RequestLinkBody

      const member = await deps.db
        .selectFrom('members')
        .select(['id', 'email', 'status'])
        .where('email', '=', email)
        .where('status', 'in', ['invited', 'active'])
        .executeTakeFirst()

      // Identical response whether or not the address is on the team.
      if (member) {
        const { token, hash } = newToken()
        await deps.db
          .insertInto('login_tokens')
          .values({
            member_id: member.id,
            token_hash: hash,
            expires_at: new Date(deps.now().getTime() + TOKEN_TTL_MS),
          })
          .execute()
        const url = `${deps.config.appOrigin}/api/auth/callback?token=${token}`
        await deps.mailer.sendSignInLink(member.email, url, member.status === 'invited' ? 'invite' : 'signin')
        req.log.info({ memberId: member.id }, 'sign-in link sent')
      }

      return reply.code(202).send({ status: 'sent' })
    },
  )

  app.get('/api/auth/callback', { schema: { querystring: CallbackQuery } }, async (req, reply) => {
    const { token } = req.query as CallbackQuery
    const now = deps.now()

    const row = await deps.db
      .selectFrom('login_tokens as t')
      .innerJoin('members as m', 'm.id', 't.member_id')
      .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
      .select(['t.id as token_id', 'm.id as member_id', 'm.status as status', 'p.member_id as profile_id'])
      .where('t.token_hash', '=', hashToken(token))
      .where('t.consumed_at', 'is', null)
      .where('t.expires_at', '>', now)
      .executeTakeFirst()

    if (!row || row.status === 'removed') return reply.redirect(INVALID, 302)

    await deps.db.updateTable('login_tokens').set({ consumed_at: now }).where('id', '=', row.token_id).execute()
    if (row.status === 'invited') {
      await deps.db.updateTable('members').set({ status: 'active' }).where('id', '=', row.member_id).execute()
    }

    const session = await createSession(deps, row.member_id, req.headers['user-agent'])
    setSessionCookie(reply, session, secureCookies)
    req.log.info({ memberId: row.member_id }, 'sign-in completed')

    return reply.redirect(row.profile_id === null ? '/setup' : '/', 302)
  })

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) await revokeSession(deps, token)
    clearSessionCookie(reply)
    return reply.code(204).send()
  })

  app.get(
    '/api/auth/me',
    { preHandler: requireAuth, schema: { response: { 200: MeResponse } } },
    async (req) => req.member,
  )
}
```

- [ ] **Step 5: Register the routes**

In `buildApp`, after the health routes:

```ts
await app.register(authRoutes, deps)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api`
Expected: PASS — 11 new auth-route tests, all previous tests still green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add magic-link auth routes with no address enumeration"
git push
```

---

### Task 6: First-admin bootstrap and the release command

Closes the chicken-and-egg hole: with an empty `members` table there is no way in through the UI.

**Files:**
- Create: `apps/api/src/db/bootstrap.ts`, `apps/api/src/release.ts`
- Modify: `apps/api/package.json` (`release` script)
- Test: `apps/api/test/bootstrap.test.ts`

**Interfaces:**
- Produces: `bootstrapAdmin(db, email: string | undefined): Promise<'created' | 'skipped' | 'no-email'>` from `src/db/bootstrap.ts`; `npm run release --workspace @tennis/api` running migrations then bootstrap.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bootstrap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { withTx } from './setup/harness.js'
import { bootstrapAdmin } from '../src/db/bootstrap.js'

describe('bootstrapAdmin', () => {
  it('creates the first admin as active', async () => {
    await withTx(async (db) => {
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('created')
      const row = await db
        .selectFrom('members')
        .select(['role', 'status'])
        .where('email', '=', 'boss@example.com')
        .executeTakeFirstOrThrow()
      expect(row).toMatchObject({ role: 'admin', status: 'active' })
    })
  })

  it('is idempotent when an admin already exists', async () => {
    await withTx(async (db) => {
      await bootstrapAdmin(db, 'boss@example.com')
      expect(await bootstrapAdmin(db, 'someone.else@example.com')).toBe('skipped')
      const count = await db
        .selectFrom('members')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
      expect(count.n).toBe(1)
    })
  })

  it('promotes an existing invited member rather than duplicating the address', async () => {
    await withTx(async (db) => {
      await db.insertInto('members').values({ email: 'boss@example.com', status: 'invited' }).execute()
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('created')
      const rows = await db.selectFrom('members').select(['role', 'status']).execute()
      expect(rows).toEqual([{ role: 'admin', status: 'active' }])
    })
  })

  it('does nothing when no bootstrap address is configured', async () => {
    await withTx(async (db) => {
      expect(await bootstrapAdmin(db, undefined)).toBe('no-email')
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- bootstrap`
Expected: FAIL — `Cannot find module '../src/db/bootstrap.js'`.

- [ ] **Step 3: Implement bootstrap**

`apps/api/src/db/bootstrap.ts`:

```ts
import type { Kysely } from 'kysely'
import type { Database } from './schema.js'

/**
 * Invite-only auth cannot bootstrap itself: with no members, nobody can invite
 * anybody. Idempotent, so it is safe on every deploy.
 */
export async function bootstrapAdmin(
  db: Kysely<Database>,
  email: string | undefined,
): Promise<'created' | 'skipped' | 'no-email'> {
  if (!email) return 'no-email'

  const existingAdmin = await db
    .selectFrom('members')
    .select('id')
    .where('role', '=', 'admin')
    .where('status', '<>', 'removed')
    .executeTakeFirst()
  if (existingAdmin) return 'skipped'

  await db
    .insertInto('members')
    .values({ email, role: 'admin', status: 'active' })
    .onConflict((oc) => oc.column('email').doUpdateSet({ role: 'admin', status: 'active' }))
    .execute()
  return 'created'
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test --workspace @tennis/api -- bootstrap`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the release command**

`apps/api/src/release.ts`:

```ts
import { loadConfig } from './config.js'
import { createDb, createPool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { bootstrapAdmin } from './db/bootstrap.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl)
const db = createDb(pool)

try {
  const applied = await runMigrations(db)
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No migrations to apply')
  const result = await bootstrapAdmin(db, config.bootstrapAdminEmail)
  console.log(`Admin bootstrap: ${result}`)
} finally {
  await db.destroy()
}
```

Add to `apps/api/package.json` scripts: `"release": "node dist/release.js"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add idempotent first-admin bootstrap and release command"
git push
```

---

### Task 7: Members routes and the last-admin guard

**Files:**
- Create: `packages/contracts/src/member.ts`, `apps/api/src/routes/members.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/members-routes.test.ts`

**Interfaces:**
- Produces: contracts `MemberRole`, `MemberStatus`, `RosterEntry`, `InviteBody = { email }`, `PatchMemberBody = { role }`; routes `GET /api/members`, `POST /api/members`, `PATCH /api/members/:id`, `DELETE /api/members/:id`, `POST /api/members/:id/resend-invite`. Also exports `assertAdminRemains(db, memberId, nextRole, nextStatus): Promise<void>` from `src/routes/members.ts` for reuse in tests.

- [ ] **Step 1: Write the contracts**

`packages/contracts/src/member.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'
import { Email } from './auth.js'
import { Id } from './common.js'

export const MemberRole = Type.Union([Type.Literal('admin'), Type.Literal('player')])
export const MemberStatus = Type.Union([
  Type.Literal('invited'),
  Type.Literal('active'),
  Type.Literal('removed'),
])

export const RosterEntry = Type.Object({
  id: Id,
  email: Email,
  role: MemberRole,
  status: MemberStatus,
  displayName: Type.Union([Type.String(), Type.Null()]),
  nickname: Type.Union([Type.String(), Type.Null()]),
  photoUrl: Type.Union([Type.String(), Type.Null()]),
  preferredFormat: Type.Union([Type.String(), Type.Null()]),
  ratingSystem: Type.String(),
  ratingValue: Type.Union([Type.String(), Type.Null()]),
})
export type RosterEntry = Static<typeof RosterEntry>

export const Roster = Type.Array(RosterEntry)

export const InviteBody = Type.Object({ email: Email }, { additionalProperties: false })
export type InviteBody = Static<typeof InviteBody>

export const PatchMemberBody = Type.Object({ role: MemberRole }, { additionalProperties: false })
export type PatchMemberBody = Static<typeof PatchMemberBody>

export const MemberIdParams = Type.Object({ id: Id })
export type MemberIdParams = Static<typeof MemberIdParams>
```

Add `export * from './member.js'` to the barrel.

- [ ] **Step 2: Write the failing test**

`apps/api/test/members-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('members routes', () => {
  it('lists invited and active members but not removed ones', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await signIn(app, ctx, { email: 'invited@example.com', status: 'invited', profile: false })
      await signIn(app, ctx, { email: 'gone@example.com', status: 'removed', profile: false })

      const res = await app.inject({ method: 'GET', url: '/api/members', cookies: admin.cookies })
      expect(res.statusCode).toBe(200)
      const emails = res.json().map((m: { email: string }) => m.email)
      expect(emails).toContain('admin@example.com')
      expect(emails).toContain('invited@example.com')
      expect(emails).not.toContain('gone@example.com')
    })
  })

  it('requires a session to read the roster', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/members' })).statusCode).toBe(401)
    })
  })

  it('lets an admin invite a teammate and emails them', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'newbie@example.com' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ email: 'newbie@example.com', status: 'invited', role: 'player' })
      expect(ctx.mailer.last).toMatchObject({ to: 'newbie@example.com', kind: 'invite' })
    })
  })

  it('refuses an invite from a player', async () => {
    await buildTestApp(async (app, ctx) => {
      const player = await signIn(app, ctx, { email: 'player@example.com', role: 'player' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: player.cookies,
        payload: { email: 'newbie@example.com' },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  it('reinstates a removed member instead of failing on the unique address', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await ctx.db.insertInto('members').values({ email: 'back@example.com', status: 'removed' }).execute()

      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'back@example.com' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ status: 'invited' })
    })
  })

  it('refuses to remove the last active admin', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'only@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/members/${admin.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: 'last_admin' } })
    })
  })

  it('refuses to demote the last active admin', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'only@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/members/${admin.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { role: 'player' },
      })
      expect(res.statusCode).toBe(409)
    })
  })

  it('allows demoting one admin while another remains', async () => {
    await buildTestApp(async (app, ctx) => {
      const a = await signIn(app, ctx, { email: 'a@example.com', role: 'admin' })
      const b = await signIn(app, ctx, { email: 'b@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/members/${b.id}`,
        headers: ORIGIN,
        cookies: a.cookies,
        payload: { role: 'player' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ role: 'player' })
    })
  })

  it('removes a member, revokes their sessions, and hides their profile', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const victim = await signIn(app, ctx, { email: 'victim@example.com', role: 'player' })

      // Their session works before removal.
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: victim.cookies })).statusCode).toBe(200)

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/members/${victim.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(res.statusCode).toBe(204)

      // Removal takes effect immediately, not at token expiry.
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: victim.cookies })).statusCode).toBe(401)

      const profile = await app.inject({
        method: 'GET',
        url: `/api/players/${victim.id}`,
        cookies: admin.cookies,
      })
      expect(profile.statusCode).toBe(404)
    })
  })

  it('resends an invitation', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const pending = await ctx.db
        .insertInto('members')
        .values({ email: 'pending@example.com', status: 'invited' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const res = await app.inject({
        method: 'POST',
        url: `/api/members/${pending.id}/resend-invite`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(res.statusCode).toBe(202)
      expect(ctx.mailer.last).toMatchObject({ to: 'pending@example.com', kind: 'invite' })
    })
  })
})
```

- [ ] **Step 3: Add the `signIn` helper to the harness**

Append to `apps/api/test/setup/harness.ts`:

```ts
export interface SignedIn {
  id: number
  email: string
  cookies: Record<string, string>
}

/**
 * Seeds a member and returns cookies for an authenticated session, so route
 * tests do not each re-run the magic-link dance.
 */
export async function signIn(
  app: FastifyInstance,
  ctx: TestCtx,
  opts: {
    email: string
    role?: 'admin' | 'player'
    status?: 'invited' | 'active' | 'removed'
    profile?: boolean
  },
): Promise<SignedIn> {
  const { email, role = 'player', status = 'active', profile = true } = opts
  const m = await ctx.db
    .insertInto('members')
    .values({ email, role, status })
    .returning('id')
    .executeTakeFirstOrThrow()
  if (profile) {
    await ctx.db
      .insertInto('player_profiles')
      .values({ member_id: m.id, display_name: email.split('@')[0]! })
      .execute()
  }
  const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, m.id, 'vitest')
  return { id: m.id, email, cookies: { [SESSION_COOKIE]: token } }
}
```

Import `createSession` and `SESSION_COOKIE` at the top of the harness.

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- members-routes`
Expected: FAIL — routes 404.

- [ ] **Step 5: Implement the routes**

`apps/api/src/routes/members.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import { InviteBody, MemberIdParams, PatchMemberBody, Roster, RosterEntry } from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { Database } from '../db/schema.js'
import { conflict, notFound } from '../plugins/error-handler.js'
import { requireAuth, requireRole } from '../plugins/session.js'
import { newToken, TOKEN_TTL_MS } from '../auth/tokens.js'
import { revokeAllForMember } from '../auth/sessions.js'

/**
 * Refuses any change that would leave the team with no active admin. Without
 * this, one click can lock every member out of their own roster.
 */
export async function assertAdminRemains(
  db: Kysely<Database>,
  memberId: number,
  next: { role?: 'admin' | 'player'; status?: 'invited' | 'active' | 'removed' },
): Promise<void> {
  const stillAdmin = next.role === undefined ? undefined : next.role === 'admin'
  const stillActive = next.status === undefined ? undefined : next.status !== 'removed'
  if (stillAdmin !== false && stillActive !== false) return

  const others = await db
    .selectFrom('members')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('role', '=', 'admin')
    .where('status', '<>', 'removed')
    .where('id', '<>', memberId)
    .executeTakeFirstOrThrow()

  if (others.n === 0) {
    throw conflict('The team must keep at least one active admin', 'last_admin')
  }
}

async function sendInvite(deps: Deps, memberId: number, email: string): Promise<void> {
  const { token, hash } = newToken()
  await deps.db
    .insertInto('login_tokens')
    .values({
      member_id: memberId,
      token_hash: hash,
      expires_at: new Date(deps.now().getTime() + TOKEN_TTL_MS),
    })
    .execute()
  await deps.mailer.sendSignInLink(email, `${deps.config.appOrigin}/api/auth/callback?token=${token}`, 'invite')
}

export async function memberRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(
    '/api/members',
    { preHandler: requireAuth, schema: { response: { 200: Roster } } },
    async () => {
      const rows = await deps.db
        .selectFrom('members as m')
        .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
        .select([
          'm.id',
          'm.email',
          'm.role',
          'm.status',
          'p.display_name',
          'p.nickname',
          'p.photo_key',
          'p.preferred_format',
          'p.rating_system',
          'p.rating_value',
        ])
        .where('m.status', 'in', ['invited', 'active'])
        .orderBy('p.display_name', 'asc')
        .orderBy('m.email', 'asc')
        .execute()

      return rows.map(
        (r): RosterEntry => ({
          id: r.id,
          email: r.email,
          role: r.role,
          status: r.status,
          displayName: r.display_name ?? null,
          nickname: r.nickname ?? null,
          photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
          preferredFormat: r.preferred_format ?? null,
          ratingSystem: r.rating_system ?? 'none',
          ratingValue: r.rating_value ?? null,
        }),
      )
    },
  )

  app.post(
    '/api/members',
    { preHandler: requireRole('admin'), schema: { body: InviteBody } },
    async (req, reply) => {
      const { email } = req.body as InviteBody

      // An address may already exist as a removed member; reinstate rather than fail.
      const member = await deps.db
        .insertInto('members')
        .values({ email, role: 'player', status: 'invited' })
        .onConflict((oc) => oc.column('email').doUpdateSet({ status: 'invited' }))
        .returning(['id', 'email', 'role', 'status'])
        .executeTakeFirstOrThrow()

      await sendInvite(deps, member.id, member.email)
      req.log.info({ memberId: member.id, by: req.member.id }, 'member invited')
      return reply.code(201).send(member)
    },
  )

  app.patch(
    '/api/members/:id',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams, body: PatchMemberBody } },
    async (req) => {
      const { id } = req.params as MemberIdParams
      const { role } = req.body as PatchMemberBody
      await assertAdminRemains(deps.db, id, { role })

      const updated = await deps.db
        .updateTable('members')
        .set({ role })
        .where('id', '=', id)
        .where('status', '<>', 'removed')
        .returning(['id', 'email', 'role', 'status'])
        .executeTakeFirst()
      if (!updated) throw notFound('No such member')
      req.log.info({ memberId: id, by: req.member.id, role }, 'member role changed')
      return updated
    },
  )

  app.delete(
    '/api/members/:id',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams } },
    async (req, reply) => {
      const { id } = req.params as MemberIdParams
      await assertAdminRemains(deps.db, id, { status: 'removed' })

      const removed = await deps.db
        .updateTable('members')
        .set({ status: 'removed' })
        .where('id', '=', id)
        .where('status', '<>', 'removed')
        .returning('id')
        .executeTakeFirst()
      if (!removed) throw notFound('No such member')

      await revokeAllForMember(deps, id)
      req.log.info({ memberId: id, by: req.member.id }, 'member removed')
      return reply.code(204).send()
    },
  )

  app.post(
    '/api/members/:id/resend-invite',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams } },
    async (req, reply) => {
      const { id } = req.params as MemberIdParams
      const member = await deps.db
        .selectFrom('members')
        .select(['id', 'email'])
        .where('id', '=', id)
        .where('status', '=', 'invited')
        .executeTakeFirst()
      if (!member) throw notFound('No pending invitation for that member')

      await sendInvite(deps, member.id, member.email)
      return reply.code(202).send({ status: 'sent' })
    },
  )
}
```

Register with `await app.register(memberRoutes, deps)` in `buildApp`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api`
Expected: PASS. The `GET /api/players/:id` assertion inside the removal test will still fail until Task 8 — comment that single expectation out with a `// enabled in Task 8` note, and re-enable it as Step 1 of Task 8.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add members routes with last-admin guard and immediate session revocation"
git push
```

---

### Task 8: Profile routes — read, setup, and patch

**Files:**
- Create: `packages/contracts/src/profile.ts`, `apps/api/src/routes/profiles.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts`, `apps/api/test/members-routes.test.ts` (re-enable the assertion deferred in Task 7)
- Test: `apps/api/test/profile-routes.test.ts`

**Interfaces:**
- Produces: contracts `PlayerProfile`, `ProfileBody` (used for both setup and patch), `PlayerDetail`; routes `GET /api/players/:id`, `PUT /api/players/me`, `PATCH /api/players/me`.

`PUT` creates-or-replaces (used by `/setup`), `PATCH` merges (used by `/me`). Both accept the same field set, which is why one `ProfileBody` schema serves both, with `PATCH` wrapping it in `Type.Partial`.

- [ ] **Step 1: Re-enable the deferred assertion**

Uncomment the `GET /api/players/:id` → `404` expectation in `members-routes.test.ts` and delete the `// enabled in Task 8` note. Run the suite and confirm it now fails for the right reason (404 handler for an unregistered route, not a wrong status).

- [ ] **Step 2: Write the contracts**

`packages/contracts/src/profile.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()])

export const DominantHand = Type.Union([Type.Literal('left'), Type.Literal('right')])
export const Backhand = Type.Union([Type.Literal('one'), Type.Literal('two')])
export const PreferredFormat = Type.Union([
  Type.Literal('singles'),
  Type.Literal('doubles'),
  Type.Literal('both'),
])
export const RatingSystem = Type.Union([
  Type.Literal('utr'),
  Type.Literal('ntrp'),
  Type.Literal('club'),
  Type.Literal('none'),
])

export const ProfileBody = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 60 }),
    nickname: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
    phone: Type.Optional(Nullable(Type.String({ maxLength: 32 }))),
    dominantHand: Type.Optional(Type.Union([DominantHand, Type.Null()])),
    backhand: Type.Optional(Type.Union([Backhand, Type.Null()])),
    preferredFormat: Type.Optional(Type.Union([PreferredFormat, Type.Null()])),
    ratingSystem: Type.Optional(RatingSystem),
    ratingValue: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
    racquet: Type.Optional(Nullable(Type.String({ maxLength: 80 }))),
    bio: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  },
  { additionalProperties: false },
)
export type ProfileBody = Static<typeof ProfileBody>

export const PatchProfileBody = Type.Partial(ProfileBody)
export type PatchProfileBody = Static<typeof PatchProfileBody>

export const PlayerDetail = Type.Object({
  id: Id,
  role: Type.Union([Type.Literal('admin'), Type.Literal('player')]),
  displayName: Type.String(),
  nickname: Nullable(Type.String()),
  phone: Nullable(Type.String()),
  photoUrl: Nullable(Type.String()),
  dominantHand: Type.Union([DominantHand, Type.Null()]),
  backhand: Type.Union([Backhand, Type.Null()]),
  preferredFormat: Type.Union([PreferredFormat, Type.Null()]),
  ratingSystem: RatingSystem,
  ratingValue: Nullable(Type.String()),
  racquet: Nullable(Type.String()),
  bio: Nullable(Type.String()),
  record: Type.Object({
    matchesPlayed: Type.Integer(),
    wins: Type.Integer(),
    losses: Type.Integer(),
  }),
})
export type PlayerDetail = Static<typeof PlayerDetail>
```

Add `export * from './profile.js'` to the barrel.

- [ ] **Step 3: Write the failing test**

`apps/api/test/profile-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('profile routes', () => {
  it('creates a profile on setup and reports hasProfile afterwards', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'fresh@example.com', profile: false })

      const before = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: me.cookies })
      expect(before.json()).toMatchObject({ hasProfile: false })

      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Fresh Legs', dominantHand: 'left', backhand: 'two', ratingSystem: 'ntrp', ratingValue: '4.0' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ displayName: 'Fresh Legs', dominantHand: 'left', ratingValue: '4.0' })

      const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: me.cookies })
      expect(after.json()).toMatchObject({ hasProfile: true })
    })
  })

  it('rejects a rating value when the system is none', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'bad@example.com', profile: false })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Bad', ratingSystem: 'none', ratingValue: '4.0' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: { code: 'bad_request' } })
    })
  })

  it('rejects a blank display name', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'blank@example.com', profile: false })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: '   ' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('merges a patch without clearing untouched fields', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'merge@example.com', profile: false })
      await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Merger', racquet: 'Pure Aero' },
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { bio: 'Loves a long rally.' },
      })
      expect(res.json()).toMatchObject({ displayName: 'Merger', racquet: 'Pure Aero', bio: 'Loves a long rally.' })
    })
  })

  it('clears a field when the patch sends null explicitly', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'clear@example.com', profile: false })
      await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Clearer', racquet: 'Old Wilson' },
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { racquet: null },
      })
      expect(res.json().racquet).toBeNull()
    })
  })

  it('returns another player with their record attached', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'viewer@example.com' })
      const them = await signIn(app, ctx, { email: 'subject@example.com' })

      const res = await app.inject({ method: 'GET', url: `/api/players/${them.id}`, cookies: me.cookies })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: them.id, record: { matchesPlayed: 0, wins: 0, losses: 0 } })
    })
  })

  it('404s for a member who has not set up a profile', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'viewer@example.com' })
      const pending = await signIn(app, ctx, { email: 'pending@example.com', status: 'invited', profile: false })
      const res = await app.inject({ method: 'GET', url: `/api/players/${pending.id}`, cookies: me.cookies })
      expect(res.statusCode).toBe(404)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/players/1' })).statusCode).toBe(401)
      expect(
        (await app.inject({ method: 'PUT', url: '/api/players/me', headers: ORIGIN, payload: { displayName: 'X' } }))
          .statusCode,
      ).toBe(401)
    })
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- profile-routes`
Expected: FAIL — routes 404.

- [ ] **Step 5: Implement the routes**

`apps/api/src/routes/profiles.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { MemberIdParams, PatchProfileBody, PlayerDetail, ProfileBody } from '@tennis/contracts'
import type { Deps } from '../app.js'
import { badRequest, notFound } from '../plugins/error-handler.js'
import { requireAuth } from '../plugins/session.js'

type Row = {
  id: number
  role: 'admin' | 'player'
  display_name: string
  nickname: string | null
  phone: string | null
  photo_key: string | null
  dominant_hand: 'left' | 'right' | null
  backhand: 'one' | 'two' | null
  preferred_format: 'singles' | 'doubles' | 'both' | null
  rating_system: 'utr' | 'ntrp' | 'club' | 'none'
  rating_value: string | null
  racquet: string | null
  bio: string | null
  matches_played: number
  wins: number
  losses: number
}

function toDetail(deps: Deps, r: Row): PlayerDetail {
  return {
    id: r.id,
    role: r.role,
    displayName: r.display_name,
    nickname: r.nickname,
    phone: r.phone,
    photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
    dominantHand: r.dominant_hand,
    backhand: r.backhand,
    preferredFormat: r.preferred_format,
    ratingSystem: r.rating_system,
    ratingValue: r.rating_value,
    racquet: r.racquet,
    bio: r.bio,
    record: { matchesPlayed: r.matches_played, wins: r.wins, losses: r.losses },
  }
}

async function loadDetail(deps: Deps, memberId: number): Promise<PlayerDetail> {
  const row = await deps.db
    .selectFrom('members as m')
    .innerJoin('player_profiles as p', 'p.member_id', 'm.id')
    .innerJoin('player_records as r', 'r.member_id', 'm.id')
    .select([
      'm.id',
      'm.role',
      'p.display_name',
      'p.nickname',
      'p.phone',
      'p.photo_key',
      'p.dominant_hand',
      'p.backhand',
      'p.preferred_format',
      'p.rating_system',
      'p.rating_value',
      'p.racquet',
      'p.bio',
      'r.matches_played',
      'r.wins',
      'r.losses',
    ])
    .where('m.id', '=', memberId)
    .where('m.status', '<>', 'removed')
    .executeTakeFirst()
  if (!row) throw notFound('No such player')
  return toDetail(deps, row as Row)
}

/** The DB enforces this too; checking here yields a 400 with a useful message. */
function assertRatingCoherent(ratingSystem: string | undefined, ratingValue: unknown): void {
  if (ratingSystem === 'none' && ratingValue != null) {
    throw badRequest('A rating value requires a rating system', {
      fields: [{ path: '/ratingValue', message: 'Choose a rating system, or leave the value blank' }],
    })
  }
}

const COLUMNS = {
  displayName: 'display_name',
  nickname: 'nickname',
  phone: 'phone',
  dominantHand: 'dominant_hand',
  backhand: 'backhand',
  preferredFormat: 'preferred_format',
  ratingSystem: 'rating_system',
  ratingValue: 'rating_value',
  racquet: 'racquet',
  bio: 'bio',
} as const

function toColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (key in body) out[column] = body[key]
  }
  return out
}

export async function profileRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(
    '/api/players/:id',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: PlayerDetail } } },
    async (req) => loadDetail(deps, (req.params as MemberIdParams).id),
  )

  app.put(
    '/api/players/me',
    { preHandler: requireAuth, schema: { body: ProfileBody, response: { 200: PlayerDetail } } },
    async (req) => {
      const body = req.body as ProfileBody
      if (body.displayName.trim().length === 0) {
        throw badRequest('A display name is required', {
          fields: [{ path: '/displayName', message: 'Enter the name your teammates know you by' }],
        })
      }
      assertRatingCoherent(body.ratingSystem, body.ratingValue)

      const values = { ...toColumns(body), display_name: body.displayName.trim() }
      await deps.db
        .insertInto('player_profiles')
        .values({ member_id: req.member.id, ...values } as never)
        .onConflict((oc) => oc.column('member_id').doUpdateSet({ ...values, updated_at: deps.now() } as never))
        .execute()

      return loadDetail(deps, req.member.id)
    },
  )

  app.patch(
    '/api/players/me',
    { preHandler: requireAuth, schema: { body: PatchProfileBody, response: { 200: PlayerDetail } } },
    async (req) => {
      const body = req.body as PatchProfileBody
      const existing = await deps.db
        .selectFrom('player_profiles')
        .select('rating_system')
        .where('member_id', '=', req.member.id)
        .executeTakeFirst()
      if (!existing) throw notFound('Set up your profile first')

      const effectiveSystem = body.ratingSystem ?? existing.rating_system
      assertRatingCoherent(effectiveSystem, 'ratingValue' in body ? body.ratingValue : undefined)

      const values = toColumns(body)
      if (Object.keys(values).length > 0) {
        await deps.db
          .updateTable('player_profiles')
          .set({ ...values, updated_at: deps.now() } as never)
          .where('member_id', '=', req.member.id)
          .execute()
      }
      return loadDetail(deps, req.member.id)
    },
  )
}
```

`toColumns` uses `key in body` rather than a truthiness check, which is what makes an explicit `null` clear a field while an absent key leaves it alone.

Register with `await app.register(profileRoutes, deps)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api`
Expected: PASS, including the re-enabled members-routes assertion.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add profile read, setup, and patch routes"
git push
```

---

### Task 9: Photo upload — presign, confirm, EXIF strip

**Files:**
- Create: `packages/contracts/src/photo.ts`, `apps/api/src/storage/object-store.ts`, `apps/api/src/storage/images.ts`
- Modify: `apps/api/src/routes/profiles.ts`, `apps/api/src/index.ts` (real store), `packages/contracts/src/index.ts`
- Test: `apps/api/test/photo-routes.test.ts`, `apps/api/test/images.test.ts`

**Interfaces:**
- Produces: contracts `PresignBody = { contentType }`, `PresignResponse = { uploadUrl, key, maxBytes }`, `ConfirmPhotoBody = { key }`; routes `POST /api/players/me/photo`, `PUT /api/players/me/photo/confirm`; `createObjectStore(config): ObjectStore`; `normalisePhoto(input: Buffer): Promise<Buffer>` from `src/storage/images.ts`.

- [ ] **Step 1: Add dependencies**

```bash
npm install --workspace @tennis/api sharp @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Write the contracts**

`packages/contracts/src/photo.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const PresignBody = Type.Object(
  {
    contentType: Type.Union([
      Type.Literal('image/jpeg'),
      Type.Literal('image/png'),
      Type.Literal('image/webp'),
    ]),
    sizeBytes: Type.Integer({ minimum: 1, maximum: PHOTO_MAX_BYTES }),
  },
  { additionalProperties: false },
)
export type PresignBody = Static<typeof PresignBody>

export const PresignResponse = Type.Object({
  uploadUrl: Type.String(),
  key: Type.String(),
  maxBytes: Type.Integer(),
})
export type PresignResponse = Static<typeof PresignResponse>

export const ConfirmPhotoBody = Type.Object(
  { key: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
)
export type ConfirmPhotoBody = Static<typeof ConfirmPhotoBody>
```

- [ ] **Step 3: Write the failing image test**

`apps/api/test/images.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalisePhoto, PHOTO_EDGE_PX } from '../src/storage/images.js'

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#c1440e' } })
    .withExif({ IFD0: { Copyright: 'test' }, GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } })
    .jpeg()
    .toBuffer()
}

describe('normalisePhoto', () => {
  it('strips every EXIF block including GPS', async () => {
    const out = await normalisePhoto(await jpegWithGps())
    const meta = await sharp(out).metadata()
    expect(meta.exif).toBeUndefined()
  })

  it('bounds the long edge and produces webp', async () => {
    const out = await normalisePhoto(await jpegWithGps())
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(PHOTO_EDGE_PX)
  })

  it('rejects a file that is not an image', async () => {
    await expect(normalisePhoto(Buffer.from('this is not an image'))).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run it to verify it fails, then implement**

Run: `npm test --workspace @tennis/api -- images` → FAIL (module missing).

`apps/api/src/storage/images.ts`:

```ts
import sharp from 'sharp'

export const PHOTO_EDGE_PX = 800

/**
 * Re-encodes an uploaded photo to a bounded webp with NO metadata. sharp drops
 * all EXIF unless `withMetadata()` is called, which is exactly what we want:
 * phone photos carry GPS coordinates and these are pictures of real people.
 */
export async function normalisePhoto(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'error' })
    .rotate() // apply the EXIF orientation before discarding it
    .resize({ width: PHOTO_EDGE_PX, height: PHOTO_EDGE_PX, fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toBuffer()
}
```

`.rotate()` before stripping matters: orientation lives in EXIF, so discarding metadata without applying it first turns every portrait phone photo sideways.

Run again → PASS, 3 tests.

- [ ] **Step 5: Implement the object store**

`apps/api/src/storage/object-store.ts`:

```ts
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectStore } from '../app.js'
import type { Config } from '../config.js'

class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    private readonly endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    })
  }

  async presignPut(key: string, contentType: string, maxBytes: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: maxBytes,
    })
    return getSignedUrl(this.client, cmd, { expiresIn: 300 })
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  publicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`
  }
}

export function createObjectStore(config: Config): ObjectStore {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = config.storage
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    return new S3ObjectStore(bucket, endpoint, accessKeyId, secretAccessKey)
  }
  if (config.nodeEnv === 'production') {
    throw new Error('Object storage is not configured; profile photo upload would fail in production')
  }
  return new UnconfiguredStore()
}

/** Local development without a bucket: fails loudly at the point of use, not at boot. */
class UnconfiguredStore implements ObjectStore {
  private fail(): never {
    throw new Error('Object storage is not configured. Set STORAGE_* variables to enable photo upload.')
  }
  async presignPut(): Promise<string> {
    this.fail()
  }
  async get(): Promise<Buffer> {
    this.fail()
  }
  async put(): Promise<void> {
    this.fail()
  }
  async delete(): Promise<void> {
    this.fail()
  }
  publicUrl(): string {
    this.fail()
  }
}
```

- [ ] **Step 6: Write the failing route test**

`apps/api/test/photo-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

const samplePhoto = () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: '#3f7d3f' } })
    .withExif({ GPS: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer()

describe('photo routes', () => {
  it('issues a presigned url for an allowed content type', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'shot@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/jpeg', sizeBytes: 120_000 },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.uploadUrl).toContain('signed=1')
      expect(body.key).toMatch(new RegExp(`^photos/${me.id}/upload-`))
      expect(body.maxBytes).toBe(5 * 1024 * 1024)
    })
  })

  it('rejects a disallowed content type', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'gif@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/gif', sizeBytes: 100 },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('rejects a file over the size cap', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'huge@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/jpeg', sizeBytes: 9_000_000 },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('normalises on confirm, stores the derived image, and deletes the upload', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'confirm@example.com' })
      const presign = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/jpeg', sizeBytes: 120_000 },
      })
      const { key } = presign.json()
      await ctx.storage.put(key, await samplePhoto(), 'image/jpeg')

      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/photo/confirm',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { key },
      })
      expect(res.statusCode).toBe(200)
      const finalKey = res.json().photoUrl.split('/').slice(-3).join('/')

      expect(ctx.storage.objects.has(key)).toBe(false) // raw upload cleaned up
      const stored = ctx.storage.objects.get(finalKey)!
      expect(stored.contentType).toBe('image/webp')
      expect((await sharp(stored.body).metadata()).exif).toBeUndefined()
    })
  })

  it('refuses to confirm a key belonging to another member', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'thief@example.com' })
      const other = await signIn(app, ctx, { email: 'target@example.com' })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/photo/confirm',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { key: `photos/${other.id}/upload-abc` },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        payload: { contentType: 'image/jpeg', sizeBytes: 100 },
      })
      expect(res.statusCode).toBe(401)
    })
  })
})
```

- [ ] **Step 7: Implement the photo routes**

Append to `apps/api/src/routes/profiles.ts`, inside `profileRoutes`:

```ts
  app.post(
    '/api/players/me/photo',
    { preHandler: requireAuth, schema: { body: PresignBody, response: { 200: PresignResponse } } },
    async (req) => {
      const { contentType, sizeBytes } = req.body as PresignBody
      const key = `photos/${req.member.id}/upload-${randomUUID()}`
      const uploadUrl = await deps.storage.presignPut(key, contentType, sizeBytes)
      return { uploadUrl, key, maxBytes: PHOTO_MAX_BYTES }
    },
  )

  app.put(
    '/api/players/me/photo/confirm',
    { preHandler: requireAuth, schema: { body: ConfirmPhotoBody, response: { 200: PlayerDetail } } },
    async (req) => {
      const { key } = req.body as ConfirmPhotoBody

      // The key is client-supplied, so prove it is one we issued to THIS member.
      if (!key.startsWith(`photos/${req.member.id}/upload-`)) {
        throw forbidden('That upload does not belong to you')
      }

      const raw = await deps.storage.get(key)
      const normalised = await normalisePhoto(raw)
      const finalKey = `photos/${req.member.id}/${randomUUID()}.webp`
      await deps.storage.put(finalKey, normalised, 'image/webp')
      await deps.storage.delete(key)

      const previous = await deps.db
        .selectFrom('player_profiles')
        .select('photo_key')
        .where('member_id', '=', req.member.id)
        .executeTakeFirst()
      if (!previous) throw notFound('Set up your profile first')

      await deps.db
        .updateTable('player_profiles')
        .set({ photo_key: finalKey, updated_at: deps.now() })
        .where('member_id', '=', req.member.id)
        .execute()

      // Best effort: a stale photo left behind is untidy, not broken.
      if (previous.photo_key) {
        await deps.storage.delete(previous.photo_key).catch((err) => {
          req.log.warn({ err, memberId: req.member.id }, 'failed to delete replaced photo')
        })
      }

      return loadDetail(deps, req.member.id)
    },
  )
```

Add the imports: `randomUUID` from `node:crypto`; `ConfirmPhotoBody`, `PHOTO_MAX_BYTES`, `PresignBody`, `PresignResponse` from `@tennis/contracts`; `forbidden` from the error handler; `normalisePhoto` from `../storage/images.js`.

Also extend `FakeStore.presignPut` in the harness to accept and ignore the extra arguments — its signature must match `ObjectStore`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api`
Expected: PASS. If sharp fails to load, run `npm rebuild sharp`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add profile photo upload with presign, re-encode, and EXIF stripping"
git push
```

---

### Task 10: Availability routes

**Files:**
- Create: `packages/contracts/src/availability.ts`, `apps/api/src/routes/availability.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/availability-routes.test.ts`

**Interfaces:**
- Produces: contracts `Weekday = Type.Integer({ minimum: 0, maximum: 6 })`, `Block`, `Slot = { weekday, block }`, `AvailabilityGrid = Type.Array(Slot)`, `WhoIsFreeQuery = { weekday, block }`; routes `GET /api/players/:id/availability`, `PUT /api/players/me/availability`, `GET /api/availability`.

- [ ] **Step 1: Write the contracts**

`packages/contracts/src/availability.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

export const Weekday = Type.Integer({ minimum: 0, maximum: 6 })
export const Block = Type.Union([
  Type.Literal('morning'),
  Type.Literal('afternoon'),
  Type.Literal('evening'),
])
export const BLOCKS = ['morning', 'afternoon', 'evening'] as const
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const Slot = Type.Object({ weekday: Weekday, block: Block }, { additionalProperties: false })
export type Slot = Static<typeof Slot>

/** 7 days x 3 blocks, so 21 is the whole grid. */
export const AvailabilityGrid = Type.Array(Slot, { maxItems: 21 })
export type AvailabilityGrid = Static<typeof AvailabilityGrid>

export const ReplaceAvailabilityBody = Type.Object(
  { slots: AvailabilityGrid },
  { additionalProperties: false },
)
export type ReplaceAvailabilityBody = Static<typeof ReplaceAvailabilityBody>

export const WhoIsFreeQuery = Type.Object({ weekday: Weekday, block: Block })
export type WhoIsFreeQuery = Static<typeof WhoIsFreeQuery>

export const WhoIsFreeResponse = Type.Array(
  Type.Object({ id: Id, displayName: Type.String(), photoUrl: Type.Union([Type.String(), Type.Null()]) }),
)
export type WhoIsFreeResponse = Static<typeof WhoIsFreeResponse>
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/availability-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('availability routes', () => {
  it('replaces the whole grid rather than merging', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'free@example.com' })
      const put = (slots: unknown) =>
        app.inject({
          method: 'PUT',
          url: '/api/players/me/availability',
          headers: ORIGIN,
          cookies: me.cookies,
          payload: { slots },
        })

      await put([
        { weekday: 6, block: 'morning' },
        { weekday: 0, block: 'evening' },
      ])
      let res = await app.inject({
        method: 'GET',
        url: `/api/players/${me.id}/availability`,
        cookies: me.cookies,
      })
      expect(res.json()).toHaveLength(2)

      // A second call with one slot must leave exactly one slot behind.
      await put([{ weekday: 3, block: 'afternoon' }])
      res = await app.inject({
        method: 'GET',
        url: `/api/players/${me.id}/availability`,
        cookies: me.cookies,
      })
      expect(res.json()).toEqual([{ weekday: 3, block: 'afternoon' }])
    })
  })

  it('accepts an empty grid, clearing availability', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'busy@example.com' })
      await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [{ weekday: 1, block: 'morning' }] },
      })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [] },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })
  })

  it('is idempotent when the same slot appears twice', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'dupe@example.com' })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: {
          slots: [
            { weekday: 2, block: 'evening' },
            { weekday: 2, block: 'evening' },
          ],
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(1)
    })
  })

  it('rejects an out-of-range weekday', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'bad@example.com' })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [{ weekday: 7, block: 'morning' }] },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: { code: 'validation_failed' } })
    })
  })

  it('lists who is free in a slot, excluding removed members', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker@example.com' })
      const keen = await signIn(app, ctx, { email: 'keen@example.com' })
      const gone = await signIn(app, ctx, { email: 'gone@example.com' })

      for (const m of [keen, gone]) {
        await ctx.db.insertInto('availability').values({ member_id: m.id, weekday: 6, block: 'morning' }).execute()
      }
      await ctx.db.updateTable('members').set({ status: 'removed' }).where('id', '=', gone.id).execute()

      const res = await app.inject({
        method: 'GET',
        url: '/api/availability?weekday=6&block=morning',
        cookies: me.cookies,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().map((r: { id: number }) => r.id)).toEqual([keen.id])
    })
  })

  it('requires both query parameters', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker@example.com' })
      const res = await app.inject({ method: 'GET', url: '/api/availability?weekday=6', cookies: me.cookies })
      expect(res.statusCode).toBe(400)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/players/1/availability' })).statusCode).toBe(401)
    })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- availability-routes` → FAIL, routes 404.

- [ ] **Step 4: Implement the routes**

`apps/api/src/routes/availability.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import {
  AvailabilityGrid,
  MemberIdParams,
  ReplaceAvailabilityBody,
  WhoIsFreeQuery,
  WhoIsFreeResponse,
} from '@tennis/contracts'
import type { Deps } from '../app.js'
import { requireAuth } from '../plugins/session.js'

export async function availabilityRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  async function load(memberId: number) {
    return deps.db
      .selectFrom('availability')
      .select(['weekday', 'block'])
      .where('member_id', '=', memberId)
      .orderBy('weekday')
      .orderBy('block')
      .execute()
  }

  app.get(
    '/api/players/:id/availability',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: AvailabilityGrid } } },
    async (req) => load((req.params as MemberIdParams).id),
  )

  app.put(
    '/api/players/me/availability',
    {
      preHandler: requireAuth,
      schema: { body: ReplaceAvailabilityBody, response: { 200: AvailabilityGrid } },
    },
    async (req) => {
      const { slots } = req.body as ReplaceAvailabilityBody
      const memberId = req.member.id

      // Deduplicate: the grid is a set, and a double-tapped cell must not 23505.
      const unique = new Map(slots.map((s) => [`${s.weekday}:${s.block}`, s]))

      // Whole-set replacement in one transaction: a dropped connection can never
      // leave availability half-saved.
      await deps.db.transaction().execute(async (tx) => {
        await tx.deleteFrom('availability').where('member_id', '=', memberId).execute()
        if (unique.size > 0) {
          await tx
            .insertInto('availability')
            .values([...unique.values()].map((s) => ({ member_id: memberId, weekday: s.weekday, block: s.block })))
            .execute()
        }
      })

      return load(memberId)
    },
  )

  app.get(
    '/api/availability',
    { preHandler: requireAuth, schema: { querystring: WhoIsFreeQuery, response: { 200: WhoIsFreeResponse } } },
    async (req) => {
      const { weekday, block } = req.query as WhoIsFreeQuery
      const rows = await deps.db
        .selectFrom('availability as a')
        .innerJoin('members as m', 'm.id', 'a.member_id')
        .innerJoin('player_profiles as p', 'p.member_id', 'm.id')
        .select(['m.id', 'p.display_name', 'p.photo_key'])
        .where('a.weekday', '=', weekday)
        .where('a.block', '=', block)
        .where('m.status', '=', 'active')
        .orderBy('p.display_name')
        .execute()

      return rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
      }))
    },
  )
}
```

Register with `await app.register(availabilityRoutes, deps)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add availability routes with whole-grid replacement"
git push
```

---

### Task 11: Match routes and player records

**Files:**
- Create: `packages/contracts/src/match.ts`, `apps/api/src/routes/matches.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/match-routes.test.ts`

**Interfaces:**
- Produces: contracts `MatchFormat`, `MatchSide`, `MatchSetInput`, `CreateMatchBody`, `MatchSummary`, `MatchDetail`, `MatchListQuery`, `PlayerRecord`; routes `GET /api/matches`, `GET /api/matches/:id`, `POST /api/matches`, `PATCH /api/matches/:id`, `DELETE /api/matches/:id`, `GET /api/players/:id/record`.

- [ ] **Step 1: Write the contracts**

`packages/contracts/src/match.ts`:

```ts
import { Type, type Static } from '@sinclair/typebox'
import { Id, IsoDate } from './common.js'

export const MatchFormat = Type.Union([Type.Literal('singles'), Type.Literal('doubles')])
export const SideNumber = Type.Union([Type.Literal(1), Type.Literal(2)])

/** Exactly one of memberId or guestName, matching the DB check constraint. */
export const MatchPlayerInput = Type.Union([
  Type.Object({ memberId: Id }, { additionalProperties: false }),
  Type.Object({ guestName: Type.String({ minLength: 1, maxLength: 80 }) }, { additionalProperties: false }),
])
export type MatchPlayerInput = Static<typeof MatchPlayerInput>

export const MatchSetInput = Type.Object(
  {
    side1Games: Type.Integer({ minimum: 0, maximum: 99 }),
    side2Games: Type.Integer({ minimum: 0, maximum: 99 }),
  },
  { additionalProperties: false },
)
export type MatchSetInput = Static<typeof MatchSetInput>

export const CreateMatchBody = Type.Object(
  {
    playedOn: IsoDate,
    format: MatchFormat,
    venue: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
    notes: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    winnerSide: SideNumber,
    side1: Type.Array(MatchPlayerInput, { minItems: 1, maxItems: 2 }),
    side2: Type.Array(MatchPlayerInput, { minItems: 1, maxItems: 2 }),
    sets: Type.Array(MatchSetInput, { minItems: 1, maxItems: 5 }),
  },
  { additionalProperties: false },
)
export type CreateMatchBody = Static<typeof CreateMatchBody>

export const PatchMatchBody = Type.Partial(CreateMatchBody)
export type PatchMatchBody = Static<typeof PatchMatchBody>

export const MatchPlayerOut = Type.Object({
  memberId: Type.Union([Id, Type.Null()]),
  guestName: Type.Union([Type.String(), Type.Null()]),
  displayName: Type.String(),
})

export const MatchDetail = Type.Object({
  id: Id,
  playedOn: IsoDate,
  format: MatchFormat,
  venue: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  winnerSide: SideNumber,
  recordedBy: Id,
  side1: Type.Array(MatchPlayerOut),
  side2: Type.Array(MatchPlayerOut),
  sets: Type.Array(MatchSetInput),
})
export type MatchDetail = Static<typeof MatchDetail>

export const MatchList = Type.Object({
  items: Type.Array(MatchDetail),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})
export type MatchList = Static<typeof MatchList>

export const MatchListQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}_\\d+$' })),
})
export type MatchListQuery = Static<typeof MatchListQuery>

export const PlayerRecord = Type.Object({
  memberId: Id,
  matchesPlayed: Type.Integer(),
  wins: Type.Integer(),
  losses: Type.Integer(),
})
export type PlayerRecord = Static<typeof PlayerRecord>
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/match-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

const singles = (a: number, b: number) => ({
  playedOn: '2026-08-15',
  format: 'singles' as const,
  venue: 'Club court 3',
  winnerSide: 1 as const,
  side1: [{ memberId: a }],
  side2: [{ memberId: b }],
  sets: [
    { side1Games: 6, side2Games: 4 },
    { side1Games: 6, side2Games: 3 },
  ],
})

describe('match routes', () => {
  it('records a singles match a member played in', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'winner@example.com' })
      const them = await signIn(app, ctx, { email: 'loser@example.com' })

      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, them.id),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toMatchObject({ format: 'singles', winnerSide: 1, playedOn: '2026-08-15' })
      expect(body.sets).toHaveLength(2)
      expect(body.side1[0]).toMatchObject({ memberId: me.id })
    })
  })

  it('updates both players records', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'winner@example.com' })
      const them = await signIn(app, ctx, { email: 'loser@example.com' })
      await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, them.id),
      })

      const mine = await app.inject({ method: 'GET', url: `/api/players/${me.id}/record`, cookies: me.cookies })
      expect(mine.json()).toMatchObject({ matchesPlayed: 1, wins: 1, losses: 0 })
      const theirs = await app.inject({ method: 'GET', url: `/api/players/${them.id}/record`, cookies: me.cookies })
      expect(theirs.json()).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 1 })
    })
  })

  it('accepts a guest opponent', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'host@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { ...singles(me.id, me.id), side2: [{ guestName: 'Visiting Club' }] },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().side2[0]).toMatchObject({ memberId: null, displayName: 'Visiting Club' })
    })
  })

  it('refuses a player recording a match they did not play in', async () => {
    await buildTestApp(async (app, ctx) => {
      const outsider = await signIn(app, ctx, { email: 'nosy@example.com' })
      const a = await signIn(app, ctx, { email: 'a@example.com' })
      const b = await signIn(app, ctx, { email: 'b@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: outsider.cookies,
        payload: singles(a.id, b.id),
      })
      expect(res.statusCode).toBe(403)
    })
  })

  it('lets an admin record a match they did not play in', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const a = await signIn(app, ctx, { email: 'a@example.com' })
      const b = await signIn(app, ctx, { email: 'b@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: singles(a.id, b.id),
      })
      expect(res.statusCode).toBe(201)
    })
  })

  it('rejects a singles match with two players on a side', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { ...singles(me.id, x.id), side1: [{ memberId: me.id }, { memberId: x.id }] },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toMatch(/singles/i)
    })
  })

  it('rejects a doubles match with one player on a side', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { ...singles(me.id, x.id), format: 'doubles' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('rejects the same member appearing twice in one match', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, me.id),
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('pages newest first with a cursor', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      for (const day of ['2026-08-01', '2026-08-05', '2026-08-09']) {
        await app.inject({
          method: 'POST',
          url: '/api/matches',
          headers: ORIGIN,
          cookies: me.cookies,
          payload: { ...singles(me.id, x.id), playedOn: day },
        })
      }

      const first = await app.inject({ method: 'GET', url: '/api/matches?limit=2', cookies: me.cookies })
      const page1 = first.json()
      expect(page1.items.map((m: { playedOn: string }) => m.playedOn)).toEqual(['2026-08-09', '2026-08-05'])
      expect(page1.nextCursor).not.toBeNull()

      const second = await app.inject({
        method: 'GET',
        url: `/api/matches?limit=2&cursor=${page1.nextCursor}`,
        cookies: me.cookies,
      })
      expect(second.json().items.map((m: { playedOn: string }) => m.playedOn)).toEqual(['2026-08-01'])
      expect(second.json().nextCursor).toBeNull()
    })
  })

  it('lets the recorder correct a match and an admin delete it', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const created = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, x.id),
      })
      const id = created.json().id

      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { venue: 'Court 1', winnerSide: 2 },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json()).toMatchObject({ venue: 'Court 1', winnerSide: 2 })

      const denied = await app.inject({
        method: 'DELETE',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: x.cookies,
      })
      expect(denied.statusCode).toBe(403)

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(deleted.statusCode).toBe(204)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/matches' })).statusCode).toBe(401)
    })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace @tennis/api -- match-routes` → FAIL, routes 404.

- [ ] **Step 4: Implement the routes**

`apps/api/src/routes/matches.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import {
  CreateMatchBody,
  MatchDetail,
  MatchList,
  MatchListQuery,
  MemberIdParams,
  PatchMatchBody,
  PlayerRecord,
  type MatchPlayerInput,
} from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { Database } from '../db/schema.js'
import { badRequest, forbidden, notFound } from '../plugins/error-handler.js'
import { requireAuth } from '../plugins/session.js'

const memberIdsOf = (side: MatchPlayerInput[]): number[] =>
  side.flatMap((p) => ('memberId' in p ? [p.memberId] : []))

function assertShape(body: CreateMatchBody): void {
  const expected = body.format === 'singles' ? 1 : 2
  for (const [name, side] of [
    ['side1', body.side1],
    ['side2', body.side2],
  ] as const) {
    if (side.length !== expected) {
      throw badRequest(`A ${body.format} match needs exactly ${expected} player(s) on each side`, {
        fields: [{ path: `/${name}`, message: `Expected ${expected}, got ${side.length}` }],
      })
    }
  }
  const ids = [...memberIdsOf(body.side1), ...memberIdsOf(body.side2)]
  if (new Set(ids).size !== ids.length) {
    throw badRequest('A player cannot appear twice in the same match')
  }
}

async function loadMatch(deps: Deps, id: number): Promise<MatchDetail> {
  const m = await deps.db
    .selectFrom('matches')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  if (!m) throw notFound('No such match')

  const [players, sets] = await Promise.all([
    deps.db
      .selectFrom('match_players as mp')
      .leftJoin('player_profiles as p', 'p.member_id', 'mp.member_id')
      .select(['mp.side', 'mp.member_id', 'mp.guest_name', 'p.display_name'])
      .where('mp.match_id', '=', id)
      .orderBy('mp.id')
      .execute(),
    deps.db
      .selectFrom('match_sets')
      .select(['side1_games', 'side2_games'])
      .where('match_id', '=', id)
      .orderBy('set_number')
      .execute(),
  ])

  const side = (n: 1 | 2) =>
    players
      .filter((p) => p.side === n)
      .map((p) => ({
        memberId: p.member_id,
        guestName: p.guest_name,
        displayName: p.display_name ?? p.guest_name ?? 'Unknown',
      }))

  return {
    id: m.id,
    playedOn: m.played_on,
    format: m.format,
    venue: m.venue,
    notes: m.notes,
    winnerSide: m.winner_side,
    recordedBy: m.recorded_by,
    side1: side(1),
    side2: side(2),
    sets: sets.map((s) => ({ side1Games: s.side1_games, side2Games: s.side2_games })),
  }
}

async function writeChildren(
  tx: Kysely<Database>,
  matchId: number,
  body: Pick<CreateMatchBody, 'side1' | 'side2' | 'sets'>,
): Promise<void> {
  await tx.deleteFrom('match_players').where('match_id', '=', matchId).execute()
  await tx.deleteFrom('match_sets').where('match_id', '=', matchId).execute()
  await tx
    .insertInto('match_players')
    .values(
      [
        ...body.side1.map((p) => ({ side: 1 as const, p })),
        ...body.side2.map((p) => ({ side: 2 as const, p })),
      ].map(({ side, p }) => ({
        match_id: matchId,
        side,
        member_id: 'memberId' in p ? p.memberId : null,
        guest_name: 'guestName' in p ? p.guestName : null,
      })),
    )
    .execute()
  await tx
    .insertInto('match_sets')
    .values(
      body.sets.map((s, i) => ({
        match_id: matchId,
        set_number: i + 1,
        side1_games: s.side1Games,
        side2_games: s.side2Games,
      })),
    )
    .execute()
}

export async function matchRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(
    '/api/matches',
    { preHandler: requireAuth, schema: { querystring: MatchListQuery, response: { 200: MatchList } } },
    async (req) => {
      const { limit = 20, cursor } = req.query as MatchListQuery
      let q = deps.db.selectFrom('matches').select(['id', 'played_on'])
      if (cursor) {
        const [day, rawId] = cursor.split('_')
        // Keyset pagination on (played_on, id) so a new match cannot shift a page.
        q = q.where((eb) =>
          eb.or([
            eb('played_on', '<', day!),
            eb.and([eb('played_on', '=', day!), eb('id', '<', Number(rawId))]),
          ]),
        )
      }
      const rows = await q.orderBy('played_on', 'desc').orderBy('id', 'desc').limit(limit + 1).execute()

      const page = rows.slice(0, limit)
      const last = page.at(-1)
      const items = await Promise.all(page.map((r) => loadMatch(deps, r.id)))
      return {
        items,
        nextCursor: rows.length > limit && last ? `${last.played_on}_${last.id}` : null,
      }
    },
  )

  app.get(
    '/api/matches/:id',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: MatchDetail } } },
    async (req) => loadMatch(deps, (req.params as MemberIdParams).id),
  )

  app.post(
    '/api/matches',
    { preHandler: requireAuth, schema: { body: CreateMatchBody, response: { 201: MatchDetail } } },
    async (req, reply) => {
      const body = req.body as CreateMatchBody
      assertShape(body)

      const participants = new Set([...memberIdsOf(body.side1), ...memberIdsOf(body.side2)])
      if (req.member.role !== 'admin' && !participants.has(req.member.id)) {
        throw forbidden('You can only record matches you played in')
      }

      const id = await deps.db.transaction().execute(async (tx) => {
        const match = await tx
          .insertInto('matches')
          .values({
            played_on: body.playedOn,
            format: body.format,
            venue: body.venue ?? null,
            notes: body.notes ?? null,
            winner_side: body.winnerSide,
            recorded_by: req.member.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        await writeChildren(tx, match.id, body)
        return match.id
      })

      req.log.info({ matchId: id, by: req.member.id }, 'match recorded')
      return reply.code(201).send(await loadMatch(deps, id))
    },
  )

  app.patch(
    '/api/matches/:id',
    { preHandler: requireAuth, schema: { params: MemberIdParams, body: PatchMatchBody, response: { 200: MatchDetail } } },
    async (req) => {
      const { id } = req.params as MemberIdParams
      const patch = req.body as PatchMatchBody

      const existing = await loadMatch(deps, id)
      if (req.member.role !== 'admin' && existing.recordedBy !== req.member.id) {
        throw forbidden('Only the member who recorded this match, or an admin, can change it')
      }

      // Validate the POST-SHAPED result, so a patch cannot sneak past assertShape.
      const merged: CreateMatchBody = {
        playedOn: patch.playedOn ?? existing.playedOn,
        format: patch.format ?? existing.format,
        venue: 'venue' in patch ? (patch.venue ?? null) : existing.venue,
        notes: 'notes' in patch ? (patch.notes ?? null) : existing.notes,
        winnerSide: patch.winnerSide ?? existing.winnerSide,
        side1:
          patch.side1 ??
          existing.side1.map((p) => (p.memberId ? { memberId: p.memberId } : { guestName: p.guestName! })),
        side2:
          patch.side2 ??
          existing.side2.map((p) => (p.memberId ? { memberId: p.memberId } : { guestName: p.guestName! })),
        sets: patch.sets ?? existing.sets,
      }
      assertShape(merged)

      await deps.db.transaction().execute(async (tx) => {
        await tx
          .updateTable('matches')
          .set({
            played_on: merged.playedOn,
            format: merged.format,
            venue: merged.venue ?? null,
            notes: merged.notes ?? null,
            winner_side: merged.winnerSide,
            updated_at: deps.now(),
          })
          .where('id', '=', id)
          .execute()
        await writeChildren(tx, id, merged)
      })

      return loadMatch(deps, id)
    },
  )

  app.delete(
    '/api/matches/:id',
    { preHandler: requireAuth, schema: { params: MemberIdParams } },
    async (req, reply) => {
      const { id } = req.params as MemberIdParams
      if (req.member.role !== 'admin') throw forbidden('Only an admin can delete a match')
      const gone = await deps.db.deleteFrom('matches').where('id', '=', id).returning('id').executeTakeFirst()
      if (!gone) throw notFound('No such match')
      return reply.code(204).send()
    },
  )

  app.get(
    '/api/players/:id/record',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: PlayerRecord } } },
    async (req) => {
      const { id } = req.params as MemberIdParams
      const row = await deps.db
        .selectFrom('player_records')
        .selectAll()
        .where('member_id', '=', id)
        .executeTakeFirst()
      if (!row) throw notFound('No such player')
      return {
        memberId: row.member_id,
        matchesPlayed: row.matches_played,
        wins: row.wins,
        losses: row.losses,
      }
    },
  )
}
```

`DELETE` is declared with `requireAuth` and checks the role in the body rather than using `requireRole('admin')` only because it needs the 403 message to differ; if you prefer strict consistency with the Global Constraints, swap it to `requireRole('admin')` and delete the inline check.

Register with `await app.register(matchRoutes, deps)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace @tennis/api` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add match recording, listing, correction, and player records"
git push
```

---

### Task 12: Expired-row cleanup job

**Files:**
- Create: `apps/api/src/jobs/cleanup.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/cleanup.test.ts`

**Interfaces:**
- Produces: `sweepExpired(deps): Promise<{ sessions: number; tokens: number }>` and `startCleanupJob(deps): () => void` (returns a stop function) from `src/jobs/cleanup.ts`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/cleanup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'
import { sweepExpired } from '../src/jobs/cleanup.js'
import { hashToken } from '../src/auth/tokens.js'

describe('sweepExpired', () => {
  it('deletes expired sessions and leaves live ones alone', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'sweep@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await ctx.db
        .insertInto('sessions')
        .values([
          { member_id: m.id, token_hash: hashToken('dead'), expires_at: new Date('2026-08-01T00:00:00Z') },
          { member_id: m.id, token_hash: hashToken('alive'), expires_at: new Date('2026-09-30T00:00:00Z') },
        ])
        .execute()

      const result = await sweepExpired({ db: ctx.db, now: () => ctx.clock.now })
      expect(result.sessions).toBe(1)

      const left = await ctx.db.selectFrom('sessions').select('token_hash').execute()
      expect(left).toHaveLength(1)
      expect(left[0]!.token_hash).toEqual(hashToken('alive'))
    })
  })

  it('deletes consumed tokens older than seven days but keeps recent ones', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'tok@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await ctx.db
        .insertInto('login_tokens')
        .values([
          {
            member_id: m.id,
            token_hash: hashToken('old'),
            expires_at: new Date('2026-08-01T00:00:00Z'),
            consumed_at: new Date('2026-08-01T00:00:00Z'),
            created_at: new Date('2026-08-01T00:00:00Z'),
          },
          {
            member_id: m.id,
            token_hash: hashToken('recent'),
            expires_at: new Date('2026-08-21T09:00:00Z'),
            consumed_at: new Date('2026-08-21T09:00:00Z'),
            created_at: new Date('2026-08-21T09:00:00Z'),
          },
        ])
        .execute()

      const result = await sweepExpired({ db: ctx.db, now: () => ctx.clock.now })
      expect(result.tokens).toBe(1)
      expect(await ctx.db.selectFrom('login_tokens').select('id').execute()).toHaveLength(1)
    })
  })

  it('is safe to run twice', async () => {
    await buildTestApp(async (_app, ctx) => {
      const deps = { db: ctx.db, now: () => ctx.clock.now }
      await sweepExpired(deps)
      const second = await sweepExpired(deps)
      expect(second).toEqual({ sessions: 0, tokens: 0 })
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Run: `npm test --workspace @tennis/api -- cleanup` → FAIL (module missing).

`apps/api/src/jobs/cleanup.ts`:

```ts
import type { SessionDeps } from '../auth/sessions.js'

const TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** Idempotent, so running on more than one instance is harmless. */
export async function sweepExpired(deps: SessionDeps): Promise<{ sessions: number; tokens: number }> {
  const now = deps.now()

  const sessions = await deps.db
    .deleteFrom('sessions')
    .where('expires_at', '<=', now)
    .executeTakeFirst()

  const tokens = await deps.db
    .deleteFrom('login_tokens')
    .where('created_at', '<', new Date(now.getTime() - TOKEN_RETENTION_MS))
    .where((eb) => eb.or([eb('consumed_at', 'is not', null), eb('expires_at', '<=', now)]))
    .executeTakeFirst()

  return {
    sessions: Number(sessions.numDeletedRows ?? 0n),
    tokens: Number(tokens.numDeletedRows ?? 0n),
  }
}

export function startCleanupJob(deps: SessionDeps & { log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } }): () => void {
  const tick = () => {
    sweepExpired(deps).then(
      (r) => {
        if (r.sessions || r.tokens) deps.log.info(r, 'cleanup swept expired rows')
      },
      (err: unknown) => deps.log.error({ err }, 'cleanup sweep failed'),
    )
  }
  const timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref() // never hold the process open
  tick()
  return () => clearInterval(timer)
}
```

Run again → PASS, 3 tests.

- [ ] **Step 3: Start the job from the entry point**

In `apps/api/src/index.ts`, after `buildApp` and before `listen`:

```ts
startCleanupJob({ db, now: () => new Date(), log: app.log })
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: sweep expired sessions and consumed login tokens hourly"
git push
```

---

### Task 13: Client scaffold, design tokens, API client, and app shell

**REQUIRED SUB-SKILL for this task:** invoke `frontend-design` before writing the CSS. The tokens below are a starting palette, not a finished visual identity; the skill exists to stop this looking like every other Tailwind app. Keep the token *names* — later tasks reference them.

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/index.css`
- Create: `apps/web/src/api/client.ts`, `apps/web/src/api/queries.ts`
- Create: `apps/web/src/auth/SessionGate.tsx`
- Create: `apps/web/src/components/{Button,Card,Field,Avatar,AppShell,BottomTabs,Spinner,ErrorState}.tsx`
- Modify: root `tsconfig.json` (add the reference), root `package.json` (add `dev:web`)
- Test: `apps/web/test/client.test.ts`, `apps/web/test/SessionGate.test.tsx`

**Interfaces:**
- Produces:
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` from `api/client.ts`, throwing `ApiError { status, code, message, fields }`.
  - `useMe()`, `useRoster()`, `usePlayer(id)`, `useMatches()`, `useAvailability(id)` and mutation hooks `useRequestLink()`, `useSaveProfile()`, `useSaveAvailability()`, `useUploadPhoto()`, `useRecordMatch()`, `useInviteMember()`, `useSetRole()`, `useRemoveMember()`, `useLogout()` from `api/queries.ts`.
  - `<SessionGate>` wrapping the authenticated routes.
  - `<AppShell>` with `<BottomTabs>` below `lg` and side nav at `lg`.

- [ ] **Step 1: Create the client package**

```bash
npm install --workspace @tennis/web react react-dom react-router @tanstack/react-query react-hook-form @hookform/resolvers @sinclair/typebox
npm install --workspace @tennis/web -D @vitejs/plugin-react vite tailwindcss @tailwindcss/vite @types/react @types/react-dom vitest @testing-library/react @testing-library/user-event jsdom
```

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev only: in production the API serves this bundle from the same origin.
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.ts'] },
})
```

`apps/web/test/setup.ts`:

```ts
import '@testing-library/react'
```

- [ ] **Step 2: Write the design tokens**

`apps/web/src/index.css`:

```css
@import 'tailwindcss';

/*
 * Clay court, not default Tailwind. Terracotta ground, chalk lines, deep
 * evening green. Every colour below is used somewhere; none is decorative.
 */
@theme {
  --color-clay-50: #fdf5f0;
  --color-clay-100: #f8e3d6;
  --color-clay-300: #e0a578;
  --color-clay-500: #c1440e;
  --color-clay-600: #a63a0c;
  --color-chalk: #fbfaf7;
  --color-line: #e6e1d7;
  --color-court-500: #3f7d3f;
  --color-court-700: #2b5a2b;
  --color-night-700: #33302b;
  --color-night-900: #1c1a17;

  --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;

  --radius-card: 0.875rem;
  --shadow-lift: 0 1px 2px rgb(28 26 23 / 0.06), 0 8px 24px -12px rgb(28 26 23 / 0.18);
}

@layer base {
  html {
    -webkit-text-size-adjust: 100%;
  }
  body {
    @apply bg-chalk text-night-900 font-sans antialiased;
    /* Room for the bottom tab bar plus the iOS home indicator. */
    padding-bottom: env(safe-area-inset-bottom);
  }
  /* Visible focus everywhere: keyboard users are not an afterthought. */
  :focus-visible {
    @apply outline-2 outline-offset-2 outline-clay-500;
  }
}

@utility tap-target {
  min-height: 2.75rem; /* 44px */
  min-width: 2.75rem;
}
```

- [ ] **Step 3: Write the failing API client test**

`apps/web/test/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../src/api/client.js'

const mockFetch = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

afterEach(() => vi.restoreAllMocks())

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(200, { id: 1 })
    await expect(apiFetch('/api/auth/me')).resolves.toEqual({ id: 1 })
  })

  it('returns undefined for 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('throws an ApiError carrying the code', async () => {
    mockFetch(403, { error: { code: 'forbidden', message: 'Not permitted' } })
    await expect(apiFetch('/api/members')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('exposes field errors keyed by form field name', async () => {
    mockFetch(400, {
      error: {
        code: 'validation_failed',
        message: 'bad',
        details: { fields: [{ path: '/displayName', message: 'Required' }] },
      },
    })
    try {
      await apiFetch('/api/players/me', { method: 'PUT', body: '{}' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).fields).toEqual({ displayName: 'Required' })
    }
  })

  it('sends json content-type and same-origin credentials on a mutation', async () => {
    const spy = mockFetch(200, {})
    await apiFetch('/api/members', { method: 'POST', body: JSON.stringify({ email: 'a@b.c' }) })
    const init = spy.mock.calls[0]![1]!
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })
})
```

- [ ] **Step 4: Run it to verify it fails, then implement**

Run: `npm test --workspace @tennis/web -- client` → FAIL (module missing).

`apps/web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Form-field name → message, ready to hand to react-hook-form setError. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface Envelope {
  error?: { code?: string; message?: string; details?: { fields?: { path?: string; message?: string }[] } }
}

function toFieldMap(env: Envelope): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of env.error?.details?.fields ?? []) {
    // '/displayName' → 'displayName'; nested paths keep their dots.
    const name = (f.path ?? '').replace(/^\//, '').replace(/\//g, '.')
    if (name && f.message) out[name] = f.message
  }
  return out
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    if (!res.ok) throw new ApiError(res.status, 'error', 'Request failed')
    return undefined as T
  }

  const body = (await res.json().catch(() => ({}))) as Envelope & T
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error?.code ?? 'error',
      body.error?.message ?? 'Something went wrong.',
      toFieldMap(body),
    )
  }
  return body as T
}
```

Run again → PASS, 5 tests.

- [ ] **Step 5: Write the query hooks**

`apps/web/src/api/queries.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AvailabilityGrid,
  InviteBody,
  MatchList,
  MeResponse,
  PatchProfileBody,
  PlayerDetail,
  PresignBody,
  PresignResponse,
  RosterEntry,
  CreateMatchBody,
  ProfileBody,
} from '@tennis/contracts'
import { apiFetch } from './client.js'

export const keys = {
  me: ['me'] as const,
  roster: ['roster'] as const,
  player: (id: number) => ['player', id] as const,
  availability: (id: number) => ['availability', id] as const,
  matches: ['matches'] as const,
}

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: () => apiFetch<MeResponse>('/api/auth/me'),
    // A 401 is the answer, not a failure to retry.
    retry: false,
    staleTime: 60_000,
  })

export const useRoster = () =>
  useQuery({ queryKey: keys.roster, queryFn: () => apiFetch<RosterEntry[]>('/api/members') })

export const usePlayer = (id: number) =>
  useQuery({ queryKey: keys.player(id), queryFn: () => apiFetch<PlayerDetail>(`/api/players/${id}`) })

export const useAvailability = (id: number) =>
  useQuery({
    queryKey: keys.availability(id),
    queryFn: () => apiFetch<AvailabilityGrid>(`/api/players/${id}/availability`),
  })

export const useMatches = () =>
  useQuery({ queryKey: keys.matches, queryFn: () => apiFetch<MatchList>('/api/matches?limit=25') })

export const useRequestLink = () =>
  useMutation({
    mutationFn: (body: { email: string }) =>
      apiFetch('/api/auth/request-link', { method: 'POST', body: JSON.stringify(body) }),
  })

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.clear(),
  })
}

export function useSaveProfile(mode: 'create' | 'update') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProfileBody | PatchProfileBody) =>
      apiFetch<PlayerDetail>('/api/players/me', {
        method: mode === 'create' ? 'PUT' : 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (p) => {
      qc.setQueryData(keys.player(p.id), p)
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: keys.roster })
    },
  })
}

export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<PlayerDetail> => {
      const presign = await apiFetch<PresignResponse>('/api/players/me/photo', {
        method: 'POST',
        body: JSON.stringify({
          contentType: file.type,
          sizeBytes: file.size,
        } satisfies PresignBody),
      })
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      })
      if (!put.ok) throw new Error('Upload failed. Check your connection and try again.')
      return apiFetch<PlayerDetail>('/api/players/me/photo/confirm', {
        method: 'PUT',
        body: JSON.stringify({ key: presign.key }),
      })
    },
    onSuccess: (p) => {
      qc.setQueryData(keys.player(p.id), p)
      void qc.invalidateQueries({ queryKey: keys.roster })
    },
  })
}

export function useSaveAvailability(memberId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slots: AvailabilityGrid) =>
      apiFetch<AvailabilityGrid>('/api/players/me/availability', {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      }),
    onSuccess: (grid) => qc.setQueryData(keys.availability(memberId), grid),
  })
}

export function useRecordMatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateMatchBody) =>
      apiFetch('/api/matches', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.matches })
      void qc.invalidateQueries({ queryKey: ['player'] })
    },
  })
}

function useRosterMutation<T>(fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.roster }),
  })
}

export const useInviteMember = () =>
  useRosterMutation((body: InviteBody) =>
    apiFetch('/api/members', { method: 'POST', body: JSON.stringify(body) }),
  )

export const useSetRole = () =>
  useRosterMutation(({ id, role }: { id: number; role: 'admin' | 'player' }) =>
    apiFetch(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  )

export const useRemoveMember = () =>
  useRosterMutation((id: number) => apiFetch(`/api/members/${id}`, { method: 'DELETE' }))

export const useResendInvite = () =>
  useRosterMutation((id: number) => apiFetch(`/api/members/${id}/resend-invite`, { method: 'POST' }))
```

- [ ] **Step 6: Write the failing SessionGate test**

`apps/web/test/SessionGate.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SessionGate } from '../src/auth/SessionGate.js'

const wrap = (initial: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<SessionGate />}>
            <Route path="/" element={<p>Roster</p>} />
            <Route path="/setup" element={<p>Setup</p>} />
          </Route>
          <Route path="/login" element={<p>Login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

afterEach(() => vi.restoreAllMocks())

describe('SessionGate', () => {
  it('sends an unauthenticated visitor to login', async () => {
    respond(401, { error: { code: 'unauthorized', message: 'Sign in required' } })
    wrap('/')
    expect(await screen.findByText('Login')).toBeTruthy()
  })

  it('sends a signed-in member with no profile to setup', async () => {
    respond(200, { id: 1, email: 'a@b.c', role: 'player', hasProfile: false })
    wrap('/')
    expect(await screen.findByText('Setup')).toBeTruthy()
  })

  it('lets a fully set-up member through', async () => {
    respond(200, { id: 1, email: 'a@b.c', role: 'player', hasProfile: true })
    wrap('/')
    expect(await screen.findByText('Roster')).toBeTruthy()
  })

  it('does not bounce a member who is already on setup', async () => {
    respond(200, { id: 1, email: 'a@b.c', role: 'player', hasProfile: false })
    wrap('/setup')
    expect(await screen.findByText('Setup')).toBeTruthy()
  })
})
```

- [ ] **Step 7: Implement SessionGate, shell, and components**

`apps/web/src/auth/SessionGate.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from 'react-router'
import { useMe } from '../api/queries.js'
import { Spinner } from '../components/Spinner.js'

export function SessionGate() {
  const { data: me, isPending, isError } = useMe()
  const { pathname } = useLocation()

  if (isPending) return <Spinner label="Checking your session" />
  if (isError || !me) return <Navigate to="/login" replace />
  if (!me.hasProfile && pathname !== '/setup') return <Navigate to="/setup" replace />
  return <Outlet context={me} />
}
```

`apps/web/src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const STYLES: Record<Variant, string> = {
  primary: 'bg-clay-500 text-chalk hover:bg-clay-600 disabled:bg-clay-300',
  secondary: 'bg-clay-100 text-night-900 hover:bg-clay-300/60',
  ghost: 'bg-transparent text-night-700 hover:bg-line/60',
  danger: 'bg-transparent text-clay-600 ring-1 ring-clay-300 hover:bg-clay-50',
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-card px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${STYLES[variant]} ${className}`}
    />
  )
}
```

`apps/web/src/components/Card.tsx`:

```tsx
import type { PropsWithChildren } from 'react'

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`rounded-card border border-line bg-chalk p-4 shadow-lift ${className}`}>{children}</div>
  )
}
```

`apps/web/src/components/Field.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | undefined
  hint?: ReactNode
}

export function Field({ label, error, hint, ...rest }: Props) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-night-700">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        className={`tap-target rounded-card border bg-white px-3 text-base ${
          error ? 'border-clay-500' : 'border-line'
        }`}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-night-700/70">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-clay-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

`text-base` on the input is deliberate: anything under 16px makes iOS Safari zoom on focus.

`apps/web/src/components/Avatar.tsx`:

```tsx
const PALETTE = ['bg-clay-500', 'bg-court-500', 'bg-night-700', 'bg-clay-600', 'bg-court-700']

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  // Stable colour per name, so a teammate looks the same on every screen.
  const tone = PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]!
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-display text-chalk ${tone}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  )
}
```

The `alt=""` and `aria-hidden` are intentional — the name is always rendered as text beside the avatar, so announcing it twice is noise.

`apps/web/src/components/Spinner.tsx`:

```tsx
export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-8 text-sm text-night-700/70">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-clay-500" />
      {label}
    </div>
  )
}
```

`apps/web/src/components/ErrorState.tsx`:

```tsx
import { Button } from './Button.js'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card bg-clay-50 p-4">
      <p className="text-sm text-night-900">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
```

`apps/web/src/components/BottomTabs.tsx`:

```tsx
import { NavLink } from 'react-router'

const TABS = [
  { to: '/', label: 'Roster' },
  { to: '/matches', label: 'Matches' },
  { to: '/me', label: 'Me' },
] as const

export function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-chalk/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `tap-target flex flex-1 flex-col items-center justify-center py-2 text-xs font-semibold ${
              isActive ? 'text-clay-500' : 'text-night-700/60'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

`apps/web/src/components/AppShell.tsx`:

```tsx
import type { PropsWithChildren } from 'react'
import { NavLink, useOutletContext } from 'react-router'
import type { MeResponse } from '@tennis/contracts'
import { BottomTabs } from './BottomTabs.js'

const LINKS = [
  { to: '/', label: 'Roster', end: true },
  { to: '/matches', label: 'Matches', end: false },
  { to: '/me', label: 'Me', end: false },
]

export function AppShell({ children, title }: PropsWithChildren<{ title: string }>) {
  const me = useOutletContext<MeResponse>()
  return (
    <div className="lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line p-6 lg:block">
        <p className="font-display text-lg text-clay-500">Tennis Team</p>
        <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `tap-target flex items-center rounded-card px-3 text-sm font-semibold ${
                  isActive ? 'bg-clay-100 text-night-900' : 'text-night-700/70 hover:bg-line/50'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          {me.role === 'admin' ? (
            <NavLink
              to="/admin"
              className="tap-target flex items-center rounded-card px-3 text-sm font-semibold text-night-700/70 hover:bg-line/50"
            >
              Admin
            </NavLink>
          ) : null}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 lg:pb-10">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        <div className="mt-5">{children}</div>
      </main>

      <BottomTabs />
    </div>
  )
}
```

`pb-24` clears the fixed tab bar on phones; without it the last card is unreachable.

- [ ] **Step 8: Wire routes and entry point**

`apps/web/src/routes.tsx` declares the tree; the screen components arrive in Tasks 14–18, so for this task point every authenticated route at a placeholder `<AppShell title="…" />` with no children, and replace them as each task lands.

```tsx
import { createBrowserRouter } from 'react-router'
import { SessionGate } from './auth/SessionGate.js'
import { AppShell } from './components/AppShell.js'

export const router = createBrowserRouter([
  { path: '/login', lazy: () => import('./screens/Login.js') },
  {
    element: <SessionGate />,
    children: [
      { path: '/setup', lazy: () => import('./screens/Setup.js') },
      { path: '/', lazy: () => import('./screens/Roster.js') },
      { path: '/players/:id', lazy: () => import('./screens/Player.js') },
      { path: '/me', lazy: () => import('./screens/Me.js') },
      { path: '/matches', lazy: () => import('./screens/Matches.js') },
      { path: '/matches/new', lazy: () => import('./screens/RecordMatch.js') },
      { path: '/admin', lazy: () => import('./screens/Admin.js') },
    ],
  },
  { path: '*', element: <AppShell title="Not found">That page does not exist.</AppShell> },
])
```

Each screen module exports `Component`, which is what React Router's `lazy` expects.

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { router } from './routes.js'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Tennis Team</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`viewport-fit=cover` is what makes `env(safe-area-inset-bottom)` non-zero on notched phones.

- [ ] **Step 9: Run everything**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all green, 9 new web tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold client with design tokens, api client, session gate, and app shell"
git push
```

---

### Task 14: Login and profile setup screens

**Files:**
- Create: `apps/web/src/screens/Login.tsx`, `apps/web/src/screens/Setup.tsx`, `apps/web/src/components/ProfileForm.tsx`
- Test: `apps/web/test/Login.test.tsx`, `apps/web/test/ProfileForm.test.tsx`

**Interfaces:**
- Produces: `<ProfileForm mode="create" | "update" defaultValues submitLabel onSaved />`, reused by `/setup` and `/me`; `Login` and `Setup` modules each exporting `Component`.

- [ ] **Step 1: Write the failing Login test**

`apps/web/test/Login.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Component as Login } from '../src/screens/Login.js'

const renderLogin = (search = '') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  )

afterEach(() => vi.restoreAllMocks())

describe('Login', () => {
  it('shows a confirmation that does not reveal whether the address is on the team', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'sent' }), { status: 202, headers: { 'content-type': 'application/json' } }),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    const confirmation = await screen.findByRole('status')
    expect(confirmation.textContent).toMatch(/check your inbox/i)
    // Must NOT confirm membership either way.
    expect(confirmation.textContent).not.toMatch(/not a member|no account|unknown/i)
  })

  it('rejects a malformed address before calling the API', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText(/valid email/i)).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })

  it('explains an invalid or used link', () => {
    renderLogin('?error=link_invalid')
    expect(screen.getByRole('alert').textContent).toMatch(/expired|already been used/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails, then implement Login**

`apps/web/src/screens/Login.tsx`:

```tsx
import { useForm } from 'react-hook-form'
import { typeboxResolver } from '@hookform/resolvers/typebox'
import { useSearchParams } from 'react-router'
import { RequestLinkBody, type RequestLinkBody as Body } from '@tennis/contracts'
import { useRequestLink } from '../api/queries.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { Field } from '../components/Field.js'

export function Component() {
  const [params] = useSearchParams()
  const linkFailed = params.get('error') === 'link_invalid'
  const requestLink = useRequestLink()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Body>({ resolver: typeboxResolver(RequestLinkBody) })

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <header>
        <p className="font-display text-3xl tracking-tight text-clay-500">Tennis Team</p>
        <p className="mt-2 text-sm text-night-700/80">
          Members only. Enter your email and we will send you a sign-in link.
        </p>
      </header>

      {linkFailed ? (
        <div role="alert" className="rounded-card bg-clay-50 p-3 text-sm text-night-900">
          That link has expired or has already been used. Request a fresh one below.
        </div>
      ) : null}

      <Card>
        {requestLink.isSuccess ? (
          <p role="status" className="text-sm">
            Check your inbox. If that address is on the team, a sign-in link is on its way. The link works
            once and expires in 15 minutes.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={handleSubmit((values) => requestLink.mutate(values))}
            noValidate
          >
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              error={errors.email ? 'Enter a valid email address' : undefined}
              {...register('email')}
            />
            <Button type="submit" disabled={requestLink.isPending}>
              {requestLink.isPending ? 'Sending…' : 'Send me a link'}
            </Button>
            {requestLink.isError ? (
              <p role="alert" className="text-xs text-clay-600">
                Could not send the link just now. Please try again in a moment.
              </p>
            ) : null}
          </form>
        )}
      </Card>
    </main>
  )
}
```

The success copy is load-bearing: it must read the same whether or not the address is a member, or the UI leaks the roster that the API deliberately protects.

- [ ] **Step 3: Write the failing ProfileForm test**

`apps/web/test/ProfileForm.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfileForm } from '../src/components/ProfileForm.js'

const setup = (onSaved = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ProfileForm mode="create" submitLabel="Save profile" onSaved={onSaved} />
    </QueryClientProvider>,
  )
  return onSaved
}

afterEach(() => vi.restoreAllMocks())

describe('ProfileForm', () => {
  it('requires a display name', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    setup()
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText(/name your teammates/i)).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })

  it('hides the rating value until a rating system is chosen', async () => {
    setup()
    expect(screen.queryByLabelText(/rating value/i)).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText(/rating system/i), 'ntrp')
    expect(screen.getByLabelText(/rating value/i)).toBeTruthy()
  })

  it('submits and reports success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1, displayName: 'Ace' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const onSaved = setup()
    await userEvent.type(screen.getByLabelText(/display name/i), 'Ace')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('maps a server field error back onto its input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'bad_request',
            message: 'nope',
            details: { fields: [{ path: '/displayName', message: 'Already taken' }] },
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )
    setup()
    await userEvent.type(screen.getByLabelText(/display name/i), 'Ace')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText('Already taken')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Implement ProfileForm**

`apps/web/src/components/ProfileForm.tsx`:

```tsx
import { useForm } from 'react-hook-form'
import { typeboxResolver } from '@hookform/resolvers/typebox'
import { ProfileBody, type PlayerDetail, type ProfileBody as Body } from '@tennis/contracts'
import { ApiError } from '../api/client.js'
import { useSaveProfile } from '../api/queries.js'
import { Button } from './Button.js'
import { Field } from './Field.js'

const HANDS = [
  ['', 'Prefer not to say'],
  ['right', 'Right-handed'],
  ['left', 'Left-handed'],
] as const
const BACKHANDS = [
  ['', 'Prefer not to say'],
  ['one', 'One-handed'],
  ['two', 'Two-handed'],
] as const
const FORMATS = [
  ['', 'No preference'],
  ['singles', 'Singles'],
  ['doubles', 'Doubles'],
  ['both', 'Either'],
] as const
const SYSTEMS = [
  ['none', 'No rating'],
  ['utr', 'UTR'],
  ['ntrp', 'NTRP'],
  ['club', 'Club level'],
] as const

function Select({
  label,
  options,
  ...rest
}: { label: string; options: readonly (readonly [string, string])[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = `sel-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-night-700">
        {label}
      </label>
      <select
        {...rest}
        id={id}
        className="tap-target rounded-card border border-line bg-white px-3 text-base"
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}

interface Props {
  mode: 'create' | 'update'
  defaultValues?: Partial<Body>
  submitLabel: string
  onSaved: (profile: PlayerDetail) => void
}

export function ProfileForm({ mode, defaultValues, submitLabel, onSaved }: Props) {
  const save = useSaveProfile(mode)
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<Body>({
    resolver: typeboxResolver(ProfileBody),
    defaultValues: { ratingSystem: 'none', ...defaultValues },
  })

  const ratingSystem = watch('ratingSystem')

  const onSubmit = handleSubmit(async (values) => {
    // Empty strings from <select> mean "unset", which the API models as null.
    const cleaned = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]),
    ) as Body
    if (cleaned.ratingSystem === 'none') cleaned.ratingValue = null

    try {
      onSaved(await save.mutateAsync(cleaned))
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Body, { message })
        }
        if (Object.keys(err.fields).length === 0) {
          setError('root', { message: err.message })
        }
      } else {
        setError('root', { message: 'Could not save. Check your connection and try again.' })
      }
    }
  })

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <Field
        label="Display name"
        autoComplete="name"
        error={errors.displayName ? (errors.displayName.message ?? 'Enter the name your teammates know you by') : undefined}
        {...register('displayName')}
      />
      <Field label="Nickname" error={errors.nickname?.message} {...register('nickname')} />
      <Field
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        hint="Only visible to teammates."
        error={errors.phone?.message}
        {...register('phone')}
      />

      <Select label="Dominant hand" options={HANDS} {...register('dominantHand')} />
      <Select label="Backhand" options={BACKHANDS} {...register('backhand')} />
      <Select label="Preferred format" options={FORMATS} {...register('preferredFormat')} />
      <Select label="Rating system" options={SYSTEMS} {...register('ratingSystem')} />

      {ratingSystem && ratingSystem !== 'none' ? (
        <Field
          label="Rating value"
          hint="For example 4.0, or 7.5 for UTR."
          error={errors.ratingValue?.message}
          {...register('ratingValue')}
        />
      ) : null}

      <Field label="Racquet" error={errors.racquet?.message} {...register('racquet')} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium text-night-700">
          About you
        </label>
        <textarea
          id="bio"
          rows={3}
          maxLength={500}
          className="rounded-card border border-line bg-white p-3 text-base"
          {...register('bio')}
        />
      </div>

      {errors.root ? (
        <p role="alert" className="text-xs font-medium text-clay-600">
          {errors.root.message}
        </p>
      ) : null}

      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
```

The rating value input only exists once a system is chosen, which makes the API's "value requires a system" rule unreachable through normal use instead of merely rejected.

- [ ] **Step 5: Implement Setup**

`apps/web/src/screens/Setup.tsx`:

```tsx
import { useNavigate } from 'react-router'
import { ProfileForm } from '../components/ProfileForm.js'
import { Card } from '../components/Card.js'

export function Component() {
  const navigate = useNavigate()
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="font-display text-2xl tracking-tight">Set up your profile</h1>
      <p className="mt-2 text-sm text-night-700/80">
        Your name is the only thing we need. Everything else is optional and you can change it any time.
      </p>
      <Card className="mt-6">
        <ProfileForm mode="create" submitLabel="Save profile" onSaved={() => navigate('/', { replace: true })} />
      </Card>
    </main>
  )
}
```

- [ ] **Step 6: Run the tests, then commit**

Run: `npm test --workspace @tennis/web` → PASS (7 new tests).

```bash
git add -A
git commit -m "feat: add login and profile setup screens"
git push
```

---

### Task 15: Roster and player detail screens

**Files:**
- Create: `apps/web/src/screens/Roster.tsx`, `apps/web/src/screens/Player.tsx`, `apps/web/src/components/AvailabilityGrid.tsx`
- Test: `apps/web/test/Roster.test.tsx`

**Interfaces:**
- Produces: `<AvailabilityGrid slots readOnly onChange? />` — the same component renders read-only on a player page and editable on `/me`, which is why it lands here rather than in Task 16.

- [ ] **Step 1: Write the failing Roster test**

`apps/web/test/Roster.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Component as Roster } from '../src/screens/Roster.js'

const ME = { id: 1, email: 'me@example.com', role: 'player', hasProfile: true }

const ROSTER = [
  { id: 1, email: 'me@example.com', role: 'player', status: 'active', displayName: 'Me', nickname: null, photoUrl: null, preferredFormat: 'singles', ratingSystem: 'ntrp', ratingValue: '4.0' },
  { id: 2, email: 'pending@example.com', role: 'player', status: 'invited', displayName: null, nickname: null, photoUrl: null, preferredFormat: null, ratingSystem: 'none', ratingValue: null },
]

const renderRoster = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Routes>
          <Route element={<div />}>
            <Route path="*" element={<Roster />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

afterEach(() => vi.restoreAllMocks())

function mockApi(roster = ROSTER) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const body = url.includes('/api/members') ? roster : ME
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>()
  return { ...actual, useOutletContext: () => ME }
})

describe('Roster', () => {
  it('lists teammates with their rating', async () => {
    mockApi()
    renderRoster()
    expect(await screen.findByText('Me')).toBeTruthy()
    expect(screen.getByText(/NTRP 4\.0/i)).toBeTruthy()
  })

  it('marks a member who has not signed in yet as pending', async () => {
    mockApi()
    renderRoster()
    expect(await screen.findByText(/pending/i)).toBeTruthy()
    // Falls back to the address when no display name exists yet.
    expect(screen.getByText('pending@example.com')).toBeTruthy()
  })

  it('filters as you type', async () => {
    mockApi()
    renderRoster()
    await screen.findByText('Me')
    await userEvent.type(screen.getByLabelText(/search/i), 'pending')
    expect(screen.queryByText('Me')).toBeNull()
    expect(screen.getByText('pending@example.com')).toBeTruthy()
  })

  it('reports an empty roster rather than showing a blank page', async () => {
    mockApi([])
    renderRoster()
    expect(await screen.findByText(/no teammates yet/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Implement Roster**

`apps/web/src/screens/Roster.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { RosterEntry } from '@tennis/contracts'
import { useRoster } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Avatar } from '../components/Avatar.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { Field } from '../components/Field.js'
import { Spinner } from '../components/Spinner.js'

const nameOf = (m: RosterEntry) => m.displayName ?? m.email
const ratingOf = (m: RosterEntry) =>
  m.ratingSystem !== 'none' && m.ratingValue ? `${m.ratingSystem.toUpperCase()} ${m.ratingValue}` : null

function RosterRow({ member }: { member: RosterEntry }) {
  const rating = ratingOf(member)
  const detail = [rating, member.preferredFormat].filter(Boolean).join(' · ')

  return (
    <li>
      <Link
        to={`/players/${member.id}`}
        className="flex items-center gap-3 rounded-card p-3 hover:bg-clay-50"
      >
        <Avatar name={nameOf(member)} url={member.photoUrl} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{nameOf(member)}</span>
            {member.nickname ? (
              <span className="truncate text-xs text-night-700/60">“{member.nickname}”</span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-night-700/70">{detail || 'No details yet'}</span>
        </span>
        {member.status === 'invited' ? (
          <span className="rounded-full bg-clay-100 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-clay-600">
            Pending
          </span>
        ) : null}
      </Link>
    </li>
  )
}

export function Component() {
  const { data, isPending, isError, refetch } = useRoster()
  const [term, setTerm] = useState('')

  const visible = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((m) =>
      [m.displayName, m.nickname, m.email].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [data, term])

  return (
    <AppShell title="Roster">
      {isPending ? <Spinner label="Loading the roster" /> : null}
      {isError ? <ErrorState message="Could not load the roster." onRetry={() => void refetch()} /> : null}

      {data ? (
        data.length === 0 ? (
          <Card>
            <p className="text-sm">No teammates yet. Ask an admin to send some invitations.</p>
          </Card>
        ) : (
          <>
            <Field
              label="Search"
              type="search"
              placeholder="Name or email"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <p className="mt-4 text-xs text-night-700/60">
              {visible.length} of {data.length}
            </p>
            <ul className="mt-1 divide-y divide-line">
              {visible.map((m) => (
                <RosterRow key={m.id} member={m} />
              ))}
            </ul>
          </>
        )
      ) : null}
    </AppShell>
  )
}
```

- [ ] **Step 3: Implement the availability grid**

`apps/web/src/components/AvailabilityGrid.tsx`:

```tsx
import { BLOCKS, WEEKDAY_LABELS, type AvailabilityGrid as Grid, type Slot } from '@tennis/contracts'

const keyOf = (weekday: number, block: string) => `${weekday}:${block}`

interface Props {
  slots: Grid
  onChange?: (next: Grid) => void
  disabled?: boolean
}

/**
 * 7 x 3 grid. Read-only when no onChange is supplied, which is how the player
 * page and the edit page share one component.
 */
export function AvailabilityGrid({ slots, onChange, disabled }: Props) {
  const selected = new Set(slots.map((s) => keyOf(s.weekday, s.block)))
  const readOnly = !onChange

  const toggle = (weekday: number, block: Slot['block']) => {
    const key = keyOf(weekday, block)
    const next = selected.has(key)
      ? slots.filter((s) => keyOf(s.weekday, s.block) !== key)
      : [...slots, { weekday, block }]
    onChange?.(next)
  }

  return (
    <div role="group" aria-label="Weekly availability" className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-separate border-spacing-1 text-center">
        <thead>
          <tr>
            <th className="w-16" />
            {WEEKDAY_LABELS.map((d) => (
              <th key={d} scope="col" className="text-xs font-semibold text-night-700/70">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((block) => (
            <tr key={block}>
              <th scope="row" className="text-right text-xs font-medium capitalize text-night-700/70">
                {block}
              </th>
              {WEEKDAY_LABELS.map((label, weekday) => {
                const on = selected.has(keyOf(weekday, block))
                const description = `${label} ${block}`
                return (
                  <td key={label}>
                    {readOnly ? (
                      <span
                        className={`block h-9 rounded-card ${on ? 'bg-court-500' : 'bg-line/60'}`}
                        title={`${description}: ${on ? 'available' : 'not available'}`}
                      >
                        <span className="sr-only">{`${description}: ${on ? 'available' : 'not available'}`}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={description}
                        disabled={disabled}
                        onClick={() => toggle(weekday, block)}
                        className={`h-11 w-full rounded-card transition-colors disabled:opacity-50 ${
                          on ? 'bg-court-500 text-chalk' : 'bg-line/60 hover:bg-line'
                        }`}
                      >
                        <span aria-hidden="true">{on ? '✓' : ''}</span>
                      </button>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Cells are 44px (`h-11`) in the editable variant and only 36px read-only — nothing is tapped in the read-only view, so the taller target is not needed there.

- [ ] **Step 4: Implement Player detail**

`apps/web/src/screens/Player.tsx`:

```tsx
import { useParams } from 'react-router'
import { useAvailability, usePlayer } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Avatar } from '../components/Avatar.js'
import { AvailabilityGrid } from '../components/AvailabilityGrid.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { Spinner } from '../components/Spinner.js'

const HAND = { left: 'Left-handed', right: 'Right-handed' } as const
const BACK = { one: 'One-handed backhand', two: 'Two-handed backhand' } as const

export function Component() {
  const id = Number(useParams().id)
  const player = usePlayer(id)
  const availability = useAvailability(id)

  if (player.isPending) {
    return (
      <AppShell title="Player">
        <Spinner label="Loading player" />
      </AppShell>
    )
  }
  if (player.isError || !player.data) {
    return (
      <AppShell title="Player">
        <ErrorState message="That player could not be found." onRetry={() => void player.refetch()} />
      </AppShell>
    )
  }

  const p = player.data
  const facts = [
    p.dominantHand ? HAND[p.dominantHand] : null,
    p.backhand ? BACK[p.backhand] : null,
    p.preferredFormat ? `Prefers ${p.preferredFormat}` : null,
    p.ratingSystem !== 'none' && p.ratingValue ? `${p.ratingSystem.toUpperCase()} ${p.ratingValue}` : null,
    p.racquet,
  ].filter(Boolean) as string[]

  return (
    <AppShell title={p.displayName}>
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={p.displayName} url={p.photoUrl} size={72} />
            <div className="min-w-0">
              <p className="font-display text-xl">{p.displayName}</p>
              {p.nickname ? <p className="text-sm text-night-700/70">“{p.nickname}”</p> : null}
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="mt-1 inline-block text-sm text-clay-600 underline">
                  {p.phone}
                </a>
              ) : null}
            </div>
          </div>
          {p.bio ? <p className="mt-4 text-sm leading-relaxed">{p.bio}</p> : null}
        </Card>

        <Card>
          <h2 className="font-display text-lg">Record</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            {[
              ['Played', p.record.matchesPlayed],
              ['Won', p.record.wins],
              ['Lost', p.record.losses],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-card bg-clay-50 py-3">
                <dt className="text-xs uppercase tracking-wide text-night-700/60">{label}</dt>
                <dd className="font-display text-2xl">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {facts.length > 0 ? (
          <Card>
            <h2 className="font-display text-lg">Game</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {facts.map((f) => (
                <li key={f} className="rounded-full bg-line/60 px-3 py-1 text-xs font-medium">
                  {f}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="font-display text-lg">Usually available</h2>
          <div className="mt-3">
            {availability.isPending ? (
              <Spinner label="Loading availability" />
            ) : (
              <AvailabilityGrid slots={availability.data ?? []} />
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 5: Run the tests, then commit**

Run: `npm test --workspace @tennis/web` → PASS (4 new tests).

```bash
git add -A
git commit -m "feat: add roster and player detail screens with availability grid"
git push
```

---

### Task 16: The "Me" screen — profile, photo, availability

**Files:**
- Create: `apps/web/src/screens/Me.tsx`, `apps/web/src/components/PhotoPicker.tsx`
- Test: `apps/web/test/PhotoPicker.test.tsx`, `apps/web/test/Me.test.tsx`

**Interfaces:**
- Produces: `<PhotoPicker currentUrl name />`, which owns the presign → upload → confirm sequence and its own error state.

- [ ] **Step 1: Write the failing PhotoPicker test**

`apps/web/test/PhotoPicker.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PHOTO_MAX_BYTES } from '@tennis/contracts'
import { PhotoPicker } from '../src/components/PhotoPicker.js'

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <PhotoPicker name="Ace" currentUrl={null} />
    </QueryClientProvider>,
  )

const file = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

afterEach(() => vi.restoreAllMocks())

describe('PhotoPicker', () => {
  it('rejects an oversized file locally, before any request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    wrap()
    await userEvent.upload(screen.getByLabelText(/photo/i), file('big.jpg', 'image/jpeg', PHOTO_MAX_BYTES + 1))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/5 ?MB/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an unsupported type locally', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    wrap()
    await userEvent.upload(screen.getByLabelText(/photo/i), file('anim.gif', 'image/gif', 1000))
    expect((await screen.findByRole('alert')).textContent).toMatch(/jpeg, png or webp/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('runs presign, upload, and confirm in order', async () => {
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/photo')) {
        return new Response(
          JSON.stringify({ uploadUrl: 'https://store.local/up', key: 'photos/1/upload-x', maxBytes: PHOTO_MAX_BYTES }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ id: 1, displayName: 'Ace', photoUrl: 'https://store.local/final' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    wrap()
    await userEvent.upload(screen.getByLabelText(/photo/i), file('me.jpg', 'image/jpeg', 5000))
    await vi.waitFor(() =>
      expect(calls).toEqual([
        'POST /api/players/me/photo',
        'PUT https://store.local/up',
        'PUT /api/players/me/photo/confirm',
      ]),
    )
  })
})
```

- [ ] **Step 2: Implement PhotoPicker**

`apps/web/src/components/PhotoPicker.tsx`:

```tsx
import { useRef, useState } from 'react'
import { PHOTO_CONTENT_TYPES, PHOTO_MAX_BYTES } from '@tennis/contracts'
import { useUploadPhoto } from '../api/queries.js'
import { Avatar } from './Avatar.js'
import { Button } from './Button.js'

const ACCEPT = PHOTO_CONTENT_TYPES.join(',')

export function PhotoPicker({ name, currentUrl }: { name: string; currentUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const upload = useUploadPhoto()

  function onPick(file: File | undefined) {
    setLocalError(null)
    if (!file) return
    // Check locally first: rejecting a 12 MB file after uploading it is rude.
    if (!PHOTO_CONTENT_TYPES.includes(file.type as (typeof PHOTO_CONTENT_TYPES)[number])) {
      setLocalError('Photos must be JPEG, PNG or WebP.')
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setLocalError('That photo is larger than 5 MB. Try a smaller one.')
      return
    }
    upload.mutate(file, { onSettled: () => input.current && (input.current.value = '') })
  }

  const error = localError ?? (upload.isError ? 'Upload failed. Check your connection and try again.' : null)

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} url={upload.data?.photoUrl ?? currentUrl} size={72} />
      <div className="flex flex-col items-start gap-1">
        <label htmlFor="photo" className="text-sm font-medium text-night-700">
          Profile photo
        </label>
        <input
          ref={input}
          id="photo"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : currentUrl ? 'Change photo' : 'Add a photo'}
        </Button>
        <p className="text-xs text-night-700/60">JPEG, PNG or WebP, up to 5 MB. Location data is removed.</p>
        {error ? (
          <p role="alert" className="text-xs font-medium text-clay-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
```

Saying "Location data is removed" out loud is the point of doing it.

- [ ] **Step 3: Write the failing Me test**

`apps/web/test/Me.test.tsx` — assert three behaviours: the availability grid saves on toggle and shows a saved confirmation; a failed availability save surfaces an alert and keeps the toggled state visible; and the logout button clears the query cache. Use the same `vi.mock('react-router')` outlet-context pattern as `Roster.test.tsx`, and mock `fetch` per URL as in `PhotoPicker.test.tsx`.

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Component as Me } from '../src/screens/Me.js'

const ME = { id: 1, email: 'me@example.com', role: 'player', hasProfile: true }
const PROFILE = {
  id: 1, role: 'player', displayName: 'Ace', nickname: null, phone: null, photoUrl: null,
  dominantHand: 'right', backhand: 'two', preferredFormat: 'singles', ratingSystem: 'none',
  ratingValue: null, racquet: null, bio: null, record: { matchesPlayed: 0, wins: 0, losses: 0 },
}

vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>()
  return { ...actual, useOutletContext: () => ME }
})

const renderMe = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <Me />
      </MemoryRouter>
    </QueryClientProvider>,
  )

function api(overrides: (url: string, method: string) => Response | undefined = () => undefined) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const custom = overrides(url, method)
    if (custom) return custom
    const body = url.includes('/availability') ? [] : url.includes('/players/') ? PROFILE : ME
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Me', () => {
  it('saves availability when a slot is toggled', async () => {
    const saved: unknown[] = []
    api((url, method) => {
      if (url.endsWith('/api/players/me/availability') && method === 'PUT') {
        saved.push(url)
        return new Response(JSON.stringify([{ weekday: 6, block: 'morning' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return undefined
    })
    renderMe()
    await userEvent.click(await screen.findByRole('switch', { name: /sat morning/i }))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(await screen.findByText(/saved/i)).toBeTruthy()
  })

  it('reports a failed availability save', async () => {
    api((url, method) =>
      url.endsWith('/api/players/me/availability') && method === 'PUT'
        ? new Response(JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        : undefined,
    )
    renderMe()
    await userEvent.click(await screen.findByRole('switch', { name: /sat morning/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save/i)
  })
})
```

- [ ] **Step 4: Implement Me**

`apps/web/src/screens/Me.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { AvailabilityGrid as Grid, MeResponse } from '@tennis/contracts'
import { useAvailability, useLogout, usePlayer, useSaveAvailability } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { AvailabilityGrid } from '../components/AvailabilityGrid.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { PhotoPicker } from '../components/PhotoPicker.js'
import { ProfileForm } from '../components/ProfileForm.js'
import { Spinner } from '../components/Spinner.js'

function AvailabilityCard({ memberId }: { memberId: number }) {
  const query = useAvailability(memberId)
  const save = useSaveAvailability(memberId)
  // Optimistic local copy so the grid responds instantly on a slow connection.
  const [draft, setDraft] = useState<Grid | null>(null)
  const slots = draft ?? query.data ?? []

  function onChange(next: Grid) {
    setDraft(next)
    save.mutate(next, { onSuccess: () => setDraft(null) })
  }

  return (
    <Card>
      <h2 className="font-display text-lg">When you can usually play</h2>
      <p className="mt-1 text-xs text-night-700/70">Tap a slot to toggle it. Saves as you go.</p>
      <div className="mt-3">
        {query.isPending ? (
          <Spinner label="Loading your availability" />
        ) : (
          <AvailabilityGrid slots={slots} onChange={onChange} disabled={save.isPending} />
        )}
      </div>
      <p className="mt-2 min-h-4 text-xs" aria-live="polite">
        {save.isPending ? 'Saving…' : save.isSuccess && !draft ? 'Saved' : ''}
      </p>
      {save.isError ? (
        <p role="alert" className="text-xs font-medium text-clay-600">
          Could not save your availability. It will still be here when you try again.
        </p>
      ) : null}
    </Card>
  )
}

export function Component() {
  const me = useOutletContext<MeResponse>()
  const navigate = useNavigate()
  const profile = usePlayer(me.id)
  const logout = useLogout()

  if (profile.isPending) {
    return (
      <AppShell title="You">
        <Spinner label="Loading your profile" />
      </AppShell>
    )
  }
  if (profile.isError || !profile.data) {
    return (
      <AppShell title="You">
        <ErrorState message="Could not load your profile." onRetry={() => void profile.refetch()} />
      </AppShell>
    )
  }

  const p = profile.data

  return (
    <AppShell title="You">
      <div className="flex flex-col gap-4">
        <Card>
          <PhotoPicker name={p.displayName} currentUrl={p.photoUrl} />
        </Card>

        <AvailabilityCard memberId={me.id} />

        <Card>
          <h2 className="font-display text-lg">Your details</h2>
          <div className="mt-3">
            <ProfileForm
              mode="update"
              submitLabel="Save changes"
              onSaved={() => void profile.refetch()}
              defaultValues={{
                displayName: p.displayName,
                nickname: p.nickname ?? undefined,
                phone: p.phone ?? undefined,
                dominantHand: p.dominantHand ?? undefined,
                backhand: p.backhand ?? undefined,
                preferredFormat: p.preferredFormat ?? undefined,
                ratingSystem: p.ratingSystem,
                ratingValue: p.ratingValue ?? undefined,
                racquet: p.racquet ?? undefined,
                bio: p.bio ?? undefined,
              }}
            />
          </div>
        </Card>

        <Button
          variant="danger"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })}
        >
          Sign out
        </Button>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 5: Run the tests, then commit**

Run: `npm test --workspace @tennis/web` → PASS (5 new tests).

```bash
git add -A
git commit -m "feat: add the me screen with photo upload and availability editing"
git push
```

---

### Task 17: Match list and record-a-match screens

**Files:**
- Create: `apps/web/src/screens/Matches.tsx`, `apps/web/src/screens/RecordMatch.tsx`
- Test: `apps/web/test/RecordMatch.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/test/RecordMatch.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Component as RecordMatch } from '../src/screens/RecordMatch.js'

const ME = { id: 1, email: 'me@example.com', role: 'player', hasProfile: true }
const ROSTER = [
  { id: 1, email: 'me@example.com', role: 'player', status: 'active', displayName: 'Me', nickname: null, photoUrl: null, preferredFormat: null, ratingSystem: 'none', ratingValue: null },
  { id: 2, email: 'them@example.com', role: 'player', status: 'active', displayName: 'Them', nickname: null, photoUrl: null, preferredFormat: null, ratingSystem: 'none', ratingValue: null },
]

vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>()
  return { ...actual, useOutletContext: () => ME, useNavigate: () => vi.fn() }
})

const renderScreen = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <RecordMatch />
      </MemoryRouter>
    </QueryClientProvider>,
  )

function api(capture?: (body: unknown) => void) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/matches') && init?.method === 'POST') {
      capture?.(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: 9 }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    const body = url.includes('/api/members') ? ROSTER : ME
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

afterEach(() => vi.restoreAllMocks())

describe('RecordMatch', () => {
  it('submits a singles match with the derived winner', async () => {
    let sent: unknown
    api((b) => (sent = b))
    renderScreen()

    await userEvent.selectOptions(await screen.findByLabelText(/your opponent/i), '2')
    await userEvent.type(screen.getByLabelText(/set 1 — your games/i), '6')
    await userEvent.type(screen.getByLabelText(/set 1 — their games/i), '4')
    await userEvent.type(screen.getByLabelText(/set 2 — your games/i), '6')
    await userEvent.type(screen.getByLabelText(/set 2 — their games/i), '2')
    await userEvent.click(screen.getByRole('button', { name: /save match/i }))

    await vi.waitFor(() => expect(sent).toBeDefined())
    expect(sent).toMatchObject({
      format: 'singles',
      winnerSide: 1,
      side1: [{ memberId: 1 }],
      side2: [{ memberId: 2 }],
      sets: [
        { side1Games: 6, side2Games: 4 },
        { side1Games: 6, side2Games: 2 },
      ],
    })
  })

  it('derives a loss when the opponent wins more sets', async () => {
    let sent: { winnerSide?: number } | undefined
    api((b) => (sent = b as { winnerSide?: number }))
    renderScreen()

    await userEvent.selectOptions(await screen.findByLabelText(/your opponent/i), '2')
    await userEvent.type(screen.getByLabelText(/set 1 — your games/i), '3')
    await userEvent.type(screen.getByLabelText(/set 1 — their games/i), '6')
    await userEvent.type(screen.getByLabelText(/set 2 — your games/i), '4')
    await userEvent.type(screen.getByLabelText(/set 2 — their games/i), '6')
    await userEvent.click(screen.getByRole('button', { name: /save match/i }))

    await vi.waitFor(() => expect(sent?.winnerSide).toBe(2))
  })

  it('refuses to submit without an opponent', async () => {
    api()
    renderScreen()
    await screen.findByLabelText(/your opponent/i)
    await userEvent.click(screen.getByRole('button', { name: /save match/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/opponent/i)
  })

  it('refuses a tied set count', async () => {
    api()
    renderScreen()
    await userEvent.selectOptions(await screen.findByLabelText(/your opponent/i), '2')
    await userEvent.type(screen.getByLabelText(/set 1 — your games/i), '6')
    await userEvent.type(screen.getByLabelText(/set 1 — their games/i), '4')
    await userEvent.type(screen.getByLabelText(/set 2 — your games/i), '4')
    await userEvent.type(screen.getByLabelText(/set 2 — their games/i), '6')
    await userEvent.click(screen.getByRole('button', { name: /save match/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/who won/i)
  })
})
```

- [ ] **Step 2: Implement RecordMatch**

`apps/web/src/screens/RecordMatch.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { CreateMatchBody, MatchPlayerInput, MeResponse } from '@tennis/contracts'
import { ApiError } from '../api/client.js'
import { useRecordMatch, useRoster } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { Field } from '../components/Field.js'
import { Spinner } from '../components/Spinner.js'

const GUEST = 'guest'
const today = () => new Date().toISOString().slice(0, 10)

interface SetRow {
  mine: string
  theirs: string
}

export function Component() {
  const me = useOutletContext<MeResponse>()
  const navigate = useNavigate()
  const roster = useRoster()
  const record = useRecordMatch()

  const [playedOn, setPlayedOn] = useState(today())
  const [opponent, setOpponent] = useState('')
  const [guestName, setGuestName] = useState('')
  const [venue, setVenue] = useState('')
  const [sets, setSets] = useState<SetRow[]>([
    { mine: '', theirs: '' },
    { mine: '', theirs: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  const others = (roster.data ?? []).filter((m) => m.id !== me.id && m.status === 'active')

  function build(): CreateMatchBody | string {
    if (!opponent) return 'Choose your opponent.'
    const side2: MatchPlayerInput[] =
      opponent === GUEST
        ? guestName.trim()
          ? [{ guestName: guestName.trim() }]
          : []
        : [{ memberId: Number(opponent) }]
    if (side2.length === 0) return 'Enter the name of your guest opponent.'

    const played = sets
      .map((s) => ({ side1Games: Number(s.mine), side2Games: Number(s.theirs) }))
      .filter((s) => s.mine !== '' || true)
      .filter((_, i) => sets[i]!.mine !== '' && sets[i]!.theirs !== '')
    if (played.length === 0) return 'Enter the score for at least one set.'

    const mineWon = played.filter((s) => s.side1Games > s.side2Games).length
    const theirsWon = played.length - mineWon
    if (mineWon === theirsWon) return 'The sets are level, so we cannot tell who won. Add the deciding set.'

    return {
      playedOn,
      format: 'singles',
      venue: venue.trim() || null,
      winnerSide: mineWon > theirsWon ? 1 : 2,
      side1: [{ memberId: me.id }],
      side2,
      sets: played,
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const built = build()
    if (typeof built === 'string') {
      setError(built)
      return
    }
    try {
      await record.mutateAsync(built)
      navigate('/matches', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the match. Please try again.')
    }
  }

  if (roster.isPending) {
    return (
      <AppShell title="Record a match">
        <Spinner label="Loading the roster" />
      </AppShell>
    )
  }

  return (
    <AppShell title="Record a match">
      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Date played" type="date" max={today()} value={playedOn} onChange={(e) => setPlayedOn(e.target.value)} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="opponent" className="text-sm font-medium text-night-700">
              Your opponent
            </label>
            <select
              id="opponent"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              className="tap-target rounded-card border border-line bg-white px-3 text-base"
            >
              <option value="">Choose someone…</option>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName ?? m.email}
                </option>
              ))}
              <option value={GUEST}>Someone outside the team…</option>
            </select>
          </div>

          {opponent === GUEST ? (
            <Field label="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          ) : null}

          <Field label="Venue" placeholder="Optional" value={venue} onChange={(e) => setVenue(e.target.value)} />

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-night-700">Score</legend>
            {sets.map((s, i) => (
              <div key={i} className="grid grid-cols-2 gap-3">
                <Field
                  label={`Set ${i + 1} — your games`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={s.mine}
                  onChange={(e) =>
                    setSets(sets.map((row, j) => (j === i ? { ...row, mine: e.target.value } : row)))
                  }
                />
                <Field
                  label={`Set ${i + 1} — their games`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={s.theirs}
                  onChange={(e) =>
                    setSets(sets.map((row, j) => (j === i ? { ...row, theirs: e.target.value } : row)))
                  }
                />
              </div>
            ))}
            {sets.length < 5 ? (
              <Button variant="ghost" type="button" onClick={() => setSets([...sets, { mine: '', theirs: '' }])}>
                Add another set
              </Button>
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="text-xs font-medium text-clay-600">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={record.isPending}>
            {record.isPending ? 'Saving…' : 'Save match'}
          </Button>
        </form>
      </Card>
    </AppShell>
  )
}
```

The winner is derived from the set scores rather than asked for. One less field, and it cannot disagree with the score you just typed.

Doubles is deliberately not offered on this form: the API supports it, and adding a partner picker here is a natural follow-up, but nothing in Phase 1's definition of done requires it. Note this in the commit message so it is a known gap rather than an oversight.

- [ ] **Step 3: Implement Matches**

`apps/web/src/screens/Matches.tsx`:

```tsx
import { Link } from 'react-router'
import type { MatchDetail } from '@tennis/contracts'
import { useMatches } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { Spinner } from '../components/Spinner.js'

const names = (side: MatchDetail['side1']) => side.map((p) => p.displayName).join(' & ')
const score = (m: MatchDetail) => m.sets.map((s) => `${s.side1Games}–${s.side2Games}`).join(', ')

function MatchCard({ match }: { match: MatchDetail }) {
  const winners = match.winnerSide === 1 ? match.side1 : match.side2
  const losers = match.winnerSide === 1 ? match.side2 : match.side1
  return (
    <li>
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-night-700/60">
            {new Date(`${match.playedOn}T00:00:00`).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
          <p className="text-xs text-night-700/60">{match.format}</p>
        </div>
        <p className="mt-2 text-sm">
          <span className="font-semibold">{names(winners)}</span>
          <span className="text-night-700/60"> beat </span>
          <span>{names(losers)}</span>
        </p>
        <p className="mt-1 font-display text-lg tabular-nums">{score(match)}</p>
        {match.venue ? <p className="mt-1 text-xs text-night-700/60">{match.venue}</p> : null}
      </Card>
    </li>
  )
}

export function Component() {
  const { data, isPending, isError, refetch } = useMatches()

  return (
    <AppShell title="Matches">
      <Link to="/matches/new">
        <Button className="w-full">Record a match</Button>
      </Link>

      <div className="mt-5">
        {isPending ? <Spinner label="Loading matches" /> : null}
        {isError ? <ErrorState message="Could not load matches." onRetry={() => void refetch()} /> : null}
        {data ? (
          data.items.length === 0 ? (
            <Card>
              <p className="text-sm">No matches recorded yet. Play one, then come back and log it.</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.items.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </ul>
          )
        ) : null}
      </div>
    </AppShell>
  )
}
```

The score always reads side-1-first, and the sentence above it names who actually won, so a `6–4, 3–6, 6–2` loss can never be misread as a win.

- [ ] **Step 4: Run the tests, then commit**

Run: `npm test --workspace @tennis/web` → PASS (4 new tests).

```bash
git add -A
git commit -m "feat: add match list and singles match recording

Doubles recording is supported by the API but not yet exposed in the form."
git push
```

---

### Task 18: Admin screen

**Files:**
- Create: `apps/web/src/screens/Admin.tsx`
- Test: `apps/web/test/Admin.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/test/Admin.test.tsx` — assert: a player is redirected away; an admin can invite; the last-admin `409` is shown as a readable explanation rather than a generic error; and removal asks for confirmation first.

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Component as Admin } from '../src/screens/Admin.js'

const ADMIN = { id: 1, email: 'admin@example.com', role: 'admin', hasProfile: true }
const ROSTER = [
  { id: 1, email: 'admin@example.com', role: 'admin', status: 'active', displayName: 'Boss', nickname: null, photoUrl: null, preferredFormat: null, ratingSystem: 'none', ratingValue: null },
  { id: 2, email: 'pending@example.com', role: 'player', status: 'invited', displayName: null, nickname: null, photoUrl: null, preferredFormat: null, ratingSystem: 'none', ratingValue: null },
]

let context = ADMIN
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>()
  return { ...actual, useOutletContext: () => context, Navigate: ({ to }: { to: string }) => <p>redirected to {to}</p> }
})

const renderAdmin = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <Admin />
      </MemoryRouter>
    </QueryClientProvider>,
  )

function api(handler: (url: string, method: string) => Response | undefined = () => undefined) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const custom = handler(String(input), init?.method ?? 'GET')
    if (custom) return custom
    const body = String(input).includes('/api/members') ? ROSTER : ADMIN
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

afterEach(() => {
  context = ADMIN
  vi.restoreAllMocks()
})

describe('Admin', () => {
  it('turns a player away', async () => {
    context = { ...ADMIN, role: 'player' }
    api()
    renderAdmin()
    expect(await screen.findByText(/redirected to \//i)).toBeTruthy()
  })

  it('invites a teammate', async () => {
    let sent: unknown
    api((url, method) => {
      if (url.endsWith('/api/members') && method === 'POST') {
        return new Response(JSON.stringify({ id: 3 }), { status: 201, headers: { 'content-type': 'application/json' } })
      }
      return undefined
    })
    const spy = vi.spyOn(globalThis, 'fetch')
    renderAdmin()
    await userEvent.type(await screen.findByLabelText(/email/i), 'newbie@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }))
    await vi.waitFor(() => {
      sent = spy.mock.calls.find(([, init]) => init?.method === 'POST')
      expect(sent).toBeDefined()
    })
  })

  it('explains the last-admin refusal in plain language', async () => {
    api((url, method) =>
      method === 'PATCH'
        ? new Response(
            JSON.stringify({ error: { code: 'last_admin', message: 'The team must keep at least one active admin' } }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          )
        : undefined,
    )
    renderAdmin()
    await userEvent.click(await screen.findByRole('button', { name: /make player/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least one/i)
  })
})
```

- [ ] **Step 2: Implement Admin**

`apps/web/src/screens/Admin.tsx`:

```tsx
import { useState } from 'react'
import { Navigate, useOutletContext } from 'react-router'
import { useForm } from 'react-hook-form'
import { typeboxResolver } from '@hookform/resolvers/typebox'
import { InviteBody, type InviteBody as Body, type MeResponse, type RosterEntry } from '@tennis/contracts'
import { ApiError } from '../api/client.js'
import {
  useInviteMember,
  useRemoveMember,
  useResendInvite,
  useRoster,
  useSetRole,
} from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { Field } from '../components/Field.js'
import { Spinner } from '../components/Spinner.js'

export function Component() {
  const me = useOutletContext<MeResponse>()
  const roster = useRoster()
  const invite = useInviteMember()
  const setRole = useSetRole()
  const remove = useRemoveMember()
  const resend = useResendInvite()
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Body>({ resolver: typeboxResolver(InviteBody) })

  if (me.role !== 'admin') return <Navigate to="/" replace />

  function run(action: Promise<unknown>, success: string) {
    setNotice(null)
    setProblem(null)
    action.then(
      () => setNotice(success),
      (err: unknown) =>
        setProblem(err instanceof ApiError ? err.message : 'That did not work. Please try again.'),
    )
  }

  function MemberRow({ m }: { m: RosterEntry }) {
    const isMe = m.id === me.id
    return (
      <li className="flex flex-wrap items-center gap-2 border-b border-line py-3 last:border-0">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{m.displayName ?? m.email}</span>
          <span className="block truncate text-xs text-night-700/60">
            {m.email} · {m.role}
            {m.status === 'invited' ? ' · invitation pending' : ''}
          </span>
        </span>

        {m.status === 'invited' ? (
          <Button variant="ghost" onClick={() => run(resend.mutateAsync(m.id), 'Invitation resent.')}>
            Resend
          </Button>
        ) : null}

        <Button
          variant="secondary"
          onClick={() =>
            run(
              setRole.mutateAsync({ id: m.id, role: m.role === 'admin' ? 'player' : 'admin' }),
              m.role === 'admin' ? 'Now a player.' : 'Now an admin.',
            )
          }
        >
          {m.role === 'admin' ? 'Make player' : 'Make admin'}
        </Button>

        <Button
          variant="danger"
          onClick={() => {
            const label = m.displayName ?? m.email
            // A removal signs them out immediately, so confirm before doing it.
            if (!window.confirm(`Remove ${label} from the team? They will be signed out straight away.`)) return
            run(remove.mutateAsync(m.id), `${label} removed.`)
          }}
        >
          {isMe ? 'Remove me' : 'Remove'}
        </Button>
      </li>
    )
  }

  return (
    <AppShell title="Admin">
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="font-display text-lg">Invite a teammate</h2>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={handleSubmit((values) =>
              run(invite.mutateAsync(values).then(() => reset()), `Invitation sent to ${values.email}.`),
            )}
            noValidate
          >
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="off"
              error={errors.email ? 'Enter a valid email address' : undefined}
              {...register('email')}
            />
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </form>
        </Card>

        {notice ? (
          <p role="status" className="rounded-card bg-court-500/10 p-3 text-sm">
            {notice}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="rounded-card bg-clay-50 p-3 text-sm font-medium text-clay-600">
            {problem}
          </p>
        ) : null}

        <Card>
          <h2 className="font-display text-lg">Team</h2>
          {roster.isPending ? <Spinner label="Loading the roster" /> : null}
          {roster.isError ? (
            <ErrorState message="Could not load the roster." onRetry={() => void roster.refetch()} />
          ) : null}
          <ul className="mt-2">{(roster.data ?? []).map((m) => <MemberRow key={m.id} m={m} />)}</ul>
        </Card>
      </div>
    </AppShell>
  )
}
```

The `409` from the last-admin guard reaches the user as the API's own sentence, which already reads as an explanation. That is why `AppError` messages were written as user-facing prose in Task 3.

- [ ] **Step 3: Run everything, then commit**

```bash
npm run typecheck && npm run lint && npm test
```

```bash
git add -A
git commit -m "feat: add admin screen for invitations, roles, and removal"
git push
```

---

### Task 19: Static serving, Docker image, CSP, and deployment

**Files:**
- Create: `apps/api/src/static.ts`, `Dockerfile`, `.dockerignore`, `docs/DEPLOY.md`
- Modify: `apps/api/src/app.ts` (CSP directives, static registration)
- Test: `apps/api/test/static.test.ts`

**Interfaces:**
- Produces: `registerStatic(app, deps): Promise<void>` — serves `apps/web/dist` and falls back to `index.html` for any non-`/api` path so client-side routes survive a hard refresh.

- [ ] **Step 1: Write the failing test**

`apps/api/test/static.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { describe, expect, it, beforeAll } from 'vitest'
import { buildTestApp, WEB_DIST } from './setup/harness.js'

beforeAll(async () => {
  // Stand in for a real Vite build.
  await mkdir(WEB_DIST, { recursive: true })
  await writeFile(`${WEB_DIST}/index.html`, '<!doctype html><title>Tennis Team</title>')
})

describe('static serving', () => {
  it('serves index.html at the root', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Tennis Team')
    })
  })

  it('falls back to index.html for a client route so a refresh works', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/players/42' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Tennis Team')
    })
  })

  it('still returns a JSON 404 for an unknown api path', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/nope' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: { code: 'not_found' } })
    })
  })

  it('sets a content security policy that permits the app and blocks inline script', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/' })
      const csp = res.headers['content-security-policy'] as string
      expect(csp).toContain("default-src 'self'")
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    })
  })
})
```

Export `WEB_DIST` from the harness as the resolved path to `apps/web/dist`.

- [ ] **Step 2: Implement static serving**

`apps/api/src/static.ts`:

```ts
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

const here = dirname(fileURLToPath(import.meta.url))
export const WEB_DIST = join(here, '../../web/dist')

export async function registerStatic(app: FastifyInstance): Promise<void> {
  if (!existsSync(WEB_DIST)) {
    app.log.warn({ dir: WEB_DIST }, 'client bundle not found; serving api only')
    return
  }

  await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false })

  // SPA fallback. /api and /health keep their JSON 404 so a typo in a fetch
  // does not silently return an HTML page that JSON.parse then chokes on.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'No such route' } })
    }
    return reply.sendFile('index.html')
  })
}
```

Call `await registerStatic(app)` as the LAST registration in `buildApp` — it replaces the not-found handler, so anything registered afterwards would not get the JSON 404.

Replace the `contentSecurityPolicy: false` from Task 3 with real directives:

```ts
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Emotion-free, but Tailwind's preflight is a stylesheet
        imgSrc: ["'self'", 'data:', 'https:'], // profile photos come from the object store
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: deps.config.nodeEnv === 'production' ? [] : null,
      },
    },
  })
```

- [ ] **Step 3: Write the Dockerfile**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN npm run typecheck
RUN npm run build --workspace @tennis/web

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# sharp needs its platform binaries; installing prod deps in the target image
# is what guarantees they match this architecture.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY db/migrations db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
```

`.dockerignore`:

```
node_modules
**/node_modules
**/dist
.git
.github
docs
e2e
playwright-report
test-results
*.log
.env
.env.*
```

- [ ] **Step 4: Verify the image locally**

```bash
docker build -t tennis-team .
docker run --rm --env-file .env -p 3000:3000 tennis-team node apps/api/dist/release.js
docker run --rm --env-file .env -p 3000:3000 tennis-team
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ | head -c 200
```

Expected: `{"status":"ok"}` and HTML containing `Tennis Team`.

- [ ] **Step 5: Write the deployment guide**

`docs/DEPLOY.md`:

```markdown
# Deploying

One container, one managed Postgres, one S3-compatible bucket.

## First deploy

1. Create the Postgres instance and copy its connection string.
2. Create a bucket (Cloudflare R2 or AWS S3) and an access key limited to it.
3. Verify a sending domain with the mail provider and create an API key.
4. Set every variable from `.env.example` on the service. `SESSION_SECRET` must be
   at least 32 random characters: `openssl rand -base64 48`.
5. Set `BOOTSTRAP_ADMIN_EMAIL` to your own address. This is the ONLY way in — with an
   empty members table, nobody can invite anybody.
6. Run the release command, then start the service:
   `node apps/api/dist/release.js` then `node apps/api/dist/index.js`.
7. Visit the site, request a link for `BOOTSTRAP_ADMIN_EMAIL`, and invite the team.

## Every deploy after

Run `node apps/api/dist/release.js` as a release step BEFORE the new container serves
traffic. It applies migrations and re-runs the admin bootstrap, which does nothing once
an admin exists.

## Operational notes

- `GET /health` pings the database; wire it to the platform health check.
- Managed Postgres backups do NOT cover the photo bucket. Set the bucket's own
  retention policy explicitly.
- `APP_ORIGIN` must exactly match the public URL, scheme included. Session cookies are
  marked `Secure` only when it starts with `https://`, and state-changing requests are
  rejected when the browser's `Origin` does not match it.
- Rotating `SESSION_SECRET` does not invalidate sessions — session tokens are random
  values stored hashed, not signed payloads. To sign everyone out, delete the rows in
  `sessions`.
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: serve the client from the api, add docker image and deploy guide"
git push
```

---

### Task 20: End-to-end journey and full CI

The last task, and the one that proves the whole thing works together rather than in units.

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/journey.spec.ts`, `apps/api/src/routes/test-only.ts`
- Modify: `apps/api/src/app.ts` (register test-only routes when `NODE_ENV=test`), `.github/workflows/ci.yml`, root `package.json`
- Test: `apps/api/test/test-only.test.ts`

**Interfaces:**
- Produces: `GET /api/test/last-token?email=…` returning `{ token }`, registered **only** when `config.nodeEnv === 'test'`; `npm run e2e` at the repo root.

- [ ] **Step 1: Write the failing guard test**

`apps/api/test/test-only.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { buildTestApp, testConfig, FakeMailer, FakeStore, withTx } from './setup/harness.js'

describe('test-only routes', () => {
  it('returns the most recent unconsumed token in test mode', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'tok@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: { origin: testConfig.appOrigin },
        payload: { email: 'tok@example.com' },
      })

      const res = await app.inject({ method: 'GET', url: '/api/test/last-token?email=tok@example.com' })
      expect(res.statusCode).toBe(200)
      expect(res.json().token).toEqual(new URL(ctx.mailer.last!.url).searchParams.get('token'))
    })
  })

  it('is absent outside test mode', async () => {
    await withTx(async (db) => {
      const app = await buildApp({
        db,
        config: { ...testConfig, nodeEnv: 'production' },
        mailer: new FakeMailer(),
        storage: new FakeStore(),
        now: () => new Date('2026-08-21T10:00:00Z'),
      })
      try {
        const res = await app.inject({ method: 'GET', url: '/api/test/last-token?email=a@b.c' })
        expect(res.statusCode).toBe(404)
      } finally {
        await app.close()
      }
    })
  })
})
```

- [ ] **Step 2: Implement the test-only route**

`apps/api/src/routes/test-only.ts`:

```ts
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { Deps } from '../app.js'
import { notFound } from '../plugins/error-handler.js'

const Query = Type.Object({ email: Type.String() })

/**
 * Lets the E2E suite complete a magic-link sign-in without a mailbox.
 * Registered ONLY when NODE_ENV=test — see the guard in buildApp.
 */
export async function testOnlyRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/api/test/last-token', { schema: { querystring: Query } }, async (req) => {
    const { email } = req.query as { email: string }
    const row = await deps.db
      .selectFrom('login_tokens as t')
      .innerJoin('members as m', 'm.id', 't.member_id')
      .select('t.id')
      .where('m.email', '=', email)
      .where('t.consumed_at', 'is', null)
      .orderBy('t.created_at', 'desc')
      .executeTakeFirst()
    if (!row) throw notFound('No pending token for that address')

    // The plaintext token is not stored, so the route re-derives nothing: it is
    // recorded alongside the hash ONLY in test mode.
    const plain = deps.testTokens?.get(row.id)
    if (!plain) throw notFound('No pending token for that address')
    return { token: plain }
  })
}
```

This needs `Deps` to carry an optional test-mode side channel. Add to `Deps`:

```ts
  /** Test mode only: token id → plaintext, so the E2E suite can follow a link. */
  testTokens?: Map<number, string>
```

In `authRoutes` and `sendInvite`, after inserting the token row, record it when the map exists:

```ts
      const inserted = await deps.db
        .insertInto('login_tokens')
        .values({ /* … as before … */ })
        .returning('id')
        .executeTakeFirstOrThrow()
      deps.testTokens?.set(inserted.id, token)
```

Change both existing `.execute()` calls on `login_tokens` inserts to `.returning('id').executeTakeFirstOrThrow()` to make this possible.

In `buildApp`, gate the registration:

```ts
  if (deps.config.nodeEnv === 'test') {
    await app.register(testOnlyRoutes, deps)
  }
```

And in the harness, pass `testTokens: new Map()`.

- [ ] **Step 3: Run it to verify it passes**

Run: `npm test --workspace @tennis/api` → PASS.

- [ ] **Step 4: Write the Playwright journey**

```bash
npm install -D -w . @playwright/test && npx playwright install --with-deps chromium
```

`e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // The whole point of this app is that it works on a phone.
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/api/dist/release.js && node apps/api/dist/index.js',
    url: 'http://localhost:3000/health',
    cwd: '..',
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      APP_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: process.env.E2E_DATABASE_URL!,
      SESSION_SECRET: 'e2e-secret-value-that-is-long-enough-ok',
      BOOTSTRAP_ADMIN_EMAIL: 'captain@example.com',
    },
    timeout: 120_000,
  },
})
```

`e2e/journey.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

const CAPTAIN = 'captain@example.com'
const PLAYER = `player-${Date.now()}@example.com`

/** Completes a magic-link sign-in by reading the token the way an inbox would. */
async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: /send me a link/i }).click()
  await expect(page.getByRole('status')).toContainText(/check your inbox/i)

  const res = await page.request.get(`/api/test/last-token?email=${encodeURIComponent(email)}`)
  expect(res.ok()).toBeTruthy()
  const { token } = (await res.json()) as { token: string }
  await page.goto(`/api/auth/callback?token=${token}`)
}

test('captain invites a player who sets up, records a match, and sees their record', async ({ page }) => {
  // The bootstrap admin is the only way in on a fresh deployment.
  await signIn(page, CAPTAIN)
  await expect(page).toHaveURL(/\/setup$/)
  await page.getByLabel('Display name').fill('Captain')
  await page.getByRole('button', { name: /save profile/i }).click()
  await expect(page).toHaveURL('/')

  // Invite a teammate.
  await page.goto('/admin')
  await page.getByLabel('Email').fill(PLAYER)
  await page.getByRole('button', { name: /send invitation/i }).click()
  await expect(page.getByRole('status')).toContainText(PLAYER)

  // The invitee signs in and completes their profile.
  await page.getByRole('button', { name: /sign out/i }).click().catch(() => {})
  await signIn(page, PLAYER)
  await expect(page).toHaveURL(/\/setup$/)
  await page.getByLabel('Display name').fill('Newcomer')
  await page.getByLabel('Rating system').selectOption('ntrp')
  await page.getByLabel('Rating value').fill('4.0')
  await page.getByRole('button', { name: /save profile/i }).click()

  // The roster shows both, on a phone-sized viewport.
  await expect(page).toHaveURL('/')
  await expect(page.getByText('Captain')).toBeVisible()
  await expect(page.getByText('Newcomer')).toBeVisible()

  // Set availability from the Me screen.
  await page.getByRole('link', { name: 'Me' }).click()
  await page.getByRole('switch', { name: /sat morning/i }).click()
  await expect(page.getByText('Saved')).toBeVisible()

  // Record a win against the captain.
  await page.getByRole('link', { name: 'Matches' }).click()
  await page.getByRole('button', { name: /record a match/i }).click()
  await page.getByLabel('Your opponent').selectOption({ label: 'Captain' })
  await page.getByLabel('Set 1 — your games').fill('6')
  await page.getByLabel('Set 1 — their games').fill('4')
  await page.getByLabel('Set 2 — your games').fill('6')
  await page.getByLabel('Set 2 — their games').fill('2')
  await page.getByRole('button', { name: /save match/i }).click()

  await expect(page.getByText('6–4, 6–2')).toBeVisible()
  await expect(page.getByText(/Newcomer.*beat.*Captain/s)).toBeVisible()

  // The record reflects it.
  await page.getByRole('link', { name: 'Me' }).click()
  await page.getByRole('link', { name: 'Roster' }).click()
  await page.getByText('Newcomer').click()
  await expect(page.getByText('Record')).toBeVisible()
  await expect(page.locator('dd', { hasText: '1' }).first()).toBeVisible()

  // Signing out closes the door behind you.
  await page.getByRole('link', { name: 'Me' }).click()
  await page.getByRole('button', { name: /sign out/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})
```

Add to the root `package.json`: `"e2e": "playwright test --config e2e/playwright.config.ts"`.

- [ ] **Step 5: Run the E2E suite locally**

```bash
npm run typecheck
npm run build --workspace @tennis/web
docker compose exec -T db psql -U tennis -d tennis -c "create database tennis_e2e"
E2E_DATABASE_URL=postgres://tennis:tennis@localhost:5433/tennis_e2e npm run e2e
```

Expected: 1 passed. If the run fails on the first navigation, check that `apps/web/dist` exists — without it the API logs `client bundle not found` and serves no HTML.

- [ ] **Step 6: Add the E2E job to CI**

Append to `.github/workflows/ci.yml`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: verify
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: tennis
          POSTGRES_USER: tennis
          POSTGRES_DB: tennis_e2e
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tennis" --health-interval 5s
          --health-timeout 5s --health-retries 20
    env:
      E2E_DATABASE_URL: postgres://tennis:tennis@localhost:5432/tennis_e2e
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build --workspace @tennis/web
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 7: Commit and confirm CI is green**

```bash
git add -A
git commit -m "test: add end-to-end journey and wire playwright into ci"
git push
gh run watch --exit-status
```

---

## Self-Review

Run after the plan is written, before execution.

**Spec coverage** — every spec section maps to a task:

| Spec section | Task(s) |
|---|---|
| 2 Scope / 14 Definition of done | 20 (E2E asserts the whole journey) |
| 3 Non-goals | Enforced by Global Constraints; Task 17 flags the one deliberate gap (doubles form) |
| 4 Decisions | 1–3 (stack, one origin), 4 (own auth), 7 (roles), 9 (photos), 10 (availability), 13 (styling) |
| 5 Architecture | 1 (workspaces, contracts), 2 (Kysely, migrations), 3 (app factory), 19 (single image) |
| 6 Data model | 2 (all tables, constraints, view) |
| 7 Auth, bootstrap | 4 (tokens, sessions), 5 (flow), 6 (bootstrap) |
| 8 API surface | 5, 7, 8, 9, 10, 11 — every row of the spec's route table |
| 9 Errors and logging | 3 (envelope, request id, redaction), 13 (client field mapping) |
| 10 Security and privacy | 3 (origin guard, helmet), 4 (cookie flags), 5 (rate limit, no enumeration), 9 (EXIF, allowlist, cap), 19 (CSP) |
| 11 Testing | Every task; 20 adds E2E and the full CI matrix |
| 12 Deployment | 19 (image, release step, guide) |
| 13 Frontend | 13–18 |

Gaps found and closed while reviewing:

1. **Cleanup job** was in the spec (section 6) but had no task — added as Task 12.
2. **`GET /health`** appears in the spec's route table; folded into Task 3 rather than left implicit.
3. **`register` + `Field` incompatibility** — `Field` spreads `...rest` onto the input, and react-hook-form's `register()` returns a `ref`. `Field` therefore must forward refs or accept `register`'s return spread. Task 13's `Field` uses plain props; when Task 14 wires it to `register`, wrap it in `forwardRef` and pass the ref through. **Do this in Task 14, Step 4** — noting it here so it is not discovered as a mystery bug.
4. **Doubles recording** is supported by the API (Task 11) but not exposed in the form (Task 17). Deliberate, flagged in the commit message, and outside the definition of done.

**Placeholder scan:** no `TBD`, `TODO`, "add error handling", or "similar to Task N". Every code step carries real code.

**Type consistency checks performed:**
- `MemberIdParams` is reused for `/api/matches/:id` and `/api/players/:id` — one `{ id }` params schema throughout, deliberately, rather than three near-identical schemas.
- `SessionDeps` (Task 4) is the narrow slice used by Tasks 4 and 12; `Deps` (Task 3) is the full set. `sweepExpired` takes `SessionDeps`, so it composes with both.
- `ObjectStore.presignPut(key, contentType, maxBytes)` is declared in Task 3, faked in Task 3, and called with all three arguments in Task 9. `FakeStore.presignPut` must therefore accept them (Task 9, Step 7).
- `PlayerDetail` is the response of `GET /api/players/:id`, `PUT /api/players/me`, `PATCH /api/players/me`, and `PUT /api/players/me/photo/confirm` — one type, so `useSaveProfile` and `useUploadPhoto` can both write the same query cache key.
- `AvailabilityGrid` names both the contract (Task 10) and the component (Task 15). The component imports the type aliased as `Grid` to avoid the collision.

---

## Execution Order and Parallelism

Tasks 1 → 20 are ordered by dependency and are safe to run strictly in sequence.

Where parallelism is available, if you want it:
- After Task 12, the backend is complete. Tasks **13** must precede 14–18, but **14, 15, 17, and 18 are independent of each other** once 13 lands. Task 16 depends on 15 (it reuses `AvailabilityGrid`).
- Task 19 depends on 13 only (it needs `apps/web/dist` to exist). Task 20 depends on everything.

Parallel client tasks touch disjoint files, so a git worktree per task is unnecessary; a shared branch is fine.
