# package/usage-docs Specification

## Purpose
The shipped pages on reaching a model and choosing where to run: one page per provider, one per deployment, and a checked matrix of which pairs work, so setup lives in one place and can't drift from the code.

## Requirements

### Requirement: The provider and deployment pages ship
`@specsesh/agent` SHALL ship `docs/providers/README.md`, `docs/providers/{api-keys,claude-code,gemini,ollama,workers-ai}.md` and `docs/deploy/{local,cloudflare}.md` in its packed files, and its build SHALL fail when any is missing.

#### Scenario: The pages are packed
- **WHEN** `npm pack --dry-run --json` runs in `packages/agent`
- **THEN** its file list SHALL include all eight pages

#### Scenario: The build requires them
- **WHEN** `scripts/check-assets.mjs` runs with `docs/deploy/cloudflare.md` missing
- **THEN** it SHALL exit `1` naming that path

### Requirement: Each page has the same shape
Each page SHALL open with a `# ` heading, then a one-line summary paragraph. Each provider page SHALL have, in order, `## Setup`, `## Models`, `## Where it runs` and `## Limits`. Each deployment page SHALL have, in order, `## Setup`, `## Providers`, `## Running and resuming` and `## Limits`.

#### Scenario: Every page has its sections
- **WHEN** the usage-docs test reads the eight pages
- **THEN** each SHALL start with `# ` and a summary line, and carry its sections in order

### Requirement: The matrix says which provider runs where
`docs/providers/README.md` SHALL hold one Markdown table with columns `provider`, `agent`, `durable`, `task`, `change` and `cloudflare`, and rows `api-keys`, `claude-code`, `gemini`, `ollama` and `workers-ai`, each cell `yes` or `no`: `api-keys` and `gemini` yes everywhere; `claude-code` and `ollama` yes except `cloudflare`; `workers-ai` yes only in `cloudflare`. Each local `yes` SHALL name a provider the CLIs' collection resolves.

#### Scenario: The matrix holds the agreed values
- **WHEN** the usage-docs test parses the table
- **THEN** every cell SHALL equal the value this requirement gives

#### Scenario: Each local yes resolves
- **GIVEN** the CLIs' model collection, with `ollama` registered against a fake server and row `gemini` naming provider `google`
- **WHEN** the test checks the `durable` column
- **THEN** `anthropic`, `claude-code`, `google` and `ollama` SHALL each be a provider in it, and `workers-ai` SHALL not

### Requirement: Links and scripts in the pages hold
Every relative link in the eight pages SHALL resolve to a file in the repository, and every `.agent` path they name SHALL exist and pass `specsesh agent check`.

#### Scenario: A broken link fails by name
- **WHEN** a test points a link in `docs/deploy/local.md` at a missing file
- **THEN** the usage-docs test SHALL fail naming `local.md` and the link

### Requirement: The readme points at the pages
`packages/agent/README.md` SHALL link each of the eight pages. Its `## Durable runs on Node` and `## On Cloudflare` sections SHALL each be at most 40 lines and link `docs/deploy/local.md` and `docs/deploy/cloudflare.md` respectively. It SHALL NOT say a Cloudflare host runs without actions.

#### Scenario: The readme links every page
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL link all eight pages, both sections SHALL be at most 40 lines, and it SHALL NOT contain `without actions`
