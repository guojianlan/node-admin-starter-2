# Admin Base AI Development Guide

Updated: 2026-08-03

This guide defines how a human request, a coding agent, and the Admin Base module generator work
together. The goal is deterministic framework extensions: the same requirement should produce the
same architecture, permission model, test obligations, and review path.

## 1. Development Model

Admin Base separates three responsibilities:

| Participant  | Responsibility                                                                              | Must not do                                                                |
| ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Human        | Define business intent, approve risky behavior, accept the result                           | Hand-author repetitive framework files when the generator can do it safely |
| Coding agent | Inspect the repository, design the module contract, implement extensions, verify the result | Invent a parallel architecture or bypass permission and audit rules        |
| Generator    | Render deterministic standard CRUD files from structured input                              | Decide ambiguous business rules or silently overwrite handwritten code     |

The in-product AI Agent is a runtime business Agent. It is not a coding Agent and must not receive
arbitrary filesystem, shell, database, or Git access.

## 2. Request To Delivery Lifecycle

1. Understand the outcome, actors, records, lifecycle, permissions, data ownership, side effects,
   and acceptance criteria.
2. Inspect the closest existing module and current repository state.
3. Classify the module before choosing an implementation path.
4. Write a structured module contract, even when the first version is kept in the implementation
   notes rather than a JSON file.
5. Generate a draft for supported standard CRUD or create the same required pieces manually.
6. Review all generated and handwritten changes as one diff.
7. Add custom behavior only at explicit extension points.
8. Register API and page acceptance contracts.
9. Run the risk-based validation matrix.
10. Report generated files, handwritten files, migrations, validation, and remaining environment
    boundaries separately.

## 3. Module Classification

| Module type                                 | Default implementation                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Ordinary table CRUD                         | Module generator plus CRUD Factory                                      |
| CRUD with simple joins or ownership filters | CRUD Factory with list/data-scope declarations                          |
| Tree data                                   | Explicit tree query plus CRUD Factory where standard writes remain safe |
| Master-detail aggregate                     | Explicit transactional service and routes                               |
| Workflow or state machine                   | Explicit commands, transition validation, audit, and idempotency        |
| Provider/resource configuration             | Explicit secret handling, connection test, enable/default protection    |
| Authentication/security                     | Explicit service and route code only                                    |
| File bytes or physical storage              | Storage service and explicit routes only                                |
| AI streaming/Agent execution                | Runtime service and explicit streaming routes only                      |

Do not use the amount of code as the deciding factor. Choose the pattern from transactional,
security, side-effect, and lifecycle requirements.

## 4. Minimum Module Contract

Before implementation, establish these decisions:

```text
identity: name, title, domain, frontend path, API path
data: table, primary key, fields, defaults, indexes, uniqueness, relations
behavior: list, search, sort, create, edit, delete, status, custom actions
security: page permission, action permissions, data scope, sensitive fields
audit: operation-log actions, risk levels, changed-field handling
ui: page type, table columns, form controls, detail presentation, empty/error states
tests: API success/failure/security/data/side effects and page interaction/visual criteria
delivery: migration, seed, manifest, route registration, generated/manual ownership
```

The machine-readable contract is published as `schemas/admin-module.schema.json` and derived from
`src/shared/module-generator-contract.ts`. The CLI, Web route, and Coding Agent workflow validate
the same contract. Run `pnpm generate:module-schema` after changing it; contract tests reject a
stale published schema.

## 5. Generator Lifecycle

The Web generator at `/system/module/generator` and `pnpm generate:module` produce standard CRUD
drafts. Draft files are review artifacts; they do not become reachable APIs or pages until applied
or published.

Current constraints:

- Automatic Web publishing supports `domain: "system"` only.
- Relationship fields, master-detail pages, workflow transitions, and custom side effects are not
  complete generator contracts.
- Publishing requires a per-file source diff and matching plan hash.
- Publishing applies the plan to an isolated project copy and runs automatic verification before
  mutating the real source tree.
- A publish record stores before/after hashes, backups, validation output, and applied paths.
- Production environments reject generation, source diff preview, publishing, and rollback.

Use the generator for repetitive framework wiring. Add custom behavior in clear handwritten
services, route extensions, or feature components. Never hide generated limitations inside a large
template expression.

## 6. Generated And Handwritten Ownership

Treat these outputs as generator-owned only until the first reviewed publish:

- initial schema and migration snippets
- seed rule/action snippets
- route manifest and route registration snippets
- standard CRUD route and page files
- baseline test files

After publish, all source files are normal repository code. A later regeneration must use a diff and
must not replace handwritten changes automatically. Source rollback verifies that every published
file still matches its recorded after-hash; if a developer changed any file, automatic rollback is
refused. Rollback restores source only and never reverses an already executed database migration.

## 7. Permission And Data Rules

- `sys_rule` is the single permission source of truth.
- Route manifest `auth` binds a page to an existing action permission.
- Hono routes enforce permissions; `AuthButton` only improves the frontend experience.
- Permission names follow `<domain>.<resource>.<action>`.
- Role or data-scope changes that affect abilities must revoke affected tokens according to the
  existing security policy.
- Data scope must be explicit when a record has department, owner, assignee, creator, or other
  ownership semantics.
- Custom scope logic belongs in a reusable scope resolver or an explicit query boundary, not in a
  frontend filter.

## 8. Audit And Secret Rules

Record material mutations with operation, resource, resource ID, success/failure, request ID, risk
level, and sanitized details. Include before/after summaries when they help an auditor understand a
change.

Never log or return passwords, reset tokens, bearer tokens, SMTP passwords, OAuth secrets, S3
secrets, SMS secrets, or AI Provider API keys. Reuse repository encryption and masking services.

## 9. Frontend Delivery Rules

- Keep App Router files thin and portable pages under `src/features/**`.
- Use shared CRUD components for standard pages and `PageScaffold` for every admin work surface.
- Persist reusable list state through the shared URL-state implementation.
- Keep page content full width unless the task has a genuine reading-width constraint.
- Give work surfaces stable height and local scrolling; keep primary actions reachable.
- Add loading, empty, error, permission, narrow-screen, light-theme, and dark-theme acceptance
  criteria to the page test inventory.

Use `.codex/skills/admin-ui/SKILL.md` for the implementation workflow.

## 10. Verification Matrix

| Change                                          | Required verification                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| Documentation or project skill only             | Skill validation, focused diff review                                     |
| Narrow service or utility                       | Typecheck, related tests                                                  |
| API or permission change                        | Typecheck, tests, test-case check, route check                            |
| Page or shared UI change                        | Previous checks plus lint and build when routing/build behavior changes   |
| Schema, auth, file, Provider, generator publish | Full verification and relevant integration tests                          |
| Production workflow                             | Full verification plus smoke in an explicitly configured safe environment |

Commands:

```bash
pnpm admin:verify --quick
pnpm admin:verify --module cms-config
pnpm admin:verify --full
pnpm admin:verify --full --smoke
```

`--smoke` never resets a database, but it performs a real login and requires a running application.

`pnpm typecheck` uses `tsconfig.typecheck.json` and a stable Next type entry. It deliberately
excludes `.next/dev/types`, which is rewritten by a running Next development server and must not be
used as a concurrent release gate. `pnpm build` remains the production route/type validation.

## 11. Failure Recovery

When generation or verification fails:

1. Stop at the first concrete error.
2. Preserve the draft, source changes, database, and user work.
3. Determine whether the failure is contract input, generated code, handwritten behavior,
   environment, or stale documentation.
4. Fix only the responsible layer.
5. Re-run the narrowest failed check, then the package verification.
6. Do not use `db:reset`, destructive cleanup, force push, or test skipping as a shortcut.

## 12. Safe In-Product Development Agent

A future development Agent may call only constrained framework tools:

```text
module_design
module_generate_draft
module_preview_diff
module_validate
module_publish
module_rollback
```

`module_publish` must require Approval, restrict output paths, reject unresolved conflicts, persist
the diff and verification results, and emit an operation log. Arbitrary shell/filesystem tools are
outside the runtime Agent trust boundary.

## 13. Example Requests

Standard CRUD:

```text
Use $admin-module to add a CMS category module with name, slug, status, sort, description,
department data scope, standard permissions, operation logs, API tests, and page acceptance cases.
```

Operational page:

```text
Use $admin-ui to build an order review work surface with a fixed action footer, locally scrolling
detail content, permission-aware approve/reject actions, and complete dark-theme states.
```

Verification:

```text
Use $admin-qa to verify the CMS category package, update missing test inventories, and run the
smallest complete validation set without resetting any database.
```
