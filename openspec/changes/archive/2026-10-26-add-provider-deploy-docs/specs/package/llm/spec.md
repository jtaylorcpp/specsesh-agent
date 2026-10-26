## MODIFIED Requirements

### Requirement: specsesh llm prints the guide for LLM agents
`main(["llm"])` SHALL print the shipped `docs/llm/guide.md` to stdout and return `0`, with `{{version}}` replaced by `@specsesh/agent`'s manifest `version` and `{{usage}}` by `USAGE`; no `{{` SHALL remain. The guide SHALL be a map of at most 60 lines that names `specsesh <command> help` for each of `change`, `task`, `agent` and `durable`, and `specsesh llm providers` and `specsesh llm deploy`. It SHALL open no database and call no model.

#### Scenario: The guide carries the usage
- **WHEN** `main(["llm"])` runs
- **THEN** it SHALL return `0`, stdout SHALL begin with `# `, and every line of `USAGE` SHALL appear in stdout

#### Scenario: The guide names its version and leaves no placeholder
- **WHEN** `main(["llm"])` runs
- **THEN** stdout SHALL contain `specsesh <version>`, `<version>` being `version` in `packages/agent/package.json`, and SHALL NOT contain `{{`

#### Scenario: The guide covers the workflow and its rules
- **WHEN** `main(["llm"])` runs
- **THEN** stdout SHALL have at most 60 lines and SHALL contain `specsesh change help`, `specsesh task help`, `specsesh agent help`, `specsesh durable help`, `specsesh llm providers` and `specsesh llm deploy`
- **AND** it SHALL say that specsesh never commits and that only the principal approves

### Requirement: The usage names llm
`USAGE` SHALL have the line `specsesh llm [skill [--out <path>] | providers [<name>] | deploy <local|cloudflare>]`. `main(["llm", "--help"])` SHALL print the llm usage to stdout and return `0`. An unknown `llm` subcommand or flag, or `--out` without a path, SHALL print the llm usage to stderr and return `2`.

#### Scenario: Help lists llm
- **WHEN** `main(["--help"])` runs
- **THEN** stdout SHALL have the line `  specsesh llm [skill [--out <path>] | providers [<name>] | deploy <local|cloudflare>]`

#### Scenario: An unknown llm subcommand prints usage
- **WHEN** `main(["llm", "frobnicate"])` and `main(["llm", "skill", "--out"])` run
- **THEN** each SHALL return `2` with stderr beginning `usage: specsesh llm`

## ADDED Requirements

### Requirement: specsesh llm providers and deploy print the shipped pages
`main(["llm", "providers"])` SHALL print `docs/providers/README.md`; `main(["llm", "providers", <name>])` SHALL print `docs/providers/<name>.md` for `api-keys`, `claude-code`, `ollama` or `workers-ai`; `main(["llm", "deploy", <target>])` SHALL print `docs/deploy/<target>.md` for `local` or `cloudflare`. Each SHALL return `0`, opening no database and calling no model. Any other name, or `deploy` with no target, SHALL print the llm usage to stderr and return `2`.

#### Scenario: providers prints the matrix
- **WHEN** `main(["llm", "providers"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/providers/README.md`

#### Scenario: A provider page prints by name
- **WHEN** `main(["llm", "providers", "ollama"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/providers/ollama.md`

#### Scenario: A deployment page prints by name
- **WHEN** `main(["llm", "deploy", "cloudflare"])` runs
- **THEN** it SHALL return `0` and stdout SHALL equal `docs/deploy/cloudflare.md`

#### Scenario: An unknown page prints usage
- **WHEN** `main(["llm", "providers", "nope"])` and `main(["llm", "deploy"])` run
- **THEN** each SHALL return `2` with stderr beginning `usage: specsesh llm`
