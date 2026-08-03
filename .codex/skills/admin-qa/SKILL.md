---
name: admin-qa
description: Plan and execute risk-based verification for Admin Base framework and module changes, including type, lint, API/service tests, route-permission governance, machine-readable API/page acceptance coverage, build, smoke, and external integration boundaries. Use when validating a change, completing a module package, preparing a commit or release, adding routes or pages, or diagnosing a failed quality gate.
---

# Admin QA

Use the risk of the changed contract, not the number of changed files, to choose validation. Read
`AGENTS.md`, `docs/admin-base-functional-test-cases.md`, and the machine-readable test inventories.

## Workflow

1. Inspect `git status` and isolate the intended package from unrelated user changes.
2. Classify the change: documentation, utility, API, permission, page, schema, security, file,
   Provider, generator, or production workflow.
3. Confirm every new or changed API/page has a machine-readable test case. Run `pnpm test:docs`
   when the inventories change.
4. Run the smallest complete verification scope.
5. Fix the first concrete failure in the responsible layer, then rerun the failed check.
6. Expand to full verification for shared contracts or high-risk workflows.
7. Report passed checks, skipped checks, environment dependencies, and residual risk honestly.

## Verification Scopes

Use quick verification for documentation, project skills, or a narrow contract check:

```bash
pnpm admin:verify --quick
```

Use module verification for a named business package. It adds focused lint and related Vitest tests
for discovered module files:

```bash
pnpm admin:verify --module cms-config
```

Use full verification for shared UI, schema, auth, permissions, file, Provider, generator publish,
or release work:

```bash
pnpm admin:verify --full
```

Add smoke only when a safe running environment and credentials are configured:

```bash
pnpm admin:verify --full --smoke
```

## Required Assertions

For APIs, cover success, validation failure, authentication, authorization, data scope, returned
data, side effects, and operation logs where applicable.

For pages, define success, loading, empty, error, primary interaction, failed interaction,
permission behavior, desktop layout, narrow layout, light theme, and dark theme.

For permissions, verify seed, route manifest, CRUD metadata, explicit `ability()` checks, and token
revocation behavior when abilities change.

For sensitive operations, verify masking, audit details, risk level, idempotency or duplicate-submit
protection, and failure recovery.

## Safety Boundaries

- Never run `pnpm db:reset` as a verification step.
- Never point E2E at a normal development, shared, staging, or production database.
- Treat S3, SMTP, OAuth, SMS, and AI Provider tests as external integration tests. Use documented
  local emulators where available and record which real-provider checks remain manual.
- Do not skip or weaken a failing gate to obtain a green result.
- Do not run browser QA when the user explicitly deferred it; record the deferred visual boundary.

## Failure Report

For every failure, state the command, first actionable error, affected contract, whether it predates
the package, and the next narrow check. Do not describe an unexecuted check as passed.
