## MODIFIED Requirements

### Requirement: The repo wires the runner in
The root `package.json` SHALL have a `task` script `node packages/specsesh/bin/specsesh.js task`, so `pnpm task <change-id> <task-id>` runs `specsesh task` with `run` implied, and a `test:live` script running the live run. `.gitignore` SHALL list `.agentscript/`. `CLAUDE.md` SHALL have a section on running a task: the command, `--next`, `status`, answering an escalation, and that the runner never commits.

#### Scenario: The database directory is ignored
- **WHEN** `.gitignore` is read
- **THEN** it SHALL contain a line `.agentscript/`

#### Scenario: pnpm task runs specsesh task
- **WHEN** the root `package.json` is read
- **THEN** `scripts.task` SHALL be `node packages/specsesh/bin/specsesh.js task`
- **AND** `node packages/specsesh/bin/specsesh.js task status --db <missing>` SHALL print `no loops in <missing>` and exit `0`

#### Scenario: The old task bin prints the specsesh usage
- **GIVEN** a build of `packages/agent`
- **WHEN** `node packages/agent/dist/bin/agentscript-task.js` runs with no arguments
- **THEN** it SHALL exit `2` and stderr SHALL equal what `node packages/specsesh/bin/specsesh.js task` prints
