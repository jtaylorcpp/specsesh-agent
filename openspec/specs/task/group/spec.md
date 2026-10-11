# task/group Specification

## Purpose
The group loop: drive one task group of an OpenSpec change (`2.1`, `2.2`, …) to green as one durable loop — each task's loop in order, then a group check over the whole workspace, with a group judge that can reopen a task — returning the ontology's `LoopOutcome<GroupOutcome>`.

## Requirements

### Requirement: The task entry exports the group loop
`@specsesh/agent/task` SHALL export `startGroupLoop(harness, options, context)`, returning `Promise<TaskId<LoopOutcome<GroupOutcome>>>`, `waitForGroupLoop(harness, id, context)`, `answerGroupEscalation(harness, id, answer, context)`, the `GroupLoop` extension, `groupLoopExtensions(options)` and the type `GroupLoopOptions`. `groupLoopExtensions` SHALL return `GroupLoop` plus the three extensions `taskLoopExtensions` returns for the same options.

#### Scenario: A host starts and awaits a group loop
- **GIVEN** a harness with the extensions `groupLoopExtensions` returns installed
- **WHEN** it calls `startGroupLoop` for group `1` of a change and then `waitForGroupLoop` with the returned id
- **THEN** it SHALL receive a `LoopOutcome<GroupOutcome>` whose result's `group` is `1`

### Requirement: Group options are the task options with a group, a judge script and a rework budget
`GroupLoopOptions` SHALL be the task-loop options with `group` (a positive integer) in place of `task`, plus `groupScript?: Source` (default: the bundled `group.agent`) and `budget.maxReworks` (a positive integer, default `2`) beside `budget.maxIterations`. Sources SHALL be read once, at start, into the durable input, as for the task loop.

#### Scenario: Defaults for a group
- **WHEN** `startGroupLoop` is given no `groupScript` and no `budget.maxReworks`
- **THEN** the loop SHALL judge with the bundled `group.agent` and allow `2` reworks

### Requirement: A group is found by its number in tasks.md
The group SHALL be the `## <n>. <title>` heading in `tasks.md` whose number is `group`, and its tasks the `- [ ] <n>.<m>` and `- [x] <n>.<m>` lines under it, up to the next `## ` heading. An unknown number MUST be refused listing the group numbers that exist; a group with no task lines, or options with no `checks`, MUST be refused naming why.

#### Scenario: An unknown group lists the groups
- **GIVEN** a `tasks.md` with groups `1` and `2`
- **WHEN** `startGroupLoop` is called with `group` `9`
- **THEN** it SHALL reject naming `9` and listing `1` and `2`, and no loop SHALL be created

#### Scenario: A group needs a check
- **WHEN** `startGroupLoop` is called with `checks` `[]`
- **THEN** it SHALL reject saying a group needs at least one check

### Requirement: The queue is the group's unticked tasks in file order
The loop SHALL queue the group's unticked tasks in file order. Each ticked task SHALL be entered at once as converged, without starting a loop: `{ task, outcome: { status: "converged", iterations: [], result: { task, ticked: true } }, runs: 0 }`.

#### Scenario: A ticked task is not run again
- **GIVEN** group `1` whose `1.1` is ticked and `1.2` is not
- **WHEN** the group loop runs
- **THEN** only `1.2`'s task loop SHALL start, and the outcome SHALL hold `1.1` with `runs` `0` and status `converged`

### Requirement: The group loop is one durable task with four phases
The group loop SHALL be the pi-durable task `agentscript.group-loop`, version `1`, whose checkpoint is `{ phase, queue, entries, reworks, carried?, child? }` with `phase` one of `next`, `task`, `check` and `judge`. Each phase MUST end by committing the next checkpoint or a terminal outcome.

#### Scenario: Two tasks and a passing check
- **GIVEN** group `1` with unticked `1.1` and `1.2`, both converging, and a passing check
- **WHEN** the loop runs
- **THEN** its phases SHALL be `next`, `task` (`1.1`), `next`, `task` (`1.2`), `next`, `check`, then the terminal outcome

### Requirement: The next phase takes the next task or moves to the check
The `next` phase SHALL move to `task` with the first queued task id, removing it from the queue, or to `check` when the queue is empty. It MUST make no model request and run no command.

#### Scenario: An empty queue goes to the check
- **GIVEN** a checkpoint at `next` with an empty queue
- **WHEN** the phase runs
- **THEN** the checkpoint SHALL become `{ phase: "check", … }`

### Requirement: A task phase runs one task loop as a child
The `task` phase SHALL start an `agentscript.task-loop` child for the task with the group's options and, on a rework, the carried feedback as its `carried`, record the child's id, and await it, idempotently by that id. A converged child SHALL replace the task's entry, `runs` one more than before, and return to `next`.

#### Scenario: A converged task is recorded
- **WHEN** task `1.1`'s loop converges on its first run
- **THEN** the entries SHALL hold `1.1` with that `outcome` and `runs` `1`, and the phase SHALL return to `next`

### Requirement: A task that does not converge ends the group
A child that ends `blocked` SHALL end the group `blocked`, with the child's escalation copied at `level` `"group"`. A child that ends `exhausted` or `failed` SHALL end the group `failed`, naming the task. The tasks still queued MUST NOT run, and the entries SHALL hold the child's outcome.

#### Scenario: A blocked task blocks the group
- **GIVEN** task `1.1`'s loop blocks with an escalation to `principal` asking `"Which API?"`
- **WHEN** the group loop records it
- **THEN** the group SHALL end `blocked` with an escalation at level `"group"`, to `principal`, asking `"Which API?"`, and `1.2` SHALL NOT have run

#### Scenario: An exhausted task fails the group
- **WHEN** task `1.1`'s loop ends `exhausted`
- **THEN** the group SHALL end `failed`, naming `1.1`

### Requirement: The group check runs every check over the workspace
The `check` phase SHALL run each configured check command in the workspace, in order, split into an argv with no shell. All exiting `0` SHALL end the group `converged`. Otherwise the phase SHALL move to `judge`, keeping each command, exit code and output as the check output.

#### Scenario: A passing check converges the group
- **GIVEN** every task converged and the check `pnpm test` exiting `0`
- **WHEN** the check phase runs
- **THEN** the group SHALL end `converged`

#### Scenario: A failing check goes to the judge
- **WHEN** `pnpm test` exits `1` in the check phase
- **THEN** the checkpoint SHALL become `{ phase: "judge", … }` holding `pnpm test`, exit code `1` and its output

### Requirement: The judge is seeded with the group and the failing check
The `judge` phase SHALL run the group script once, as an `agentscript.run` child, seeding `group_number` (number), `group_title` (string), `tasks` (string: each task's id, text and last status, one per line), `proposal` (string), `deltas` (string, as for the task loop), `check_output` (string) and `rework_count` (number).

#### Scenario: The judge sees the check output
- **WHEN** the judge runs after `pnpm test` exited `1`
- **THEN** its seeded `check_output` SHALL contain `pnpm test`, `1` and the command's output

### Requirement: The judge's verdict is read back from four variables
After the judge's run the loop SHALL read `next_action` (string: `rework`, `ask` or `amend-spec`), `rework_task` (string: the task id to reopen when `rework`), `feedback` (string: what the reopened task must fix) and `question` (string: the escalation's question when `ask` or `amend-spec`).

#### Scenario: A rework verdict names a task
- **WHEN** the judge sets `next_action` `"rework"`, `rework_task` `"1.1"` and `feedback` `"restore the import"`
- **THEN** the loop SHALL read a rework of `1.1` with that feedback

### Requirement: The judge contract is checked before anything runs
`startGroupLoop` SHALL check that the group script declares every seeded and read-back variable with its type. A missing or mistyped variable MUST refuse the start, naming it, before any loop or model request.

#### Scenario: A script without rework_task is refused
- **GIVEN** a group script that does not declare `rework_task`
- **WHEN** `startGroupLoop` is called with it
- **THEN** it SHALL reject naming `rework_task`, and no loop SHALL be created

### Requirement: Rework reruns one task with the failure carried in
A `rework` naming a task of the group, with `reworks` below `budget.maxReworks`, SHALL untick that task's line in a `tasks.md` given by path (that line only), queue the task, set `carried` to the check output followed by `feedback`, add `1` to `reworks` and return to `next`. After the reworked task's loop the group check SHALL run again.

#### Scenario: A failed check is fixed by reworking a task
- **GIVEN** a two-task group whose check fails once after both tasks converge
- **WHEN** the judge reworks `1.1`, its loop converges, and the check passes
- **THEN** the group SHALL end `converged` with `1.1` at `runs` `2`, `1.2` at `runs` `1`, `1.1` ticked again, and a `carried` holding the check output

### Requirement: Rework is bounded
A `rework` when `reworks` equals `budget.maxReworks` SHALL end the group `exhausted`, keeping the entries as they are.

#### Scenario: The rework budget runs out
- **GIVEN** `budget.maxReworks` `1` and a check that keeps failing
- **WHEN** the judge asks for a second rework
- **THEN** the group SHALL end `exhausted`

### Requirement: ask and amend-spec block the group
`ask` or `amend-spec` SHALL end the group `blocked` with an escalation at `level` `"group"`, `to` the options' `escalateTo`, and `question` the judge's `question` (or, when empty, the check output's first line). `amend-spec` SHALL record its iteration's finding as `spec-defect`.

#### Scenario: The judge asks the principal
- **WHEN** the judge sets `next_action` `"ask"` and `question` `"Drop scenario X?"`
- **THEN** the group SHALL end `blocked` with an escalation to `principal`, level `"group"`, asking `"Drop scenario X?"`

### Requirement: A judge answer outside the contract fails the group
Any other `next_action`, or a `rework_task` that is not a task of the group, SHALL end the group `failed`, saying the group script broke its contract.

#### Scenario: A task outside the group is refused
- **WHEN** the judge reworks `3.1` in group `1`
- **THEN** the group SHALL end `failed`, naming `3.1`

### Requirement: Each group check round is an ontology Iteration
Each check, with its judge when it fails, SHALL be one `Iteration`: `actions` `[]`, one `CheckEvidence` per check, a verdict on the target `{ check: "group <n>" }` met only when all checks pass, and when unmet one finding and its feedback: `rework` → `code-defect`/`rework-task`, `ask` → `needs-decision`/`ask`, `amend-spec` → `spec-defect`/`amend-spec`.

#### Scenario: A failed check round is recorded
- **WHEN** a check fails and the judge reworks `1.1`
- **THEN** the round SHALL be recorded as an iteration with an unmet verdict, a `code-defect` finding and `rework-task` feedback

### Requirement: The outcome is a LoopOutcome of GroupOutcome
The group loop's outcome SHALL be a `LoopOutcome<GroupOutcome>` whose result is `{ group, tasks }` with one entry per task that was ticked or ran, in file order, each its latest outcome and `runs`; tasks still queued when the group ends early have none. It MUST pass the ontology's `check` before it is stored.

#### Scenario: The outcome checks against the ontology
- **WHEN** a group loop ends
- **THEN** `check(LoopOutcome(GroupOutcome), outcome)` SHALL be true

### Requirement: A group loop survives its process dying
Each phase SHALL be checkpointed so a killed process resumes where it was: during `task`, the same child task loop continues and no second loop starts for that task; during `check`, the checks run again.

#### Scenario: Killed during a task
- **GIVEN** a group loop whose process is killed while task `1.2`'s loop runs
- **WHEN** the loop is resumed from the same database
- **THEN** it SHALL continue `1.2`'s existing child loop, and `1.2` SHALL end with `runs` `1`

### Requirement: An answered escalation resumes the group as a new run
`answerGroupEscalation` SHALL accept an `EscalationAnswer` only for a group loop that ended `blocked` and only when `by` equals the escalation's `to`. A block from a task SHALL rerun that task's loop with `carried` set to the decision; a block from the judge SHALL rerun the check, and then the judge with the decision appended to `check_output`.

#### Scenario: Answering a blocked task resumes the group
- **GIVEN** a group blocked by task `1.1`, escalated to `principal`
- **WHEN** the principal answers `"Use the v2 API"`
- **THEN** `1.1`'s loop SHALL run again with `carried` `"Use the v2 API"`, and the group SHALL continue with `1.2`

### Requirement: The bundled group.agent fits the contract and acts on nothing
The package SHALL bundle `group.agent` in `src/task/scripts/`: one reasoning subagent that sets the four read-back variables from a structured result, declares every seeded variable, has no actions, and lints with no diagnostic against the pinned dialect.

#### Scenario: The bundled judge script is clean
- **WHEN** the bundled `group.agent` is analysed and scanned
- **THEN** it SHALL have no diagnostic, no unsupported construct and no action, and pass the judge contract check
