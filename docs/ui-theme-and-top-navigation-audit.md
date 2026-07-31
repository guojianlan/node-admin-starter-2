# UI Theme And Top Navigation Audit

## Scope

This audit covers every route currently declared in `src/router/route-manifest.ts` and the four shell layouts: side, top, mixed, and columns. The goal is to keep the existing Ant Design administration language while making the shell hierarchy and light/dark theme behavior predictable.

Audit date: 2026-07-15

Desktop evidence: `tmp/product-design-audit-2026-07-15`

## Design Strategy

### Navigation hierarchy

- Top layout uses two persistent rows: the main header navigation and the page workspace tabs.
- Side and columns layouts use the header breadcrumb plus their left navigation and page tabs.
- Mixed layout uses the root navigation in the header, the active root's side navigation, and page tabs.
- A route has one active navigation signal per navigation layer. Active states use a restrained primary tint instead of large button-like blocks.
- Header navigation items use content-driven widths. Tool commands remain icon buttons with tooltips.

### Theme contract

- `--admin-bg` is the application canvas.
- `--admin-surface` is the primary card, table, drawer, and editor surface.
- `--admin-surface-muted` is used for filters, table headers, secondary panels, hover states, and code blocks.
- `--admin-border` and `--admin-border-soft` define structural and subtle boundaries.
- `--admin-text` and `--admin-muted` define primary and secondary text.
- `--admin-primary` and `--admin-primary-bg` define selection, focus, and active navigation.
- Semantic colors may identify status, but their backgrounds and borders must be mixed with the active surface rather than assuming a white canvas.

Custom components must not hardcode white panels, black body text, or light-only table headers. Intentionally light document canvases such as rendered Office files and spreadsheet previews are exceptions.

### Typography

The application keeps its existing system and Ant Design font stack. The perceived dark-theme typography defects came from contrast and hierarchy errors, not from a missing font. Page titles use the primary text token and semibold weight; descriptions and metadata use the muted token; compact controls retain the 14px base size and normal letter spacing.

## Route Coverage

### Core and identity

- `/dashboard`: shared cards, charts, status labels, loading, empty, and error states.
- `/profile`: profile identity, security settings, OAuth accounts, and login history.

### Organization and permissions

- `/system/user`: search, toolbar, table, tags, and forms.
- `/system/role`: role table and shared right-side detail surface.
- `/system/rule`: custom tree table, tags, expand controls, column settings, and drawer.
- `/system/dept`: organization tree and department detail surface.

### Configuration and resources

- `/system/dict` and `/system/dict/item`: master-detail workbench and standard CRUD table.
- `/system/config`: configuration group and item workbench.
- `/system/settings`: grouped settings, resource summaries, and policy forms.
- `/system/file`: folder workbench, uploads, previews, audio player, and recycle bin.
- `/system/storage`: storage resource table, tests, and secret states.
- `/system/mail/account`: mail resource table, tests, and secret states.
- `/system/oauth/provider`: provider resource table and configuration drawer.
- `/system/sms/provider` and `/system/sms/template`: provider and template CRUD surfaces.

### Monitoring and content

- `/system/operation/log`: filters, risk tags, JSON details, export, and cleanup.
- `/system/login/log`: filters, status tags, details, and cleanup.
- `/system/online/user`: session table and forced logout actions.
- `/system/notice`: notice editor, publication scope, status, and read statistics.

### AI and development tools

- `/system/ai/provider`: provider CRUD and streaming test dialog.
- `/system/ai/model`: compatible model CRUD and test workflow.
- `/system/ai/playground`: input controls and streaming Markdown output.
- `/system/ai/chat`: session navigation, user/system/assistant messages, model state, and approval output.
- `/system/ai/agent`: agent definitions, tools, runs, steps, and approvals.
- `/system/module/generator`: draft and published module management.

## Findings And Resolution

### P1: top layout consumed three navigation rows

The header, detached top-menu toolbar, and page tabs consumed 144px before content and made root menu items look like unrelated buttons. The top menu now renders inside the header. The detached toolbar is removed and page tabs remain directly below the header.

### P1: custom light surfaces bypassed dark tokens

The rule table, role/dept/config/file side cards, rich-text editor, image picker, dashboard cards, AI streaming output, AI Chat messages, and file/audio utility surfaces used light-only colors. These surfaces now use the shared semantic tokens. Office and spreadsheet content canvases remain intentionally light.

### P2: header identity control was visually detached in dark mode

The user control used a translucent light capsule in every theme. It now uses the active theme's muted surface, border, primary hover tint, and text color.

### P2: AI output formatting assumed a white canvas

Streaming Markdown previously embedded fixed gray and white values in React styles. It now uses semantic CSS classes for headings, body text, blockquotes, inline code, code blocks, tables, and separators. AI Chat session selection and message roles use the same theme contract.

## Acceptance Rules

- Switching theme changes every shell and custom application surface without reloading.
- Top layout has no detached menu toolbar and retains access to all root and nested routes.
- Page tabs remain sticky directly below the header in every desktop layout.
- Primary and secondary text meet readable contrast against their active surface.
- No route introduces a new hardcoded white application panel or black body text.
- Light document previews remain legible and visually separated from the dark application chrome.
- Desktop routes do not overlap, clip controls, or create incoherent nested cards.
- Mobile retains the drawer navigation and static page tabs.
