## ADDED Requirements

### Requirement: Commands that run openspec refuse one below 1.14.1
Before any model call or write, `draft`, `approve`, `close` and `build --amend` SHALL call `checkOpenspec(workspace)`, comparing the resolved version numerically on `major.minor.patch` with `OPENSPEC_MIN_VERSION`, `1.14.1`. Below it, or `null`, SHALL print one stderr line `openspec <version> at <path> is below the minimum supported version 1.14.1`, `<version>` being `(version unknown)` when `null`, and exit `2`. Other `build` runs SHALL NOT check.

#### Scenario: An old PATH openspec refuses draft
- **GIVEN** no project copy, and `/usr/local/bin/openspec` on PATH printing `1.9.0`
- **WHEN** `node packages/agent/dist/bin/agentscript-change.js draft add-spec-amendments-cli` runs
- **THEN** stderr SHALL be `openspec 1.9.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1` and the exit code SHALL be `2`
- **AND** no loop SHALL start, no model SHALL be called, and nothing SHALL be written

#### Scenario: 1.14.0 refuses close
- **GIVEN** `add-plan-export` ready to close, and the resolved openspec `/usr/local/bin/openspec` printing `1.14.0`
- **WHEN** `close add-plan-export` runs
- **THEN** stderr SHALL be `openspec 1.14.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1`, the exit code SHALL be `2`, and `openspec/` SHALL be unchanged

#### Scenario: An old openspec refuses --amend
- **GIVEN** `add-plan-export` blocked on an escalation carrying an `Amendment`, and the resolved openspec at `1.9.0`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** it SHALL exit `2` with the refusal line, the delta SHALL be unchanged, no `amended` line SHALL be printed, and no loop SHALL be answered

#### Scenario: An unreadable version refuses approve
- **GIVEN** the resolved openspec `/opt/tools/openspec`, whose `--version` prints no `x.y.z`
- **WHEN** `approve add-plan-export` runs
- **THEN** stderr SHALL be `openspec (version unknown) at /opt/tools/openspec is below the minimum supported version 1.14.1` and the exit code SHALL be `2`

#### Scenario: A text answer to build is not checked
- **GIVEN** the only openspec is `/usr/local/bin/openspec` on PATH printing `1.9.0`, and `add-plan-export` blocked asking `Which API?`
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no version refusal SHALL be printed, and the loop SHALL be answered with decision `Use the v2 API`
- **AND** `openspec --version` SHALL NOT have run before the answer is recorded

### Requirement: close and --amend run the openspec resolved for the repository
`close`'s `openspec validate <change> --strict` check and trial fold, and `build --amend`'s validation, SHALL run openspec through `runOpenspec` with the bin resolved for the repository's workspace, also in the temporary copy of `openspec/`, which SHALL NOT be resolved itself. When no openspec is found, nothing SHALL be refused up front; the command SHALL fail its validation as before.

#### Scenario: The trial fold uses the repository's openspec
- **GIVEN** `/repo/node_modules/.bin/openspec` at `1.14.1` and `add-plan-export` ready to close
- **WHEN** `close add-plan-export` runs its trial fold in a temporary copy of `openspec/` with no `node_modules`
- **THEN** `openspec archive add-plan-export --yes` there SHALL spawn `/repo/node_modules/.bin/openspec` with `OPENSPEC_TELEMETRY=0`

#### Scenario: A missing openspec is not a version refusal
- **GIVEN** neither the project's `node_modules/.bin` nor PATH has `openspec`
- **WHEN** `close add-plan-export` runs
- **THEN** stderr SHALL NOT contain `below the minimum supported version`, the exit code SHALL be `2`, and `openspec/` SHALL be unchanged
