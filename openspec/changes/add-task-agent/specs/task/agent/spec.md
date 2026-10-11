## Purpose

The task loop from the ontology, made runnable: given an OpenSpec change, a task id and an Agent Script definition, a durable pi-durable task runs the script once per iteration until the task converges, blocks with an escalation, exhausts its budget or fails, and returns a `LoopOutcome<TaskOutcome>`.

## ADDED Requirements

### Requirement: The task entry exports the task loop
`@specsesh/agent/task` SHALL export `startTaskLoop(harness, options, context)`, returning `Promise<TaskId<LoopOutcome<TaskOutcome>>>`, `waitForTaskLoop(harness, id, context)`, returning `Promise<LoopOutcome<TaskOutcome>>`, `answerEscalation(harness, id, answer, context)`, the `TaskLoop` extension, and the types `TaskLoopOptions` and `Source`.

#### Scenario: A host starts and awaits a task loop
- **GIVEN** a harness with the `TaskLoop` extension installed
- **WHEN** it calls `startTaskLoop` for task `2.4` of `baseline-agentscript-durable` and then `waitForTaskLoop` with the returned id
- **THEN** it SHALL receive a `LoopOutcome<TaskOutcome>`

### Requirement: Options name the change, the task, the script and the workspace
`TaskLoopOptions` SHALL be `{ change, task: TaskId, script?: Source, workspace: string, budget?: { maxIterations: number }, checks?: string[], allow?: string[], escalateTo?: "principal" | "agent", model?: ModelRef }`. `change` SHALL be `{ dir: string }` or `{ proposal: Source, design?: Source, deltas: Source[], tasks: Source }`. `Source` SHALL be `{ text: string }` or `{ path: string }`.

#### Scenario: A change given as texts
- **WHEN** `change` is `{ proposal: { text }, deltas: [{ text }], tasks: { text } }`
- **THEN** the loop SHALL start without reading any file for the change

#### Scenario: A change given by directory
- **WHEN** `change` is `{ dir: "openspec/changes/archive/2026-10-11-baseline-agentscript-durable" }`
- **THEN** the loop SHALL read that directory's artifacts as described in the change directory requirement

### Requirement: Defaults for optional options
When omitted, `budget.maxIterations` SHALL be `3`, `escalateTo` SHALL be `"principal"`, `checks` and `allow` SHALL be empty, `script` SHALL be the bundled `task.agent`, and `model` SHALL be the owning conversation's model.

#### Scenario: Budget defaults to three iterations
- **GIVEN** options with no `budget`
- **WHEN** every iteration's judge answers `next_action` `"retry"`
- **THEN** the loop SHALL end `"exhausted"` after exactly 3 iterations

### Requirement: A change directory resolves to its artifacts
For `change: { dir }`, the loop SHALL read `<dir>/proposal.md`, `<dir>/design.md` when it exists, every `<dir>/specs/**/spec.md` as a delta whose capability path is its directory relative to `<dir>/specs/`, and `<dir>/tasks.md`. A missing `proposal.md` or `tasks.md`, or no delta file, MUST refuse the start, naming the missing path.

#### Scenario: design.md is optional
- **GIVEN** a change directory with proposal.md, one delta and tasks.md, but no design.md
- **WHEN** the loop starts
- **THEN** the script's `design` variable SHALL be seeded with `""`

#### Scenario: A missing tasks.md refuses the start
- **WHEN** `<dir>/tasks.md` does not exist
- **THEN** `startTaskLoop` SHALL reject naming `<dir>/tasks.md`, and no task SHALL be created

### Requirement: Sources are read once, at start, into the durable input
Every `Source`, including `script` and every artifact of a `{ dir }` change, SHALL be read when the loop starts and stored as text in the durable task's input. A resumed loop MUST use the stored texts and read no file. A `{ path }` that cannot be read MUST refuse the start before any task is created, naming the path.

#### Scenario: An unreadable path is named
- **GIVEN** `script: { path: "missing.agent" }`
- **WHEN** `startTaskLoop` is called
- **THEN** it SHALL reject with a message naming `missing.agent`

#### Scenario: A resumed loop ignores edits to the files
- **GIVEN** a loop started from a directory, whose proposal.md is edited after the start
- **WHEN** the loop is resumed after a crash
- **THEN** every later iteration SHALL be seeded with the proposal text read at start

### Requirement: The task is found by id in today's tasks.md format
The loop SHALL find the task in `tasks.md` as a line matching `- [ ] <id> <text>` or `- [x] <id> <text>`, where `<id>` is the given `TaskId`. An id with no such line MUST refuse the start with a message listing every task id the file holds. `task_text` SHALL be `<text>`, without the checkbox and id.

#### Scenario: Task 2.4 is found
- **GIVEN** the tasks.md of `baseline-agentscript-durable`
- **WHEN** the loop starts for task `2.4`
- **THEN** `task_text` SHALL begin with `` `packages/agentscript-durable/__tests__/cli.test.ts` ``

#### Scenario: An unknown id lists the ids that exist
- **WHEN** the loop starts for task `9.9` of that change
- **THEN** it SHALL reject with a message containing `9.9` and the existing ids `1.1` through `3.2`

### Requirement: Deltas reach the script as one string with capability prefixes
The `deltas` variable SHALL be every delta's text, in the order given (directory order sorted by capability path for `{ dir }`), each preceded by a line `## <capability path>` and separated by one blank line.

#### Scenario: Two deltas are concatenated in order
- **GIVEN** deltas for `durable/cli` and `durable/host`
- **WHEN** the loop seeds the script
- **THEN** `deltas` SHALL contain `## durable/cli` before `## durable/host`, each followed by its delta text

### Requirement: The script declares the variables the loop seeds
A task script MUST declare, with these types: `task_id` string, `task_text` string, `proposal` string, `design` string, `deltas` string, `iteration` number, `carried` string. Before each iteration the loop SHALL seed them: the task id, the task text, proposal.md, design.md or `""`, the concatenated deltas, the iteration number from 1, and the carried feedback or `""`.

#### Scenario: The first iteration is seeded
- **WHEN** iteration 1 of task `2.4` starts
- **THEN** the run SHALL start with `task_id` `"2.4"`, `iteration` `1` and `carried` `""`

### Requirement: The script declares the variables the loop reads back
A task script MUST declare, with these types: `met` boolean, `unmet` string, `next_action` string, `question` string. After each iteration the loop SHALL read them from the run's final variables. `next_action` SHALL be read as one of `"retry"`, `"amend-spec"` or `"ask"`.

#### Scenario: A met verdict is read back
- **WHEN** an iteration's run ends with `met` `True`
- **THEN** the loop SHALL treat that iteration's verdict as met

### Requirement: The contract is checked before anything runs
When the loop starts, it SHALL check the script against both variable tables, together with the actions binding check of `add-agentscript-actions`. A missing variable or one of the wrong type MUST refuse the start with a message naming the variable and its expected type, before any task is created or any model is called.

#### Scenario: A script missing next_action is refused
- **GIVEN** a script declaring every contract variable except `next_action`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `next_action` and `string`, and no model request SHALL be made

#### Scenario: A mistyped variable is refused
- **GIVEN** a script declaring `iteration: mutable string = ""`
- **WHEN** the loop starts
- **THEN** it SHALL reject naming `iteration` and `number`

### Requirement: The bundled scripts are the default and the subscription variant
The package SHALL ship `task.agent` (orient, act with model-callable `read_file`, `edit_file`, `run_command`, check with deterministic `run_checks`, judge) as the default script, and `task-delegate.agent`, which acts through the deterministic `delegate_claude_code` action, for providers that cannot serve model-callable tools. Both MUST satisfy the contract and lint with zero diagnostics.

#### Scenario: The bundled scripts lint clean
- **WHEN** the shipped `task.agent` and `task-delegate.agent` are analysed
- **THEN** each SHALL have zero diagnostics and pass the contract check

### Requirement: The loop is one durable task with three phases
The package SHALL define a pi-durable task `agentscript.task-loop`, version `1`, whose checkpoint phases are `iterate`, `await` and `judge`. `iterate` SHALL start an `agentscript.run` child with the script, the seeded variables and `entry` set to the script's subagents in source order. `await` SHALL wait for that child, idempotently by child id. `judge` SHALL map the result as the judge rows require.

#### Scenario: A crash during await does not start a second run
- **GIVEN** a loop checkpointed at `await` for iteration 1
- **WHEN** the process dies and the loop resumes
- **THEN** it SHALL wait for the same child run and start no other

### Requirement: Judge maps a failed run and a met verdict
In `judge`, a child run that did not complete, or completed with `RunResult.kind` other than `"completed"`, SHALL end the loop `"failed"` with a `Finding` of kind `"environment"`. A completed run with `met` true SHALL end the loop `"converged"`, ticking the task as the ticking requirements allow.

#### Scenario: A failed step fails the loop
- **WHEN** iteration 1's run ends with `kind` `"failed"` (e.g. `rate_limit`)
- **THEN** the loop SHALL end `"failed"` with a finding of kind `"environment"`

#### Scenario: A met verdict converges
- **WHEN** iteration 2's run completes with `met` `True`
- **THEN** the loop SHALL end `"converged"` with two iterations

### Requirement: Judge maps retry to another iteration or exhaustion
When `met` is false and `next_action` is `"retry"`, the loop SHALL start another iteration with `carried` set to that run's `unmet` if fewer than `budget.maxIterations` iterations have run, and otherwise end `"exhausted"`.

#### Scenario: Retry carries the unmet summary
- **GIVEN** iteration 1 ends with `met` `False`, `unmet` `"the --json case is untested"`, `next_action` `"retry"`
- **WHEN** iteration 2 starts
- **THEN** its `carried` SHALL be `"the --json case is untested"` and `iteration` SHALL be `2`

#### Scenario: Retry with no budget left exhausts
- **GIVEN** `budget.maxIterations` `2`
- **WHEN** iteration 2 ends with `next_action` `"retry"`
- **THEN** the loop SHALL end `"exhausted"` with two iterations

### Requirement: Judge maps ask and amend-spec to a blocked loop
When `met` is false and `next_action` is `"ask"`, the loop SHALL end `"blocked"` with `Escalation { level: "task", to: escalateTo, reason: unmet, question }`. When it is `"amend-spec"`, it SHALL end the same way and additionally record a `Finding` of kind `"spec-defect"`.

#### Scenario: An amend-spec verdict blocks with a spec defect
- **WHEN** an iteration ends with `next_action` `"amend-spec"` and `question` `"The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?"`
- **THEN** the loop SHALL end `"blocked"`, its escalation's `question` SHALL be that text, `to` SHALL be `"principal"`, and a `"spec-defect"` finding SHALL be recorded

### Requirement: Judge fails a run that breaks the contract
When `met` is false and `next_action` is none of `"retry"`, `"amend-spec"` or `"ask"`, the loop SHALL end `"failed"` with a message saying the script broke the task-script contract and naming the value received.

#### Scenario: An unknown next_action fails the loop
- **WHEN** an iteration ends with `met` `False` and `next_action` `"done"`
- **THEN** the loop SHALL end `"failed"` with a message naming `"done"`

### Requirement: Each iteration is recorded as an ontology Iteration
For every iteration, the loop SHALL record an `Iteration` with `n`, `plan` set to the run's `plan` variable when the script declares one and `""` otherwise, `actions` and `evidence` set to the `Action`s and `Evidence` the run's host actions recorded, `verdict` from `met` and `unmet`, and `feedback` from `next_action`.

#### Scenario: Actions and evidence are kept per iteration
- **WHEN** iteration 1 edits one file and runs `pnpm test`
- **THEN** its `Iteration` SHALL hold an `edit` action with `DiffEvidence` and a `command` action with `CheckEvidence`

### Requirement: An answered escalation resumes the loop as a new run
`answerEscalation(harness, id, answer, context)` SHALL accept an `EscalationAnswer` only for a loop that ended `"blocked"` and only when `answer.by` equals the escalation's `to`; otherwise it MUST reject as invalid input. An accepted answer SHALL start a new run of the same loop with `carried` set to `answer.decision`, keeping the earlier iterations recorded.

#### Scenario: The wrong recipient is rejected
- **GIVEN** a blocked loop whose escalation has `to` `"principal"`
- **WHEN** `answerEscalation` is called with `by` `"agent"`
- **THEN** it SHALL reject, and the loop SHALL stay blocked

#### Scenario: A principal's answer resumes the loop
- **GIVEN** the same blocked loop after 2 iterations
- **WHEN** the principal answers with `decision` `"Amend the spec; keep the code"`
- **THEN** a new run SHALL start whose first iteration is seeded with `carried` `"Amend the spec; keep the code"`, and the 2 earlier iterations SHALL remain recorded

### Requirement: A converged task is ticked only in a tasks.md given by path
When the loop converges and `tasks.md` came from a path (directly or through `{ dir }`), the loop SHALL rewrite that file changing only the task's line from `- [ ] <id>` to `- [x] <id>`, and set `TaskOutcome.ticked` true. Every other byte of the file MUST stay unchanged.

#### Scenario: Only task 2.4's line changes
- **GIVEN** a converged loop for task `2.4`, started from a copy of the `baseline-agentscript-durable` change directory whose line for `2.4` is unticked
- **WHEN** the tasks.md is compared before and after
- **THEN** the only difference SHALL be `- [ ] 2.4` becoming `- [x] 2.4`

### Requirement: Ticking never writes in doubt and never unticks
The loop MUST NOT write `tasks.md` when it came from text, when the task's line is already ticked, or when the line can no longer be found by id. In each case `TaskOutcome.ticked` SHALL be false, with a note saying why. No loop outcome SHALL ever untick a task.

#### Scenario: Text input is never written
- **GIVEN** a loop whose `tasks` was `{ text }`
- **WHEN** it converges
- **THEN** no file SHALL be written and `ticked` SHALL be `false`

#### Scenario: A file changed meanwhile is not written
- **GIVEN** a converged loop whose tasks.md no longer contains a line for `2.4`
- **WHEN** the loop tries to tick
- **THEN** the file SHALL be unchanged and `ticked` SHALL be `false`, with a note naming `2.4`

### Requirement: The outcome is a LoopOutcome of TaskOutcome
`waitForTaskLoop` SHALL return `LoopOutcome<TaskOutcome>` with every iteration recorded. `result` SHALL be present, holding `{ task, ticked }`, exactly when `status` is `"converged"`, and `escalation` exactly when it is `"blocked"`.

#### Scenario: A blocked outcome carries an escalation and no result
- **WHEN** a loop ends `"blocked"`
- **THEN** its outcome SHALL have an `escalation` and no `result`
