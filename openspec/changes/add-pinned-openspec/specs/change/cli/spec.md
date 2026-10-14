## ADDED Requirements

### Requirement: Commands that run openspec refuse one that is too old
Before any model call or write, `draft`, `approve`, `close` and `build --amend` SHALL call `checkOpenspec` for the workspace (the directory holding `openspec/`) and, on `{ ok: false }`, print its message as one line to stderr and exit `2`, starting no loop and writing nothing. `build` without `--amend` SHALL NOT run the check.

#### Scenario: draft refuses an old openspec
- **GIVEN** no project openspec, and `/usr/local/bin/openspec` printing `1.9.0` on PATH
- **WHEN** `node packages/agent/dist/bin/agentscript-change.js draft add-spec-amendments-cli` runs
- **THEN** stderr SHALL be `openspec 1.9.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1` and the exit code SHALL be `2`
- **AND** no loop SHALL start, no model SHALL be called, and nothing SHALL be written

#### Scenario: approve refuses an unreadable version
- **GIVEN** the resolved openspec is `/opt/tools/openspec`, whose `--version` prints no `x.y.z`
- **WHEN** `approve add-plan-export` runs
- **THEN** stderr SHALL be `openspec (version unknown) at /opt/tools/openspec is below the minimum supported version 1.14.1` and the exit code SHALL be `2`

#### Scenario: close refuses an old openspec
- **GIVEN** the resolved openspec is `1.9.0` at `/usr/local/bin/openspec`
- **WHEN** `close add-plan-export` runs
- **THEN** it SHALL print the refusal and exit `2`, and `openspec/` SHALL be unchanged

#### Scenario: --amend refuses an old openspec
- **GIVEN** the resolved openspec is `1.9.0`, and `add-plan-export` blocked on an escalation carrying an `Amendment`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** it SHALL print the refusal and exit `2`, the delta SHALL not be written, and no loop SHALL be answered

#### Scenario: A text answer to build is not checked
- **GIVEN** the only openspec is `1.9.0` on PATH, and `add-plan-export` blocked asking `Which API?`
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** openspec `--version` SHALL not run and no refusal SHALL be printed

### Requirement: close and --amend run the repository's resolved openspec
`close`'s `openspec validate <change> --strict` refusal check and trial fold, and `build --amend`'s validation, SHALL run openspec through `runOpenspec` with the openspec resolved once for the workspace, also when the working directory is the temporary copy of `openspec/`. They SHALL NOT spawn a bare `openspec` or resolve from the temporary directory.

#### Scenario: The trial fold uses the repository's openspec
- **GIVEN** a workspace `/repo` whose `node_modules/.bin/openspec` is `1.14.1`, and `/usr/local/bin/openspec` on PATH
- **WHEN** `close add-plan-export` runs its trial fold in a temporary copy of `openspec/` without `node_modules`
- **THEN** `archive add-plan-export --yes` and `validate --specs --strict` SHALL run `/repo/node_modules/.bin/openspec` with `OPENSPEC_TELEMETRY=0` in that copy
