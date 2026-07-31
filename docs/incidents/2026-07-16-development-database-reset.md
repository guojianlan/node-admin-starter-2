# Incident: Development Database Reset During Acceptance

## Summary

- Date: `2026-07-16`
- Severity: Critical
- Affected database: `admin_base`
- Intended database: `admin_base_test`
- Status: Data loss confirmed; application schema and seed data restored; business data not recoverable from the repository

During GATE-007 acceptance, environment values intended to select `admin_base_test` were passed as execution-tool metadata instead of shell environment assignments. The tool ignored those unsupported values. `pnpm db:reset` therefore loaded the default development `DATABASE_URL` and dropped the `public` schema in `admin_base`.

## Impact

- PostgreSQL business data, file metadata, operation logs, Provider resources, AI sessions and local configuration were removed.
- Schema and default seed records were recreated automatically.
- Files under `storage/uploads` were not physically removed; approximately 19 MB remains without matching `sys_file` rows.
- No PostgreSQL dump was found in the repository or its parent project directory.
- The legacy `data/admin-base.sqlite` snapshot is dated `2026-06-17`, uses an obsolete schema and cannot provide a lossless restore.

## Root Cause

1. The acceptance command relied on environment injection unsupported by the command runner.
2. `db:reset` allowed local development/test resets without an explicit per-invocation confirmation.
3. Playwright used port 3000, allowed reuse of an existing server and invoked `pnpm db:reset`, so E2E isolation was not enforceable.

## Corrective Actions

1. `db:reset` now requires `ADMIN_BASE_ALLOW_DB_RESET=true` for every invocation.
2. `db:reset` now requires `ADMIN_BASE_RESET_DATABASE_NAME` to exactly match the database parsed from `DATABASE_URL`.
3. High-risk hosts, names and environments still require `ADMIN_BASE_CONFIRM_PRODUCTION_RESET=I_KNOW_THIS_WILL_DESTROY_DATA`.
4. Playwright now requires an `*_test` database, uses `admin_base_test` by default, runs on port 3101 and never reuses the port-3000 development server.
5. Production-foundation tests cover missing allow and mismatched database confirmation.

## Recovery Decision

On `2026-07-31`, the project owner accepted the new seed state and chose not to reconstruct the
unverifiable historical file metadata. The legacy SQLite database must not be imported and the
orphaned files under `storage/uploads` must not be automatically attached to new database records.

The default seed now creates a removable `网站素材` group with three representative website files:

- light login background;
- dark login background;
- `robots.txt`.

These records are ordinary `sys_file` rows, are not marked as protected system data, and can be
soft-deleted and permanently deleted through the existing file-management workflow. A full database
reset recreates the default examples; a normal user deletion does not trigger automatic restoration.

The data-recovery decision is closed. Delivery can still remain No-Go for independent reasons such as
an uncommitted worktree, unverified remote CI, external Provider validation, or incomplete manual
visual review.
