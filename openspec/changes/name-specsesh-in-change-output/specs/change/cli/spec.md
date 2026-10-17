## MODIFIED Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change`, and `specsesh change`, which runs it, SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one `specsesh change` line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `specsesh change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`, `specsesh change approve <change> [--principal <name>] [--db <path>]`, `specsesh change build <change> [<answer>|--amend] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]` and `specsesh change close <change> [--db <path>]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate add-plan-export`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: draft with feedback answers what is waiting
When the change's latest draft loop ended `blocked`, `draft <change> <feedback>` SHALL answer it with the feedback as the principal's decision, wait for the new run and print it. Feedback that is `approve`, trimmed and in any case, SHALL exit `2` naming `specsesh change approve <change>`. Without feedback it SHALL print what is waiting again, start nothing, and exit as that loop did.

#### Scenario: Feedback redrafts the stage under review
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`
- **WHEN** `draft add-plan-export "JSON only"` runs
- **THEN** the proposal's next draft SHALL carry `The principal asked for: JSON only`

#### Scenario: Feedback answers a stage's question
- **GIVEN** `add-plan-export` waiting on the question `CSV too?`
- **WHEN** `draft add-plan-export "No"` runs
- **THEN** the stage SHALL draft again carrying `The principal asked for: No`

#### Scenario: draft alone shows what is waiting
- **GIVEN** `add-plan-export` waiting for review of `design.md`
- **WHEN** `draft add-plan-export` runs
- **THEN** the output SHALL name `design.md`, no loop SHALL start, and the exit code SHALL be `0`

#### Scenario: approve is not feedback
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`
- **WHEN** `draft add-plan-export " Approve "` runs
- **THEN** it SHALL exit `2` naming `specsesh change approve add-plan-export`, and `approvals.json` SHALL be unchanged

### Requirement: Draft output ends with the next command
The output SHALL start `# <change> — <state>`, then `## <stage>: approved` per approved stage, then the current stage's `### <stage> draft <n>` lines. A review SHALL end with its files, `specsesh change draft <change> "<what to change>"` and `specsesh change approve <change>`; a question with it and `specsesh change draft <change> "<answer>"`, exiting `1`; a drafted change with `specsesh change build <change>`.

#### Scenario: A review ends with both commands
- **WHEN** a draft of `add-plan-export` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `specsesh change draft add-plan-export "<what to change>"` and `specsesh change approve add-plan-export`

#### Scenario: A question exits 1
- **WHEN** a draft ends waiting on the question `CSV too?`
- **THEN** the output SHALL end with `CSV too?` and `specsesh change draft add-plan-export "<answer>"`, and the exit code SHALL be `1`

#### Scenario: A drafted change points at the next step
- **WHEN** a draft of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `specsesh change build add-plan-export`

### Requirement: approve approves the stage under review
`approve <change>` SHALL answer the change's draft loop waiting for review with `approve`, by `principal`, recording `--principal` (default `git config user.name`, then `$USER`), wait for the new run and print it as `draft` does. A change waiting on a question SHALL exit `2` naming `specsesh change draft <change> "<answer>"`; one with nothing under review SHALL exit `2`. The run that approves a proposal with `slices.md` SHALL list `specsesh change draft <id> --intent "<intent>"` per later slice.

#### Scenario: Approving the proposal drafts the design
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`, and `git config user.name` `jesse`
- **WHEN** `approve add-plan-export` runs
- **THEN** `approvals.json` SHALL record the proposal by `jesse`, and the output SHALL end waiting for review of the design

#### Scenario: A question cannot be approved
- **GIVEN** `add-plan-export` waiting on a question
- **WHEN** `approve add-plan-export` runs
- **THEN** it SHALL exit `2` naming `specsesh change draft add-plan-export "<answer>"`, and nothing SHALL start

#### Scenario: Nothing to approve is refused
- **GIVEN** `add-plan-export` with no draft loop waiting
- **WHEN** `approve add-plan-export` runs
- **THEN** it SHALL exit `2` saying nothing is under review

#### Scenario: Approving a sliced proposal lists draft commands
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** `approve add-plan-export` approves the proposal
- **THEN** the output SHALL list `specsesh change draft add-plan-export-schema --intent "…"` then `specsesh change draft add-plan-export-ci --intent "…"`

### Requirement: Build output ends with the next command
The output SHALL start `# <change> — <state>`, then `## group <n>: <status> (<k> tasks, <r> reworks)` per group entered, then `## change check: passed` or the failing command and its output, then `## unclaimed: <n>` and each scenario when any. A blocked build SHALL end with the question, `specsesh change build <change> --amend` when its escalation carries an amendment, and `specsesh change build <change> "<answer>"`; a built one with `specsesh change close <change>`. Built SHALL exit `0`, else `1`.

#### Scenario: A blocked build ends with the answer command
- **WHEN** a build of `add-plan-export` ends blocked asking `Which API?`, with no amendment
- **THEN** the output SHALL end with `Which API?` and `specsesh change build add-plan-export "<answer>"`

#### Scenario: A blocked build with an amendment ends with both commands
- **WHEN** a build of `add-plan-export` ends blocked on an escalation carrying an `Amendment`, asking `Amend the spec?`
- **THEN** the output SHALL end with `Amend the spec?`, then `specsesh change build add-plan-export --amend`, then `specsesh change build add-plan-export "<answer>"`
- **AND** the exit code SHALL be `1`

#### Scenario: A built change points at the next step
- **WHEN** a build of `add-plan-export` ends `converged`
- **THEN** the output SHALL contain `## change check: passed` and end with `specsesh change close add-plan-export`

### Requirement: build refuses stale approvals before starting or continuing
Before `build <change>` starts a change loop, or an answer or `--amend` answers a `blocked` one, it SHALL compare each approved file with its sha256 in `approvals.json` as `draft` does; recorded and compared hashes read each `- [x]` in `tasks.md` as `- [ ]`. A mismatch SHALL print the stale-approval refusal to stderr, exit `2`, start or answer nothing. It SHALL follow `--amend`'s argument refusals and precede the dirty-tree check. Showing a question or reporting built SHALL NOT check.

#### Scenario: A hand-edited delta refuses a new build
- **GIVEN** `add-plan-export` with its four stages approved, no change loop waiting, and `specs/plan/export/spec.md` edited after the specs approval
- **WHEN** `build add-plan-export` runs
- **THEN** stderr SHALL be `add-plan-export: approved files changed since they were approved; build refused`, `  specs: specs/plan/export/spec.md (changed)`, `review it with: specsesh change draft add-plan-export` and `then approve it again: specsesh change approve add-plan-export`, in that order
- **AND** the exit code SHALL be `2`, and no change loop SHALL exist

#### Scenario: An answer to a waiting build is refused and the loop stays blocked
- **GIVEN** `add-plan-export` blocked asking `Which API?`, and `design.md` edited after the design approval
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** stderr SHALL contain the stale-approval refusal with `  design: design.md (changed)`, and the exit code SHALL be `2`
- **AND** no loop SHALL be answered, and the latest change loop SHALL still be `blocked` asking `Which API?`

#### Scenario: Ticked tasks are not a change
- **GIVEN** `add-plan-export` with its four stages approved, blocked asking `Which API?` after the build ticked tasks `1.1` and `1.2` in `tasks.md` from `- [ ]` to `- [x]`, and no other edit to any approved file
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no stale-approval refusal SHALL be printed, and the loop SHALL be answered with decision `Use the v2 API`

#### Scenario: --allow-dirty does not get around the refusal
- **GIVEN** `add-plan-export` with an uncommitted hand edit to the approved `specs/plan/export/spec.md`
- **WHEN** `build add-plan-export --allow-dirty` runs
- **THEN** stderr SHALL contain the stale-approval refusal with `  specs: specs/plan/export/spec.md (changed)`, the exit code SHALL be `2`, and no loop SHALL start

#### Scenario: Showing the question does not check
- **GIVEN** `add-plan-export` blocked asking `Which API?`, and `specs/plan/export/spec.md` edited after the specs approval
- **WHEN** `build add-plan-export` runs with no answer
- **THEN** the output SHALL contain `Which API?` and not the stale-approval refusal, no loop SHALL start, and the exit code SHALL be `1`

#### Scenario: A built change does not check
- **GIVEN** `add-plan-export` whose latest change loop converged, and `design.md` edited after the design approval
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL say it is built and not contain the stale-approval refusal, and no loop SHALL start

#### Scenario: Redrafting and approving again lets the build continue
- **GIVEN** `add-plan-export` blocked asking `Which API?`, with `specs/plan/export/spec.md` edited, then `draft add-plan-export` and `approve add-plan-export` run until every stage is approved
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no stale-approval refusal SHALL be printed, and the loop SHALL be answered with decision `Use the v2 API`

### Requirement: The stale-approval refusal names each file and the next step
The refusal SHALL be `<change>: approved files changed since they were approved; build refused`, then one line `  <stage>: <path> (changed|missing)` per stale file, `<path>` relative to the change directory and `missing` when the recorded file no longer exists, grouped in the order proposal, design, specs, tasks and sorted by path within a stage, then `review it with: specsesh change draft <change>` and `then approve it again: specsesh change approve <change>`.

#### Scenario: Several stages and a deleted file are listed in order
- **GIVEN** `add-plan-export` blocked asking `Which API?`, with `design.md` and `specs/plan/export/spec.md` edited and `specs/plan/schema/spec.md` deleted after their approvals
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** stderr SHALL be, in order, `add-plan-export: approved files changed since they were approved; build refused`, `  design: design.md (changed)`, `  specs: specs/plan/export/spec.md (changed)`, `  specs: specs/plan/schema/spec.md (missing)`, `review it with: specsesh change draft add-plan-export` and `then approve it again: specsesh change approve add-plan-export`
- **AND** the exit code SHALL be `2`

## ADDED Requirements

### Requirement: Change hints name specsesh change
Every command line the change CLI prints for a person to run SHALL begin `specsesh change`: the resume hints of `draft` and `build` (`draft loop <n> — resume with: specsesh change draft <change> --db <path>`, `change loop <n> — resume with: specsesh change build <change> --db <path>`) and `close`'s refusals. No usage, refusal, hint or next-command line SHALL contain `agentscript-change` or `pnpm change`.

#### Scenario: The draft resume hint names specsesh change
- **WHEN** `draft add-plan-export --intent "Export a plan"` starts a draft loop
- **THEN** stderr SHALL contain a line matching `^draft loop \d+ — resume with: specsesh change draft add-plan-export --db `

#### Scenario: The build resume hint names specsesh change
- **WHEN** `build add-plan-export` starts a change loop
- **THEN** stderr SHALL contain a line matching `^change loop \d+ — resume with: specsesh change build add-plan-export --db `

#### Scenario: close names the build to run again
- **GIVEN** `add-plan-export` whose newest change loop ended exhausted
- **WHEN** `close add-plan-export` runs
- **THEN** it SHALL exit `2` and stderr SHALL contain `build it again with specsesh change build add-plan-export`

#### Scenario: The usage names no old command
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL contain neither `agentscript-change` nor `pnpm change`

### Requirement: The old bin and pnpm change run the same command
The `agentscript-change` bin SHALL keep working, with the same arguments, exit codes and output as `specsesh change`. The root `package.json` `change` script SHALL be `node packages/specsesh/bin/specsesh.js change`, so `pnpm change` in this repository runs `specsesh change`.

#### Scenario: The old bin prints the specsesh usage
- **GIVEN** a build of `packages/agent`
- **WHEN** `node packages/agent/dist/bin/agentscript-change.js` runs with no arguments
- **THEN** it SHALL exit `2` and stderr SHALL equal what `node packages/specsesh/bin/specsesh.js change` prints

#### Scenario: pnpm change runs specsesh change
- **WHEN** the root `package.json` is read
- **THEN** `scripts.change` SHALL be `node packages/specsesh/bin/specsesh.js change`
