---
name: admin-module
description: Design, generate, implement, and extend Admin Base business modules while preserving the repository's CRUD Factory, PostgreSQL, permission, data-scope, audit, frontend, and test contracts. Use when adding a module or entity, generating CRUD, designing a CMS/order/product/provider module, adding custom module actions, or deciding between generated CRUD and explicit route/service code.
---

# Admin Module

Use the repository contract in `AGENTS.md`. Read `docs/ai-development-guide.md` and
`docs/business-module-template.md` before implementation.

## Workflow

1. Inspect `git status`, the closest existing module, schema, migrations, seed, route manifest,
   backend registration, frontend page, and tests. Preserve unrelated changes.
2. Define actors, lifecycle, fields, relations, permissions, data ownership, side effects, secret
   handling, and acceptance criteria.
   Classify visibility as global, department-owned, user-owned, department-and-user-owned, or
   custom. User-generated records with no visibility decision are not ready for generation.
3. Classify the module and select the implementation pattern.
4. Establish the minimum module contract from `docs/ai-development-guide.md`.
5. Generate a draft only when the current generator supports the module shape.
6. Review the generated diff before applying or publishing it.
7. Add explicit custom behavior outside generic CRUD where required.
8. Register API and page test contracts.
9. Run `$admin-qa` or the required `pnpm admin:verify` scope.
10. Report generated files, handwritten files, migrations, validation, and remaining environment
    boundaries separately.

## Classify Before Coding

Use CRUD Factory for ordinary relational CRUD that fits Drizzle table objects, Zod schemas, list
configuration, declared data scope, standard actions, and transaction-aware hooks.

Use explicit routes and services for:

- passwords, authentication, tokens, OAuth, and other security flows
- file bytes, storage side effects, physical deletion, and external Provider calls
- AI streaming, Agent execution, and approval state
- publish/revoke commands, workflow transitions, master-detail transactions, and idempotent commands

Use a hybrid when standard metadata CRUD is safe but custom actions need explicit commands. Do not
hide a state machine or external side effect inside a CRUD hook.

## Required Pieces

Every reachable module needs the applicable pieces:

- Drizzle schema and migration
- idempotent seed route/action permissions
- route manifest binding
- backend route and domain registration
- thin App Router shell and `src/features/**` page
- server-side permissions and frontend `AuthButton`
- explicit data-scope decision
- operation logging for material mutations
- machine-readable API/page test cases and focused automated tests

Keep permission codes in `<domain>.<resource>.<action>` form. Treat `sys_rule` as authoritative.

## Generator Rules

Use `pnpm generate:module -- --config <file>` or `/system/module/generator` for supported standard
CRUD drafts. Automatic Web publishing currently supports `domain: "system"` only.

Do not publish when the user asked only for analysis or preview. Do not overwrite handwritten
source during regeneration. Relationship-heavy, tree, workflow, master-detail, and non-system
domain modules require explicit design until their generator capabilities and domain registry land.
Use `schemas/admin-module.schema.json` as the module input contract. Before publication, review the
plan hash and per-file diff; rely on isolated preflight and rollback metadata rather than applying
snippets manually.

Keep generator configs inside the declared capabilities. Names are kebab-case and `query` is
mandatory. The standard generated page directly supports query/create/update/delete. Batch delete,
restore, force delete, and status APIs need explicit module UI; delete-family APIs share the delete
ability. Regenerate old drafts when the server reports missing contract snippets.

## Completion Gate

Do not call a module complete until:

- visibility is explicitly global or mapped to persisted ownership fields and server-side defaults
- permissions exist in seed and pass route checks
- unauthorized and out-of-scope access are rejected
- sensitive values are encrypted, hashed, omitted, or masked
- mutations are audited at the correct risk level
- API and page inventories describe success and failure behavior
- the required verification scope passes
