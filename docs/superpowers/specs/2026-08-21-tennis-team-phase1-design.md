# Tennis Team App — Phase 1 Design (Team & Profiles)

Date: 2026-08-21
Status: Approved for implementation planning
Owner: Assaf Atias

## 1. Context and phasing

The team wants a private web app with player profiles, match photo/video sharing, and
payment collection for membership fees and equipment. Those are three largely
independent subsystems, and specifying them together produces a document too shallow to
implement. The work is therefore split into three phases, each with its own design,
plan, and implementation cycle:

| Phase | Scope | Depends on |
|---|---|---|
| 1 (this document) | Invite-only auth, player profiles, weekly availability, match results | — |
| 2 | Match photos and videos attached to matches | Phase 1 identity + storage seam |
| 3 | Membership fees and equipment payments | Phase 1 identity |

Phase 1 is first because it is the only phase the other two depend on. Match results are
included in Phase 1 (rather than Phase 2) because per-player win/loss records were a
required profile feature, and records require match rows to derive from. This also gives
Phase 2 an existing entity to attach media to.

## 2. Phase 1 scope

In scope:

- Invite-only magic-link authentication with revocable server-side sessions
- Two roles: `admin` and `player`
- Roster listing and per-player profile pages
- Player profile: core identity, tennis attributes, single profile photo
- Weekly recurring availability (7 days x 3 time blocks) and a team "who is free" view
- Match records: date, format, venue, participants (teammates or named guests), per-set
  scores, winning side
- Per-player win/loss records derived from match records
- Mobile-first responsive UI, deployed to a public URL, with CI green

## 3. Non-goals for Phase 1

Explicitly excluded. These are refused by reference during implementation:

- Match photos and videos (Phase 2)
- Payments of any kind (Phase 3)
- Push notifications, or email other than the invitation and sign-in links
- Calendar scheduling, specific-date availability, lineup builder, match invitations
- Rankings, ladders, or ELO beyond the win/loss record
- Chat or messaging
- Multi-team tenancy: one deployment serves exactly one team
- Internationalisation and localisation; the UI is English-only
- Native mobile apps, and PWA install or offline support

## 4. Decisions and rationale

| Decision | Choice | Rationale |
|---|---|---|
| Auth method | Magic link, invite-only | No password storage, hashing, reset flow, or credential breach surface. The invite list *is* the access control. |
| Session storage | Server-side `sessions` table, opaque cookie | The product premise is "only team members get in", so removing a member must terminate their access immediately. Stateless JWTs cannot be revoked before expiry. |
| Hosting | One Node service serving API and built client on one origin, managed Postgres | Removes CORS and cross-origin cookie complexity, gives one deploy and one log stream, and imposes no serverless request-size limits to fight when Phase 2 adds video. |
| Build vs. rent auth | Own it: Fastify, typed SQL, hand-rolled magic link | Magic link is the smallest auth to own correctly. Avoids vendor coupling of the user model, and avoids splitting authorisation between database RLS policies and Node. The stack also mirrors the tooling the owner uses daily, which makes review easier. |
| Roles | `admin` + `player` | Enough structure for a small team without a permissions hierarchy nobody needs. |
| Identity vs. profile tables | Separate `members` and `player_profiles` | Security-critical, admin-written fields stay separate from wide, self-written content, and an invited-but-not-yet-joined member exists as a `members` row with no profile. Removes the need for a separate invites table. |
| Win/loss records | Derived SQL view, not counter columns | Derived values cannot drift out of sync with the matches they summarise. |
| Profile photos | Object storage via presigned upload | Client uploads do not pass through Node. Builds the exact upload seam Phase 2 video reuses. Storing images in Postgres was rejected as a dead end that Phase 2 would force a rewrite of. |
| Availability model | Recurring weekly grid, not calendar events | Answers "who can usually play Saturday morning" with one small table, which is what a team actually needs. |
| Styling | Tailwind CSS plus a small set of owned components | Smallest bundle, full control of visual identity, and mobile-first breakpoints are the native idiom. |

## 5. Architecture

One repository, npm workspaces, one deployable artifact.

```
tennis-team/
  apps/api/            Fastify service: routes, auth, data access.
                       Serves the built client in production.
  apps/web/            React 19 + Vite + TypeScript client
  packages/contracts/  TypeBox schemas, shared by api and web
  db/migrations/       Numbered, forward-only SQL migration files
  docker-compose.yml   Postgres for local development
  Dockerfile           Multi-stage: build web, build api, single runtime image
```

`packages/contracts` is load-bearing: every request and response shape is defined once as
a TypeBox schema, validated at runtime by Fastify, and imported as a compile-time type by
the client. A field rename fails the build rather than failing in production.

Technology:

- API: Node 22, Fastify, TypeBox validation, Pino logging
- Data access: the Kysely typed SQL query builder over `node-postgres`; no ORM
- Migrations: numbered, forward-only `.sql` files applied by an explicit release command
- Client: React 19, Vite, TypeScript, React Router, TanStack Query, React Hook Form with
  the TypeBox resolver
- Styling: Tailwind CSS with hand-built `Card`, `Button`, `Field`, `Avatar`, `Grid`
- Email: the Resend transactional provider, for invitation and sign-in links
- Storage: S3-compatible object storage (Cloudflare R2 or AWS S3) for profile photos

## 6. Data model

All tables use `bigint generated always as identity` primary keys, except
`player_profiles`, whose primary key is its `member_id` foreign key. All timestamps are
`timestamptz`. Emails use the `citext` type so address comparison is case-insensitive.

### `members` — identity, roster, access control

`id`, `email` (citext, unique, not null), `role` (`'admin' | 'player'`, not null,
default `'player'`), `status` (`'invited' | 'active' | 'removed'`, not null, default
`'invited'`), `created_at`, `last_seen_at` (nullable).

An invitation is a `members` row with `status = 'invited'`. First successful sign-in
transitions the row to `'active'`. Removal sets `'removed'` and deletes the member's
sessions; rows are never hard-deleted, because that would orphan match history.

### `player_profiles` — self-authored profile content

`member_id` (primary key, foreign key to `members.id`, on delete cascade),
`display_name` (not null), `nickname`, `phone`, `photo_key` (object-storage key,
nullable), `dominant_hand` (`'left' | 'right'`), `backhand` (`'one' | 'two'`),
`preferred_format` (`'singles' | 'doubles' | 'both'`), `rating_system`
(`'utr' | 'ntrp' | 'club' | 'none'`), `rating_value` (text, nullable, free-form because
club scales vary), `racquet`, `bio` (text, at most 500 characters, enforced by a check
constraint), `updated_at`.

A profile row is created when the member submits the setup form after their first sign-in;
a signed-in member with no profile row is redirected to `/setup`. `display_name` is the
only required field. When `rating_system` is `'none'`, `rating_value` must be null,
enforced by a check constraint.

### `login_tokens` — single-use sign-in tokens

`id`, `member_id` (foreign key, on delete cascade), `token_hash` (bytea, the SHA-256 of
the token, unique), `expires_at` (not null), `consumed_at` (nullable), `created_at`.

The plaintext token exists only in the emailed URL. Tokens expire 15 minutes after
creation and are single-use. Expired and consumed rows are deleted by the cleanup job
described under `sessions` below.

### `sessions` — revocable sessions

`id`, `member_id` (foreign key, on delete cascade), `token_hash` (bytea, unique),
`expires_at`, `created_at`, `last_used_at`, `user_agent` (text, truncated to 255
characters).

The cookie carries an opaque random token; only its hash is stored. Sessions have a
30-day sliding expiry refreshed on use, capped so `expires_at` is always at most 30 days
ahead of now. Logout deletes the row. Setting a member to `'removed'` deletes all of
their rows.

A cleanup job runs inside the API process on a one-hour interval, deleting sessions whose
`expires_at` has passed, and `login_tokens` rows that are expired or consumed and more
than 7 days old. The deletes are idempotent, so running the job on more than one instance
is harmless.

### `availability` — recurring weekly availability

`member_id` (foreign key, on delete cascade), `weekday` (smallint 0-6, where 0 is
Sunday), `block` (`'morning' | 'afternoon' | 'evening'`). The primary key is
`(member_id, weekday, block)`. Presence of a row means available; absence means not.

### `matches`, `match_players`, `match_sets` — match records

`matches`: `id`, `played_on` (date, not null), `format` (`'singles' | 'doubles'`, not
null), `venue` (nullable), `notes` (nullable), `winner_side` (smallint, 1 or 2, not
null), `recorded_by` (foreign key to `members.id`), `created_at`, `updated_at`.

`match_players`: `id`, `match_id` (foreign key, on delete cascade), `side` (smallint, 1
or 2), `member_id` (foreign key to `members.id`, nullable), `guest_name` (text,
nullable), with a check constraint requiring exactly one of `member_id` and `guest_name`
to be non-null. This single model covers both teammate-versus-teammate matches and
matches against outside opponents.

`match_sets`: `id`, `match_id` (foreign key, on delete cascade), `set_number` (smallint),
`side1_games` (smallint), `side2_games` (smallint), unique on `(match_id, set_number)`.

Validation enforced at the API layer, not only in the database: a `singles` match has
exactly one player per side; a `doubles` match has exactly two; a match has between one
and five sets.

### `player_records` — view

A SQL view producing one row per member: `member_id`, `matches_played`, `wins`,
`losses`. Derived by left-joining `members` to `match_players` and `matches` and
comparing `side` against `winner_side`, so a member who has played no matches appears
with zero counts and the view can back a profile page without a separate empty case. Win
and loss counts are never stored as columns.

## 7. Authentication design

### Bootstrapping the first admin

Invite-only authentication has a chicken-and-egg problem: with an empty `members` table,
nobody can invite anybody. The release command that applies migrations therefore also
reads the `BOOTSTRAP_ADMIN_EMAIL` environment variable and, if no member with role
`admin` exists, inserts that address as an `active` admin. The operation is idempotent
and does nothing once any admin exists, so it is safe to run on every deploy.

### Sign-in flow

1. An admin submits a teammate's email. A `members` row is created with
   `status = 'invited'`, and an invitation email containing a sign-in link is sent.
2. A visitor submits an email at `/login`. If a `members` row exists with status
   `'invited'` or `'active'`, a token is created and a sign-in link is emailed. If no
   such row exists, or the member is `'removed'`, the API returns an identical `202`
   response and sends nothing. The response never reveals whether an address is on the
   team.
3. The callback hashes the supplied token, requires a matching row that is unconsumed and
   unexpired, sets `consumed_at`, creates a session, sets the session cookie, and
   redirects. A member with status `'invited'` transitions to `'active'` and is redirected
   to profile setup; an `'active'` member is redirected to the roster.
4. The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, with a 30-day
   expiry.
5. `POST /api/auth/request-link` is rate limited per email address and per client IP, so
   the endpoint cannot be used to flood a teammate's mailbox.
6. Logout deletes the session row. Changing a member's status to `'removed'` deletes all
   of their sessions in the same transaction.

## 8. API surface

All routes are validated against TypeBox schemas from `packages/contracts`. A single
`preHandler` resolves the session cookie into `request.member` and refreshes
`last_used_at`. Authorisation is declared on the route definition via a
`requireRole('admin')` helper rather than checked inside handlers, so the complete
who-can-do-what picture is readable from the route list.

| Method and path | Authorisation |
|---|---|
| `POST /api/auth/request-link` | public |
| `GET /api/auth/callback` | public (token) |
| `POST /api/auth/logout` | authenticated |
| `GET /api/auth/me` | authenticated |
| `GET /api/members` | any member |
| `POST /api/members` | admin |
| `PATCH /api/members/:id` | admin |
| `DELETE /api/members/:id` | admin |
| `POST /api/members/:id/resend-invite` | admin |
| `GET /api/players/:id` | any member |
| `GET /api/players/:id/record` | any member |
| `PATCH /api/players/me` | self |
| `POST /api/players/me/photo` | self |
| `PUT /api/players/me/photo/confirm` | self |
| `GET /api/players/:id/availability` | any member |
| `PUT /api/players/me/availability` | self |
| `GET /api/availability?weekday=&block=` | any member |
| `GET /api/matches` | any member |
| `GET /api/matches/:id` | any member |
| `POST /api/matches` | a member if listed as a participant; an admin unconditionally |
| `PATCH /api/matches/:id` | the recording member, or an admin |
| `DELETE /api/matches/:id` | admin |
| `GET /health` | public, unauthenticated, pings the database |

Notable contracts:

- `PUT /api/players/me/availability` replaces the entire set of blocks in one
  transaction rather than patching individual cells. The grid is 21 booleans, and
  idempotent replacement means an interrupted request cannot leave availability
  half-saved.
- Photo upload is three steps: `POST /api/players/me/photo` returns a presigned upload
  URL and object key after validating the declared content type and size; the client
  uploads directly to storage; `PUT /api/players/me/photo/confirm` attaches the key to
  the profile. The upload itself never passes through the Node process; section 10
  describes the one deliberate exception during the confirm step.
- `DELETE /api/members/:id` is a soft removal, setting `status = 'removed'` and deleting
  sessions.
- `GET /api/members` returns `invited` and `active` members only, and `GET
  /api/players/:id` returns `404` for a `removed` member. Removal therefore takes a
  person off every surface of the app while their match history stays intact.
- `PATCH /api/members/:id` and `DELETE /api/members/:id` both refuse, with `409`, any
  change that would leave the team with no active admin. Without this guard a single
  click can lock the whole team out of its own roster with no way back in through the UI.
- `GET /api/availability` requires both `weekday` and `block`; neither parameter is
  optional.
- `GET /api/matches` is paginated with a cursor on `(played_on, id)` descending.

## 9. Error handling and logging

A single Fastify error handler returns one envelope shape:
`{ "error": { "code": string, "message": string, "details"?: object } }`.

- TypeBox validation failures become `400` with `details` carrying field paths, which the
  client renders as inline field errors.
- Authentication failures return `401`; authorisation failures return `403`.
- Unhandled errors are logged in full against the request id, and return a generic `500`
  message plus that request id, so a failure can be traced from a user report without
  exposing internals to the browser.

Logging is Pino JSON with one request id per request. Email addresses, tokens, and
session identifiers are never logged; log lines reference `member_id`. This is a
deliberate privacy requirement, not a stylistic one: the membership list is the asset
this application protects, and log aggregation is the most common place such a list
leaks.

On the client, each route has an error boundary, failed mutations surface a retry
affordance, and field-level API errors are mapped back onto the originating form.

## 10. Security and privacy

- The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.
- State-changing requests additionally require an `Origin` header matching `APP_ORIGIN`,
  backing up the `SameSite` protection. Requests failing this check return `403`.
- `helmet` security headers, including HSTS.
- Rate limiting on `POST /api/auth/request-link` and `GET /api/auth/callback`.
- Login responses are identical for known and unknown addresses; no user enumeration.
- Presigned photo uploads enforce a server-side content-type allowlist (`image/jpeg`,
  `image/png`, `image/webp`) and a 5 MB size cap in the signed policy.
- The confirm step fetches the uploaded object server-side, re-encodes and resizes it to
  strip EXIF metadata, stores the derived image under a new key, and deletes the
  original. This is the single point at which image bytes pass through Node, and the cost
  is accepted deliberately and bounded by the 5 MB cap: phone photographs carry GPS
  coordinates, and a roster of identifiable teammates tagged with the locations the
  photographs were taken in is a real privacy exposure, not a theoretical one.
- All secrets are supplied as environment variables. A `.env.example` documenting every
  variable is committed; no `.env` file or secret value is ever committed.

## 11. Testing

- Unit tests (Vitest): token hashing, expiry and single-use logic; the `requireRole`
  helper; availability set replacement; the `player_records` derivation; match
  participant-count validation; the last-active-admin guard; and the idempotency of the
  first-admin bootstrap.
- Integration tests (Fastify `app.inject()` against a real Postgres instance in Docker
  with migrations applied, each test wrapped in a transaction that is rolled back):
  every route's success path, plus an explicit unauthenticated `401` test and an explicit
  wrong-role `403` test for every protected route. The application's core claim is that
  non-members cannot read team data, so that claim is asserted per route rather than
  assumed.
- End-to-end test (Playwright, one flow, at a 360 px viewport): an admin invites an
  address; the invitee signs in via a link whose token is retrieved from a test-only
  endpoint enabled solely when `NODE_ENV` is `test`; they complete profile setup, record
  a match, and observe the win/loss record update.
- CI (GitHub Actions, on push and pull request): typecheck, lint, unit tests, integration
  tests against a Postgres service container, then Playwright.

## 12. Deployment

- Multi-stage Dockerfile: build `apps/web`, build `apps/api`, and produce one runtime
  image in which Fastify serves the API under `/api` and the built client for all other
  paths.
- Managed Postgres with point-in-time recovery.
- Migrations are forward-only and run as an explicit release step, never on application
  boot, so that two instances starting concurrently cannot race to migrate.
- The release command applies migrations and then runs the idempotent first-admin
  bootstrap described in section 7.
- Environment variables: `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`,
  `BOOTSTRAP_ADMIN_EMAIL`, `RESEND_API_KEY`, `MAIL_FROM`, `STORAGE_ENDPOINT`,
  `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `PORT`,
  `NODE_ENV`.
- `GET /health` verifies database connectivity and serves as the platform health check.
- Object storage retention is configured explicitly rather than left at provider
  defaults, because managed Postgres backups do not cover uploaded photos.
- Source is hosted at `github.com/AssafAtias/tennis-team`, with `main` as the default
  branch, short-lived branches merged by pull request, and CI required.

## 13. Frontend design

Routes: `/login`, `/setup` (first run; entered automatically while the signed-in member
has no profile), `/` (roster), `/players/:id`, `/me`, `/matches`, `/matches/new`, and
`/admin` (admin only). Unauthenticated visits to any route other than `/login` redirect
to `/login`.

Mobile-first, specifically: layouts are authored at 360 px and widened at the 640 px and
1024 px breakpoints. Navigation is a bottom tab bar (Roster, Matches, Me) below 1024 px,
and a side navigation at or above it. Interactive targets are at least 44 px. Inputs use
appropriate `type` attributes (`email`, `tel`) so mobile keyboards match the field. No
interaction depends on hover.

The availability editor is a 7 x 3 toggle grid, sized for one-handed thumb use, since it
will realistically be edited while standing on a court.

TanStack Query owns all server state; there is no separate client state store, and the
current session is exposed as a query against `GET /api/auth/me`. Forms use React Hook
Form validating against the very same TypeBox schemas the API validates against, via
`@hookform/resolvers/typebox`, so client and server reject the same input for the same
reason with no second schema language to keep in step.

Visual direction is chosen deliberately rather than defaulted, and is settled during
implementation of the first UI task using the frontend design skill. The constraint
recorded here is that the result must not read as an untouched component-library default.

## 14. Definition of done

Phase 1 is complete when a teammate can be invited by email, sign in through a link,
complete a profile with a photo and weekly availability, browse the roster and other
players' profiles on a phone, record a match result, and see win/loss records update —
with the application deployed to a public URL, CI green on `main`, and every protected
route covered by both an authentication and an authorisation test.
