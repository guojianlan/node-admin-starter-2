# Admin Base Production Deployment

This document is the production handoff checklist for Admin Base.

## Runtime

- Use Node.js 20 or newer.
- Use PostgreSQL as the system database.
- Build with `pnpm build` and run with `pnpm start`.
- Do not run `pnpm db:reset` outside an isolated development or test database.

## Required Environment

```bash
NODE_ENV=production
DATABASE_URL=postgres://user:password@host:5432/admin_base
ADMIN_BASE_SECRET_KEY=<long-random-secret>
ADMIN_BASE_ADMIN_PASSWORD=<initial-admin-password>
```

Recommended optional variables:

```bash
DATABASE_POOL_SIZE=10
LOG_LEVEL=info
```

## First Deploy

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
pnpm start
```

After the server starts, run:

```bash
SMOKE_BASE_URL=https://your-admin-domain.example pnpm smoke
```

## Reverse Proxy

- Proxy HTTPS traffic to the Next.js server port.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Configure upload body size according to `file.max_upload_size_mb`.

## Storage

- Local storage must point to a persistent directory, not an ephemeral build directory.
- For S3-compatible storage, configure endpoint, region, bucket, access key, secret key, and base URL in the storage configuration page.
- Keep one enabled default storage at all times.

## SMTP

- Configure at least one enabled default mail account for password reset flows.
- Use the mail account test action after every SMTP change.
- Passwords are stored encrypted and never returned by API responses.

## Backup And Restore

- Back up PostgreSQL before every release.
- Back up local upload storage when using local storage.
- For S3-compatible storage, rely on provider object versioning or bucket backup policy.
- Restore order: database first, uploaded objects second, then run `pnpm admin:doctor`.

## Release And Rollback

- Run migrations before starting the new build.
- Keep the previous build artifact and database backup for rollback.
- If rollback requires schema rollback, restore the matching database backup rather than manually editing production tables.

## Safety Rules

- `pnpm db:reset` is destructive and is guarded by environment checks.
- Never set `ADMIN_BASE_ALLOW_DB_RESET=true` in production.
- Never use the development fallback secret or password in production.
- Run `pnpm admin:doctor` and `pnpm smoke` after deployment.
