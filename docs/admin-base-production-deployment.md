# Admin Base Production Deployment

This document is the production handoff checklist for Admin Base.

## Runtime

- Use Node.js 22 or newer.
- Use PostgreSQL as the system database.
- Build with `pnpm build` and run with `pnpm start`.
- Do not run `pnpm db:reset` outside an isolated development or test database.
- Use a process manager such as PM2 or systemd in production.

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
SMOKE_BASE_URL=https://your-admin-domain.example
SMOKE_USERNAME=admin
SMOKE_PASSWORD=<admin-or-smoke-user-password>
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

`pnpm smoke` is non-destructive. It does not run migrations, seed, or `db:reset`.
It checks:

- `/login`
- `/api/health`
- `/api/ready`
- password login
- `/api/system/info`
- `/dashboard`
- `/system/user`
- `/system/notice`

Smoke credentials are read in this order:

```bash
SMOKE_USERNAME=admin
SMOKE_PASSWORD=<password>
ADMIN_BASE_ADMIN_PASSWORD=<fallback-password>
```

Use a dedicated low-risk smoke account in staging and production when possible.

## Local, Staging, And Production Smoke

Local production build smoke:

```bash
pnpm build
DATABASE_URL=postgres://admin_base:admin_base@localhost:5432/admin_base \
ADMIN_BASE_SECRET_KEY=<local-long-secret> \
ADMIN_BASE_ADMIN_PASSWORD=<local-admin-password> \
pnpm start

SMOKE_BASE_URL=http://localhost:3000 \
SMOKE_USERNAME=admin \
SMOKE_PASSWORD=<local-admin-password> \
pnpm smoke
```

Staging smoke:

```bash
SMOKE_BASE_URL=https://staging-admin.example.com \
SMOKE_USERNAME=admin \
SMOKE_PASSWORD=<staging-password> \
pnpm smoke
```

Production smoke:

```bash
SMOKE_BASE_URL=https://admin.example.com \
SMOKE_USERNAME=<smoke-user> \
SMOKE_PASSWORD=<smoke-user-password> \
pnpm smoke
```

Never use `pnpm e2e` or any command that resets the database against staging or production.

## Process Manager

PM2 example:

```bash
pnpm build
pm2 start "pnpm start" --name admin-base --time
pm2 save
```

Recommended PM2 environment:

```bash
NODE_ENV=production
DATABASE_URL=postgres://user:password@host:5432/admin_base
ADMIN_BASE_SECRET_KEY=<long-random-secret>
ADMIN_BASE_ADMIN_PASSWORD=<initial-admin-password>
DATABASE_POOL_SIZE=10
LOG_LEVEL=info
```

systemd deployments should run the same `pnpm start` command after `pnpm build`,
with the environment variables above loaded from an environment file owned by the deploy user.

## Reverse Proxy

- Proxy HTTPS traffic to the Next.js server port.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Configure upload body size according to `file.max_upload_size_mb`.

Minimal Nginx example:

```nginx
server {
  listen 443 ssl http2;
  server_name admin.example.com;

  client_max_body_size 100m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

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

PostgreSQL backup example:

```bash
pg_dump "$DATABASE_URL" > "admin-base-$(date +%Y%m%d%H%M%S).sql"
```

Restore example:

```bash
psql "$DATABASE_URL" < admin-base-backup.sql
pnpm db:migrate
pnpm admin:doctor
pnpm smoke
```

## Release And Rollback

- Run migrations before starting the new build.
- Keep the previous build artifact and database backup for rollback.
- If rollback requires schema rollback, restore the matching database backup rather than manually editing production tables.
- Roll forward with a fix when the new migration is compatible.
- Roll back only when the matching database backup and upload objects are available.

Recommended release order:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
pm2 restart admin-base
pnpm admin:doctor
pnpm smoke
```

## Safety Rules

- `pnpm db:reset` is destructive and is guarded by environment checks.
- Never set `ADMIN_BASE_ALLOW_DB_RESET=true` in production.
- Never set `ADMIN_BASE_CONFIRM_PRODUCTION_RESET=I_KNOW_THIS_WILL_DESTROY_DATA` in production.
- Never use the development fallback secret or password in production.
- Run `pnpm admin:doctor` and `pnpm smoke` after deployment.

`pnpm db:reset` is only for isolated development or test databases. It refuses:

- any invocation without `ADMIN_BASE_ALLOW_DB_RESET=true`
- any invocation where `ADMIN_BASE_RESET_DATABASE_NAME` does not exactly match the database parsed from `DATABASE_URL`
- `NODE_ENV=production`
- production-like host or database names
- non-local database hosts unless explicitly allowed
- any high-risk target unless the destructive confirmation variable is set

The destructive confirmation variable exists only for disposable isolated environments
whose host or database name happens to look production-like. It is not a production
operations procedure.
