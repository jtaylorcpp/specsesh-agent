# package/command

## MODIFIED Requirements

### Requirement: specsesh routes four commands to their CLIs
`@specsesh/agent/cli` SHALL export `main(argv, deps)` and `USAGE`. `main` SHALL route `agent`, `durable`, `task` or `change` to the `main` of `agentscript-pi`, `agentscript-durable`, `agentscript-task` or `agentscript-change` with the remaining arguments (and `deps` for the last three), and return its exit code. `agent` SHALL reach `agentscript-pi` only after `main` has taken out `package/explain`'s subcommands and the agent usage. Importing the entry SHALL print nothing and exit nothing.

#### Scenario: change routes to the change CLI
- **WHEN** `main(["change"])` runs
- **THEN** it SHALL return `2` and stderr SHALL be the usage `agentscript-change` prints with no arguments

#### Scenario: durable routes to the durable CLI
- **WHEN** `main(["durable", "run"])` runs
- **THEN** it SHALL return what `agentscript-durable`'s `main(["run"])` returns, with the same stderr

#### Scenario: agent routes to the pi CLI
- **WHEN** `main(["agent", "run"])` runs
- **THEN** it SHALL return `2` and stderr SHALL begin with `usage:` and contain `agentscript-pi run <file>`

#### Scenario: agent alone prints the agent usage
- **WHEN** `main(["agent"])` runs
- **THEN** it SHALL return `2` and stderr SHALL begin with `usage:` and name `specsesh agent run`, `models`, `list`, `show`, `new`, `check`, `language` and `actions`

#### Scenario: Importing the cli entry runs nothing
- **WHEN** a Node process imports `@specsesh/agent/cli` and does nothing else
- **THEN** it SHALL exit `0` with empty stdout and stderr

### Requirement: specsesh prints its usage and its version
With no argument or an unknown first argument, `main` SHALL print `USAGE` to stderr and return `2`. With `--help`, `-h` or `help` it SHALL print `USAGE` to stdout and return `0`. With `--version` or `-v` it SHALL print `specsesh <version>`, `<version>` being `@specsesh/agent`'s manifest `version`, and return `0`. None of these SHALL open a database or call a model.

#### Scenario: No command prints usage
- **WHEN** `main([])` runs
- **THEN** stderr SHALL begin with `usage:` and it SHALL return `2`
- **AND** stderr SHALL list `specsesh change <draft|approve|build|close> <change> [options]`, `specsesh task <change> <task-id>|<group>|--next|--next-group [options]`, `specsesh task <run|spec|resume|answer|status> [options]`, `specsesh durable <run|resume> [options]`, `specsesh agent <run|models|list|show|new|check|language|actions> [options]`, `specsesh --version` and `specsesh --help`

#### Scenario: --help prints usage to stdout
- **WHEN** `main(["--help"])`, `main(["-h"])` and `main(["help"])` run
- **THEN** each SHALL print `USAGE` to stdout, nothing to stderr, and return `0`

#### Scenario: An unknown command prints usage
- **WHEN** `main(["frobnicate"])` runs
- **THEN** stderr SHALL contain `usage:` and it SHALL return `2`

#### Scenario: --version prints the manifest's version
- **WHEN** `main(["--version"])` and `main(["-v"])` run
- **THEN** each SHALL print exactly `specsesh <version>` to stdout, `<version>` being `version` in `packages/agent/package.json`, and return `0`
