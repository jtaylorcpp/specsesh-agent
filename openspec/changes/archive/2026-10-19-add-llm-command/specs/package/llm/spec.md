## Purpose

`specsesh llm` tells an LLM agent how to use specsesh, from text that ships in the package, and prints a starter skill that points at it.

## ADDED Requirements

### Requirement: specsesh llm prints the guide for LLM agents
`main(["llm"])` SHALL print the shipped `docs/llm/guide.md` to stdout and return `0`. In it, `{{version}}` SHALL be replaced by `@specsesh/agent`'s manifest `version` and `{{usage}}` by `USAGE`; no `{{` SHALL remain. It SHALL open no database and call no model.

#### Scenario: The guide carries the usage
- **WHEN** `main(["llm"])` runs
- **THEN** it SHALL return `0`, stdout SHALL begin with `# `, and every line of `USAGE` SHALL appear in stdout

#### Scenario: The guide names its version and leaves no placeholder
- **WHEN** `main(["llm"])` runs
- **THEN** stdout SHALL contain `specsesh <version>`, `<version>` being `version` in `packages/agent/package.json`, and SHALL NOT contain `{{`

#### Scenario: The guide covers the workflow and its rules
- **WHEN** `main(["llm"])` runs
- **THEN** stdout SHALL name `specsesh change draft`, `specsesh change approve`, `specsesh change build`, `specsesh change close`, `specsesh task answer` and `specsesh agent list`
- **AND** it SHALL say that specsesh never commits and that only the principal approves

### Requirement: specsesh llm skill prints a starter skill
`main(["llm", "skill"])` SHALL print the shipped `templates/SKILL.md`, with `{{version}}` replaced as for the guide, and return `0`. It SHALL open with YAML front matter between two `---` lines holding `name: specsesh` and a one-line `description`. Its body SHALL tell the model to run `specsesh llm` before using the CLI and never to approve or answer as the principal on its own.

#### Scenario: The skill has front matter
- **WHEN** `main(["llm", "skill"])` runs
- **THEN** stdout's first line SHALL be `---`, a later line SHALL be `name: specsesh`, a line SHALL start with `description: ` and have more after it, and a later line SHALL be `---`

#### Scenario: The skill points at the guide
- **WHEN** `main(["llm", "skill"])` runs
- **THEN** the body after the front matter SHALL contain `specsesh llm` and `principal`, and stdout SHALL NOT contain `{{`

### Requirement: specsesh llm skill --out writes the skill without overwriting
`main(["llm", "skill", "--out", path])` SHALL write the skill to `path`, creating missing parent directories, print `wrote <path>` and return `0`. When `path` already exists it SHALL print why to stderr, return `1` and leave the file unchanged.

#### Scenario: Write into a new directory
- **WHEN** `main(["llm", "skill", "--out", ".claude/skills/specsesh/SKILL.md"])` runs in an empty directory
- **THEN** it SHALL return `0`, and that file SHALL exist with exactly what `main(["llm", "skill"])` prints

#### Scenario: No overwrite
- **WHEN** the file exists and `main(["llm", "skill", "--out", path])` runs
- **THEN** it SHALL return `1` and the file SHALL be unchanged

### Requirement: The usage names llm
`USAGE` SHALL have the line `specsesh llm [skill [--out <path>]]`. `main(["llm", "--help"])` SHALL print the llm usage to stdout and return `0`. An unknown `llm` subcommand or flag, or `--out` without a path, SHALL print the llm usage to stderr and return `2`.

#### Scenario: Help lists llm
- **WHEN** `main(["--help"])` runs
- **THEN** stdout SHALL have the line `  specsesh llm [skill [--out <path>]]`

#### Scenario: An unknown llm subcommand prints usage
- **WHEN** `main(["llm", "frobnicate"])` and `main(["llm", "skill", "--out"])` run
- **THEN** each SHALL return `2` with stderr beginning `usage: specsesh llm`

### Requirement: The guide and the skill ship in the package
`docs/llm/guide.md` and `templates/SKILL.md` SHALL be in `@specsesh/agent`'s packed files, and its build SHALL fail when either is missing.

#### Scenario: Both are packed
- **WHEN** `npm pack --dry-run --json` runs in `packages/agent`
- **THEN** its file list SHALL include `docs/llm/guide.md` and `templates/SKILL.md`

#### Scenario: The build requires them
- **WHEN** `scripts/check-assets.mjs` runs with `docs/llm/guide.md` missing
- **THEN** it SHALL exit `1` naming that path
