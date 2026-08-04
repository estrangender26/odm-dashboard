# Migration 0019 — Link-Based Collaborative Gantt Foundation

## Safety rules

- Do **not** apply this migration until preflight checks pass.
- Do **not** apply while production traffic is writing to `gantt_projects`; schedule a maintenance window or run during low-traffic hours.
- Keep a database snapshot / backup before running the migration.
- Run the verification script immediately after the migration.
- The rollback script reverses additive schema changes only; audit/calendar data in new tables is dropped.

## Procedure

1. Run preflight dry-run SQL:
   ```bash
   psql $DATABASE_URL < db/migrations/helpers/0019_gantt_link_sharing_preflight.sql
   ```
2. If it passes, apply the Drizzle migration:
   ```bash
   npm run db:migrate
   ```
3. Verify with:
   ```bash
   psql $DATABASE_URL < db/migrations/helpers/0019_gantt_link_sharing_verification.sql
   ```
4. If anything goes wrong, roll back with:
   ```bash
   psql $DATABASE_URL < db/migrations/helpers/0019_gantt_link_sharing_rollback.sql
   ```

## Guarantees provided by the migration

- Every existing `gantt_projects` row receives a unique non-null `public_id` (UUID) and `slug`.
- Raw access tokens are **never** stored; only SHA-256 hashes are kept.
- Existing JSON snapshots (`tasks_data`, `links_data`) are left untouched.
- Legacy session-based access via `/gantt-planner` continues to work because no existing column is removed.

## Share-token lifecycle notes

- Editor and viewer plaintext tokens are returned exactly once during project creation or explicit regeneration.
- Previously issued tokens cannot be retrieved from the database because only their hashes are kept.
- Revocation sets the corresponding hash to NULL; if both hashes are NULL, `sharing_enabled` is set to 0.
- Regeneration requires `confirmed: true` in the `share` mutation.

## Browser-storage security note

- The shared workspace stores only the participant display name in `localStorage` for convenience.
- The access token is captured from the URL once on page load and immediately removed from the address bar using `history.replaceState`.
- The token remains in memory for the lifetime of the page so that copy/share and polling continue to work.
- Reloading the page requires re-entering the original share link.
