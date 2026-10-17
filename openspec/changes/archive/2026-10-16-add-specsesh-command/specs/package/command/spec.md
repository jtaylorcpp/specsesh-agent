## Purpose
The `specsesh` command: one entry, `@specsesh/agent/cli`, whose `main` routes `agent`, `durable`, `task` and `change` to the package's four CLIs, and prints its own usage and version.

## ADDED Requirements

### Requirement: specsesh routes four commands to their CLIs
`@specsesh/agent/cli` SHALL export `main(argv, deps)` and `USAGE`. `main` SHALL route a first argument of `agent`, `durable`, `task` or `change` to the `main` of `agentscript-pi`, `agentscript-durable`, `agentscript-task` or `agentscript-change`, passing the remaining arguments, and `deps` to the three that take them, and SHALL return that `main`'s exit code. Importing the entry SHALL print nothing and exit nothing.

#### Scenario: change routes to the change CLI
- **WHEN** `main(["change"])` runs
- **THEN** it SHALL return `2` and stderr SHALL be the usage `agentscript-change` prints with no arguments

#### Scenario: durable routes to the durable CLI
- **WHEN** `main(["durable", "run"])` runs
- **THEN** it SHALL return what `agentscript-durable`'s `main(["run"])` returns, with the same stderr

#### Scenario: agent routes to the pi CLI
- **WHEN** `main(["agent"])` runs
- **THEN** it SHALL return `2` and stderr SHALL begin with `usage:` and contain `agentscript-pi run <file>`

#### Scenario: Importing the cli entry runs nothing
- **WHEN** a Node process imports `@specsesh/agent/cli` and does nothing else
- **THEN** it SHALL exit `0` with empty stdout and stderr

### Requirement: task implies run as pnpm task does
When the argument after `task` is neither one of `run`, `spec`, `resume`, `answer` or `status` nor starts with `-`, `main` SHALL insert `run` before it, so `specsesh task <change> <task-id>` is `agentscript-task run <change> <task-id>`. Any other `task` arguments SHALL pass through unchanged.

#### Scenario: A change and a task id imply run
- **WHEN** `main(["task", "no-such-change", "1.1"])` runs in a repository with no such change
- **THEN** it SHALL return the exit code and stderr of `agentscript-task`'s `main(["run", "no-such-change", "1.1"])`

#### Scenario: A task command passes through
- **WHEN** `main(["task", "status", "--db", "<missing>"])` runs
- **THEN** it SHALL return the exit code and output of `agentscript-task`'s `main(["status", "--db", "<missing>"])`, not of `run`

### Requirement: specsesh prints its usage and its version
With no argument or an unknown first argument, `main` SHALL print `USAGE` to stderr and return `2`. With `--help`, `-h` or `help` it SHALL print `USAGE` to stdout and return `0`. With `--version` or `-v` it SHALL print `specsesh <version>`, `<version>` being `@specsesh/agent`'s manifest `version`, and return `0`. None of these SHALL open a database or call a model.

#### Scenario: No command prints usage
- **WHEN** `main([])` runs
- **THEN** stderr SHALL begin with `usage:` and it SHALL return `2`
- **AND** stderr SHALL list `specsesh change <draft|approve|build|close> <change> [options]`, `specsesh task <change> <task-id>|<group>|--next|--next-group [options]`, `specsesh task <run|spec|resume|answer|status> [options]`, `specsesh durable <run|resume> [options]`, `specsesh agent <run|models> [options]`, `specsesh --version` and `specsesh --help`

#### Scenario: --help prints usage to stdout
- **WHEN** `main(["--help"])`, `main(["-h"])` and `main(["help"])` run
- **THEN** each SHALL print `USAGE` to stdout, nothing to stderr, and return `0`

#### Scenario: An unknown command prints usage
- **WHEN** `main(["frobnicate"])` runs
- **THEN** stderr SHALL contain `usage:` and it SHALL return `2`

#### Scenario: --version prints the manifest's version
- **WHEN** `main(["--version"])` and `main(["-v"])` run
- **THEN** each SHALL print exactly `specsesh <version>` to stdout, `<version>` being `version` in `packages/agent/package.json`, and return `0`
