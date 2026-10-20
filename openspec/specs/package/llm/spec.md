# package/llm Specification

## Purpose
`specsesh llm` tells an LLM agent how to use specsesh, from text that ships in the package, and prints a starter skill that points at it.

## Requirements

### Requirement: specsesh llm prints the guide for LLM agents
`main(["llm"])` SHALL print the shipped `docs/llm/guide.md` to stdout and return `0`, with `{{version}}` replaced by `@specsesh/agent`'s manifest `version` and `{{usage}}` by `USAGE`; no `{{` SHALL remain. The guide SHALL be a map of at most 60 lines that names `specsesh <command> help` for each of `change`, `task`, `agent` and `durable`. It SHALL open no database and call no model.

#### Scenario: The guide carries the usage
- **WHEN** `main(["llm"])` runs
- **THEN** it SHALL return `0`, stdout SHALL begin with `# `, and every line of `USAGE` SHALL appear in stdout

#### Scenario: The guide names its version and leaves no placeholder
- **WHEN** `main(["llm"])` runs
- **THEN** stdout SHALL contain `specsesh <version>`, `<version>` being `version` in `packages/agent/package.json`, and SHALL NOT contain `{{`

#### Scenario: The guide covers the workflow and its rules
- **WHEN** `main(["llm"])` runs
- **THEN** stdout SHALL have at most 60 lines and SHALL contain `specsesh change help`, `specsesh task help`, `specsesh agent help` and `specsesh durable help`
- **AND** it SHALL say that specsesh never commits and that only the principal approves

### Requirement: specsesh llm skill prints a starter skill
`main(["llm", "skill"])` SHALL print the shipped `templates/SKILL.md`, with `{{version}}` replaced as for the guide, and return `0`. It SHALL open with YAML front matter between two `---` lines holding `name: specsesh` and a one-line `description`. Its body SHALL tell the model to run `specsesh llm`, then `specsesh <command> help` before it first uses a command, and never to approve or answer as the principal on its own.

#### Scenario: The skill has front matter
- **WHEN** `main(["llm", "skill"])` runs
- **THEN** stdout's first line SHALL be `---`, a later line SHALL be `name: specsesh`, a line SHALL start with `description: ` and have more after it, and a later line SHALL be `---`

#### Scenario: The skill points at the guide
- **WHEN** `main(["llm", "skill"])` runs
- **THEN** the body after the front matter SHALL contain `specsesh llm`, `specsesh <command> help` and `principal`, and stdout SHALL NOT contain `{{`

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
`docs/llm/guide.md`, the command pages `docs/llm/change.md`, `task.md`, `agent.md` and `durable.md`, and `templates/SKILL.md` SHALL be in `@specsesh/agent`'s packed files, and its build SHALL fail when any is missing.

#### Scenario: Both are packed
- **WHEN** `npm pack --dry-run --json` runs in `packages/agent`
- **THEN** its file list SHALL include `docs/llm/guide.md`, `docs/llm/change.md`, `docs/llm/task.md`, `docs/llm/agent.md`, `docs/llm/durable.md` and `templates/SKILL.md`

#### Scenario: The build requires them
- **WHEN** `scripts/check-assets.mjs` runs with `docs/llm/guide.md` or `docs/llm/task.md` missing
- **THEN** it SHALL exit `1` naming that path

### Requirement: specsesh <command> help explains the command in depth
For `change`, `task`, `durable` and `agent`, `main([command, h])` with `h` one of `help`, `--help` or `-h` and nothing after it SHALL print to stdout that command's full usage, a blank line, then `docs/llm/<command>.md` with `{{version}}` filled, and return `0`. It SHALL open no database and call no model, and `task` SHALL not take `help` as a change.

#### Scenario: Each command explains itself
- **WHEN** `main([command, "help"])` runs for each of `change`, `task`, `durable` and `agent`
- **THEN** each SHALL return `0` with nothing on stderr, stdout SHALL begin with `usage:` and contain `specsesh <command>`, and stdout SHALL contain the first heading line of `docs/llm/<command>.md`

#### Scenario: --help and -h say the same
- **WHEN** `main(["change", "--help"])` and `main(["change", "-h"])` run
- **THEN** each SHALL print exactly what `main(["change", "help"])` prints and return `0`

#### Scenario: task help is not a change
- **WHEN** `main(["task", "help"])` runs
- **THEN** it SHALL return `0` and stdout SHALL NOT contain `give exactly one of`

#### Scenario: agent help still lists every subcommand
- **WHEN** `main(["agent", "help"])` runs
- **THEN** every line of the agent usage SHALL appear in stdout

#### Scenario: durable help names specsesh
- **WHEN** `main(["durable", "help"])` runs
- **THEN** stdout SHALL contain `specsesh durable run` and SHALL NOT contain `agentscript-durable`
