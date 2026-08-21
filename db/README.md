# Migrations

Numbered, forward-only SQL. Applied in filename order by `apps/api/src/db/migrate.ts`,
each inside its own transaction, tracked in the `_migrations` table.

- Add a new file: `NNNN_short_name.sql`, next number in sequence.
- NEVER edit a file that has been applied anywhere. Add a new migration instead.
- No `down` migrations. To reverse something, write a forward migration that undoes it.
- Run locally: `npm run db:up && npm run migrate --workspace @tennis/api`
