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
ADMIN_BASE_PUBLIC_URL=https://your-admin-domain.example
```

Recommended optional variables:

```bash
DATABASE_POOL_SIZE=10
LOG_LEVEL=info
ADMIN_BASE_AI_ORCHESTRATOR=legacy
ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS=60
ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS=30
ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL=https://alerts.example.com/hooks/admin-base
SMOKE_BASE_URL=https://your-admin-domain.example
SMOKE_USERNAME=admin
SMOKE_PASSWORD=<admin-or-smoke-user-password>
```

`ADMIN_BASE_AI_ORCHESTRATOR` is a deployment-level switch, not a database setting. Keep it at
`legacy` unless the Mastra canary has been verified for the target environment. In the current
migration stage, `mastra` routes only `general-assistant` through Mastra; other Agents remain on the
legacy runtime. Mastra uses the existing Admin Base Provider/Model configuration and does not start
a second API server.

Mastra PostgreSQL storage is reserved for later Workflow snapshots under the `mastra_runtime`
schema. Runtime configuration always uses `disableInit: true`; production startup must never let
Mastra create or alter tables. Any future Mastra DDL must first be exported, reviewed, and added to
the Admin Base migration chain.

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
pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
```

The checked-in PM2 configuration runs four independent, auto-restarting processes:

- `admin-base-web`: Next.js + Hono.
- `admin-base-ai-worker`: claims and executes PostgreSQL AI Jobs.
- `admin-base-ai-worker-monitor`: detects claimable Jobs waiting beyond the configured threshold,
  expired leases, and optionally sends state-change webhooks.
- `admin-base-saas-outbox-worker`: delivers Tenant invitation email and outbound SaaS Webhook
  records with PostgreSQL leases, retries, and dead-letter handling.

Recommended PM2 environment:

```bash
NODE_ENV=production
DATABASE_URL=postgres://user:password@host:5432/admin_base
ADMIN_BASE_SECRET_KEY=<long-random-secret>
ADMIN_BASE_ADMIN_PASSWORD=<initial-admin-password>
ADMIN_BASE_PUBLIC_URL=https://your-admin-domain.example
DATABASE_POOL_SIZE=10
LOG_LEVEL=info
```

systemd deployments should run `pnpm start` for Web after `pnpm build`, and enable the checked-in
`deploy/systemd/admin-base-ai-worker.service` plus
`deploy/systemd/admin-base-ai-worker-monitor.service` plus
`deploy/systemd/admin-base-saas-outbox-worker.service`. Copy and review the templates first: adjust
`User`, `Group`, `WorkingDirectory`, `EnvironmentFile`, and the pnpm path for the target host.

```bash
sudo cp deploy/systemd/admin-base-ai-worker*.service /etc/systemd/system/
sudo cp deploy/systemd/admin-base-saas-outbox-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now admin-base-ai-worker.service
sudo systemctl enable --now admin-base-ai-worker-monitor.service
sudo systemctl enable --now admin-base-saas-outbox-worker.service
```

For containers, run Web, AI Worker, Monitor, and SaaS Outbox Worker as separate services from the
same immutable image and environment. Their commands are respectively `pnpm start`,
`pnpm ai:worker`, `pnpm ai:worker:monitor`, and `pnpm saas:outbox`; never run these commands inside
one container. Configure restart policies for every Worker/Monitor process, and route structured
stderr/log output or the optional alert webhook into the deployment alerting system.

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
- Keep `admin-base-saas-outbox-worker` running for Tenant invitation delivery. Verify delivery,
  provider message IDs, retry/dead-letter recovery, bounce handling, and the recipient PII retention
  policy in the target environment.

## SaaS Branding, Domain, And Webhook

- `ADMIN_BASE_PUBLIC_URL` is the safe platform fallback used in generated invitation links and must
  be an externally reachable HTTPS origin in production.
- DNS ownership verification only moves a Tenant domain to `verified`; an external certificate and
  reverse-proxy controller must provision TLS and explicitly advance certificate status to `active`.
  Until then, links continue using `ADMIN_BASE_PUBLIC_URL`.
- Permit only the required outbound HTTPS/443 network access for Webhook delivery. Validate the
  target environment's DNS resolver, firewall, TLS trust store, retry/dead-letter recovery, and
  destination signature verification before production enablement.
- API Key authentication is bound by each business route to an exact Scope, Workspace/Module
  constraint, Entitlement, resource ACL, and quota. Do not expose a generic pass-through API.

## Web Search

- Configure Tavily, Brave Search, or SearXNG from `/system/ai/web-search`; keys are encrypted in
  PostgreSQL and are never returned by the API.
- Keep only tested connections enabled. The Agent calls enabled connections by ascending fallback
  order and moves to the next connection on timeout, failure, or empty results.
- Production SearXNG should be an HTTPS endpoint reachable only from the application network. Its
  JSON response format must be enabled.
- Do not expose a private SearXNG instance to the public Internet without its own access controls,
  rate limits, outbound policy, and monitoring.
- The local emulator under `deploy/local-integrations/searxng` is for development and integration
  verification only. Start and stop it with the commands in `docs/ai-web-search.md`.

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
