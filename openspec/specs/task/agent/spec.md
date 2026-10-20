# task/agent Specification

## Purpose
The task loop from the ontology, made runnable: given an OpenSpec change, a task id and an Agent Script definition, a durable pi-durable task runs the script once per iteration until the task converges, blocks with an escalation, exhausts its budget or fails, and returns a `LoopOutcome<TaskOutcome>`.

## Requirements

### Requirement: The task entry exports the task loop
`@specsesh/agent/task` SHALL export `startTaskLoop(harness, options, context)`, returning `Promise<TaskId<LoopOutcome<TaskOutcome>>>`, `waitForTaskLoop(harness, id, context)`, returning `Promise<LoopOutcome<TaskOutcome>>`, `waitForTaskLoopResult`, `answerEscalation(harness, id, answer, context)`, the `TaskLoop` extension, `taskLoopExtensions`, and the types `TaskLoopOptions` and `Source`.

#### Scenario: A host starts and awaits a task loop
- **GIVEN** a harness with the extensions `taskLoopExtensions` returns installed
- **WHEN** it calls `startTaskLoop` for task `2.4` of `baseline-agentscript-durable` and then `waitForTaskLoop` with the returned id
- **THEN** it SHALL receive a `LoopOutcome<TaskOutcome>`

### Requirement: A harness binds the loop's actions to one workspace
`taskLoopExtensions({ workspace, checks, allow, delegates, runners, deleteFiles })` SHALL return `TaskLoop` and run and step extensions over `workspaceActions`, `delegationActions(delegates, { workspace, runners })` and, if `deleteFiles` is `true`, `deleteActions(workspace)`. `workspace` is a directory or a `Workspace`; `runners` defaults to `defaultRunners`. `startTaskLoop` SHALL check scripts against that registry and store `delegates`, `worktree` and `deleteFiles` in its input.

#### Scenario: The extensions run the loop's actions in its workspace
- **GIVEN** a harness with `taskLoopExtensions({ workspace, checks: ["pnpm test"], allow: ["pnpm"] })` installed
- **WHEN** a loop over that workspace edits a file
- **THEN** the file SHALL change inside `workspace`

#### Scenario: The delegate configuration is stored with the loop
- **GIVEN** options with `delegates` `{ claude_code: { runner: "claude-code", model: "opus" } }` and `worktree` `{ path: "/w", branch: "task/c/1.1" }`
- **WHEN** `startTaskLoop` creates the loop
- **THEN** the loop's stored input SHALL hold those two values

#### Scenario: A delegating script without a grant is refused at start
- **GIVEN** options running `task-delegate.agent` with no `delegates`
- **WHEN** `startTaskLoop` is called
- **THEN** it SHALL reject naming `delegate/claude_code` and `no delegates are granted`, and no loop SHALL be created

#### Scenario: The delete grant is stored and bound
- **GIVEN** a harness from `taskLoopExtensions({ workspace, deleteFiles: true })` and options with `deleteFiles` `true`
- **WHEN** `startTaskLoop` creates the loop and its script calls `delete_file` on `src/old.ts`
- **THEN** the loop's stored input SHALL hold `deleteFiles` `true`, and `src/old.ts` SHALL be removed from `workspace`

### Requirement: Options name the change, the task, the script and the workspace
`TaskLoopOptions` SHALL be `{ change, task: TaskId, script?: Source, workspace: string, budget?: { maxIterations: number }, checks?: string[], allow?: string[], escalateTo?: Recipient, model?: ModelRef, delegates?: DelegateGrants, worktree?: { path, branch } }`. `change` SHALL be `{ dir: string }` or `{ proposal: Source, design?: Source, deltas: Source[], tasks: Source }`. `Source` SHALL be `{ text: string }` or `{ path: string }`.

#### Scenario: A change given as texts
- **WHEN** `change` is `{ proposal: { text }, deltas: [{ text }], tasks: { text } }`
- **THEN** the loop SHALL start without reading any file for the change

#### Scenario: A change given by directory
- **WHEN** `change` is `{ dir: "openspec/changes/archive/2026-10-11-baseline-agentscript-durable" }`
- **THEN** the loop SHALL read that directory's artifacts as described in the change directory requirement

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
A task script MUST declare, with these types: `met` boolean, `unmet` string, `next_action` string, `question` string, `amend_path` string, `amend_text` string. After each iteration the loop SHALL read them from the run's final variables. `next_action` SHALL be read as one of `"retry"`, `"amend-spec"` or `"ask"`. Both bundled judge prompts SHALL contain `set amend_path to the delta that is wrong`, `the whole new text of that file, not a patch` and `leave both empty`.

#### Scenario: A met verdict is read back
- **WHEN** an iteration's run ends with `met` `True`
- **THEN** the loop SHALL treat that iteration's verdict as met

#### Scenario: A script missing amend_path is refused
- **GIVEN** a script declaring every contract variable except `amend_path`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `amend_path` and `string`, no loop SHALL be created, and no model request SHALL be made

#### Scenario: The judge prompt asks for the whole file
- **WHEN** the judge step of `task.agent` or `task-delegate.agent` is composed
- **THEN** its prompt SHALL contain `set amend_path to the delta that is wrong`, `the whole new text of that file, not a patch` and `leave both empty`

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
The package SHALL ship `task.agent` (orient, act with model-callable `read_file`, `edit_file`, `run_command`, check with deterministic `run_checks`, judge), delegate-free, as the default, and `task-delegate.agent`, acting through the deterministic `mcpTool://delegate/claude_code`, for providers without model-callable tools; it runs only with a `claude_code` grant. Both MUST satisfy the contract, lint clean, and judge iterate-first.

#### Scenario: The bundled scripts lint clean
- **WHEN** the shipped `task.agent` and `task-delegate.agent` are analysed
- **THEN** each SHALL have zero diagnostics and pass the contract check

#### Scenario: Only the delegate script delegates
- **WHEN** the shipped scripts' action targets are read
- **THEN** `task.agent` SHALL target no `mcpTool://delegate/` name, and `task-delegate.agent` SHALL target exactly `mcpTool://delegate/claude_code`

### Requirement: The loop is one durable task with four phases
The package SHALL define a pi-durable task `agentscript.task-loop`, version `1`, whose checkpoint phases are `iterate`, `await`, `judge` and `gate`. `iterate` SHALL start an `agentscript.run` child with the script, the seeded variables, the contract's choices and `entry` set to the script's subagents in source order. `await` SHALL wait for that child, idempotently by child id. `judge` and `gate` SHALL map the result as the judge and gate rows require.

#### Scenario: A crash during await does not start a second run
- **GIVEN** a loop checkpointed at `await` for iteration 1
- **WHEN** the process dies and the loop resumes
- **THEN** it SHALL wait for the same child run and start no other

#### Scenario: A crash during gate reruns the checks and starts no run
- **GIVEN** a loop checkpointed at `gate` for iteration 2
- **WHEN** the process dies and the loop resumes
- **THEN** it SHALL run the checks again and start no other child run for iteration 2

### Requirement: Judge maps a failed run and a met verdict
In `judge`, a child run that did not complete, or ended with `RunResult.kind` other than `"completed"` because a step failed, SHALL end the loop `"failed"` with a `Finding` of kind `"environment"`. A completed run with `met` true SHALL move to `gate` when `checks` is non-empty, and otherwise end the loop `"converged"`, ticking the task as the ticking requirements allow.

#### Scenario: A failed step fails the loop
- **WHEN** iteration 1's run ends with `kind` `"failed"` (e.g. `rate_limit`)
- **THEN** the loop SHALL end `"failed"` with a finding of kind `"environment"`

#### Scenario: A met verdict converges
- **GIVEN** a loop with no checks
- **WHEN** iteration 2's run completes with `met` `True`
- **THEN** the loop SHALL end `"converged"` with two iterations

#### Scenario: A met verdict with checks goes to the gate
- **GIVEN** a loop with checks `["pnpm test"]`
- **WHEN** iteration 1's run completes with `met` `True`
- **THEN** the loop SHALL checkpoint at `gate` before it ticks anything

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
When `met` is false and `next_action` is `"ask"`, the loop SHALL end `"blocked"` with `Escalation { level: "task", to: escalateTo, reason: unmet, question }` and no `amendment`. When it is `"amend-spec"`, it SHALL end the same way, record a `"spec-defect"` `Finding`, and set `amendment` to `{ delta: amend_path, text: amend_text }`, unless `amend_path` is `""` or `amend_text` is only whitespace; then it SHALL omit `amendment` and note `amendment dropped: <variable> is empty`.

#### Scenario: An amend-spec verdict blocks with a spec defect
- **WHEN** an iteration ends with `next_action` `"amend-spec"`, `question` `"The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?"`, `amend_path` `"specs/durable/host/spec.md"` and a non-empty `amend_text`
- **THEN** the loop SHALL end `"blocked"`, its escalation's `question` SHALL be that text, `to` SHALL be `"principal"`, and a `"spec-defect"` finding SHALL be recorded
- **AND** the escalation's `amendment` SHALL be `{ delta: "specs/durable/host/spec.md", text: <amend_text> }`

#### Scenario: An empty amend_text drops the amendment
- **WHEN** an iteration ends with `next_action` `"amend-spec"`, `amend_path` `"specs/durable/host/spec.md"` and `amend_text` `""`
- **THEN** the loop SHALL end `"blocked"` with a `"spec-defect"` finding and an escalation with no `amendment`
- **AND** the notes from `waitForTaskLoopResult` SHALL contain `amendment dropped: amend_text is empty`

### Requirement: Judge fails a run that breaks the contract
When `met` is false and `next_action` is none of `"retry"`, `"amend-spec"` or `"ask"`, the loop SHALL end `"failed"` with a note saying the script broke the task-script contract and naming the value received.

#### Scenario: An unknown next_action fails the loop
- **WHEN** an iteration ends with `met` `False` and `next_action` `"done"`
- **THEN** the loop SHALL end `"failed"` with a note naming `"done"`

### Requirement: Each iteration is recorded as an ontology Iteration
For every iteration, the loop SHALL record an `Iteration` with `n`, `plan` set to the run's `plan` variable when the script declares one and `""` otherwise, `actions` and `evidence` set to the `Action`s and `Evidence` the run's host actions recorded, `verdict` from `met` and `unmet`, and `feedback` from `next_action`.

#### Scenario: Actions and evidence are kept per iteration
- **WHEN** iteration 1 edits one file and runs `pnpm test`
- **THEN** its `Iteration` SHALL hold an `edit` action with `DiffEvidence` and a `command` action with `CheckEvidence`

### Requirement: An unmet iteration carries one finding
An iteration's verdict SHALL judge the one target `{ check: "task <id>" }`. When it is unmet, its `feedback` SHALL be one `Feedback` on that target: finding kind `code-defect` with action `retry` for retry, `needs-decision` with `ask` for ask, `spec-defect` with `amend-spec` for amend-spec, and `environment` with `retry` for a failed run or a broken contract. The finding's evidence SHALL be the run's evidence plus the judge's `ReviewEvidence`, or the failure's `CheckEvidence`.

#### Scenario: A retry verdict is a code defect
- **WHEN** an iteration of task `2.4` ends with `met` `False` and `next_action` `"retry"`
- **THEN** its feedback SHALL be one item with action `"retry"` whose finding has kind `"code-defect"` and target `{ check: "task 2.4" }`

### Requirement: An answered escalation resumes the loop as a new run
`answerEscalation` SHALL reject as invalid input an `EscalationAnswer` for a loop not `"blocked"`, one whose `by` differs from the escalation's `to`, or an `"amendment-applied"` one that `openspec/loops` refuses. An accepted answer SHALL start a new run of the loop, keeping earlier iterations, with `carried` `answer.decision`, or for `"amendment-applied"`: `The principal applied your amendment to <delta>. That delta now reads:`, a blank line, then the amendment's `text`.

#### Scenario: The wrong recipient is rejected
- **GIVEN** a blocked loop whose escalation has `to` `"principal"`
- **WHEN** `answerEscalation` is called with `by` `"agent"`
- **THEN** it SHALL reject, and the loop SHALL stay blocked

#### Scenario: A principal's answer resumes the loop
- **GIVEN** the same blocked loop after 2 iterations
- **WHEN** the principal answers with `decision` `"Amend the spec; keep the code"`
- **THEN** a new run SHALL start whose first iteration is seeded with `carried` `"Amend the spec; keep the code"`, and the 2 earlier iterations SHALL remain recorded

#### Scenario: An applied amendment is carried
- **GIVEN** a loop blocked after 2 iterations whose escalation has `amendment.delta` `"specs/durable/host/spec.md"`
- **WHEN** the principal answers with `decision` `"amendment-applied"`
- **THEN** a new run SHALL start whose first iteration's `carried` is `The principal applied your amendment to specs/durable/host/spec.md. That delta now reads:`, a blank line, then `amendment.text`
- **AND** the 2 earlier iterations SHALL remain recorded

### Requirement: A converged task is ticked only in a tasks.md given by path
When the loop converges and `tasks.md` came from a path (directly or through `{ dir }`), the loop SHALL rewrite that file changing only the task's line from `- [ ] <id>` to `- [x] <id>`, and set `TaskOutcome.ticked` true. Every other byte of the file MUST stay unchanged.

#### Scenario: Only task 2.4's line changes
- **GIVEN** a converged loop for task `2.4`, started from a copy of the `baseline-agentscript-durable` change directory whose line for `2.4` is unticked
- **WHEN** the tasks.md is compared before and after
- **THEN** the only difference SHALL be `- [ ] 2.4` becoming `- [x] 2.4`

### Requirement: Ticking never writes in doubt and never unticks
The loop MUST NOT write `tasks.md` when it came from text, when the task's line is already ticked, or when the line can no longer be found by id. In each case `TaskOutcome.ticked` SHALL be false, with a note in the loop's notes saying why. No task loop SHALL ever untick a task; only a group loop's rework does (see `task/group`).

#### Scenario: Text input is never written
- **GIVEN** a loop whose `tasks` was `{ text }`
- **WHEN** it converges
- **THEN** no file SHALL be written and `ticked` SHALL be `false`

#### Scenario: A file changed meanwhile is not written
- **GIVEN** a converged loop whose tasks.md no longer contains a line for `2.4`
- **WHEN** the loop tries to tick
- **THEN** the file SHALL be unchanged and `ticked` SHALL be `false`, with a note naming `2.4`

### Requirement: The outcome is a LoopOutcome of TaskOutcome
`waitForTaskLoop` SHALL return `LoopOutcome<TaskOutcome>` with every iteration recorded, checked against the ontology schema. `result` SHALL be present, holding `{ task, ticked }`, exactly when `status` is `"converged"`, and `escalation` exactly when it is `"blocked"`. `waitForTaskLoopResult` SHALL return `{ outcome, notes }`, `notes` being the loop's notes as strings.

#### Scenario: A blocked outcome carries an escalation and no result
- **WHEN** a loop ends `"blocked"`
- **THEN** its outcome SHALL have an `escalation` and no `result`

### Requirement: Optional options have defaults
When omitted, `budget.maxIterations` SHALL be `8`, `escalateTo` SHALL be `"principal"`, `checks` and `allow` SHALL be empty, `script` SHALL be the bundled `task.agent`, and `model` SHALL be the owning conversation's model.

#### Scenario: Budget defaults to eight iterations
- **GIVEN** options with no `budget`
- **WHEN** every iteration's judge answers `next_action` `"retry"`
- **THEN** the loop SHALL end `"exhausted"` after exactly 8 iterations

### Requirement: The gate converges a met verdict only when every check passes
In `gate`, the loop SHALL run every configured check in the workspace, argv split with no shell. All exit `0`: the loop converges and ticks. Otherwise the iteration is recorded unmet with reason `the judge said met, but the checks failed: <command> exited <code>` (comma-joined), a `"code-defect"` finding with one `CheckEvidence` per check, and `retry` feedback; then the loop iterates or exhausts by budget.

#### Scenario: Failing checks turn a met verdict into a retry
- **GIVEN** checks `["pnpm test"]` that exit `1`, and a budget of `8`
- **WHEN** iteration 1's judge answers `met` `True`
- **THEN** iteration 1 SHALL be recorded unmet with reason `the judge said met, but the checks failed: pnpm test exited 1`
- **AND** iteration 2 SHALL start, and the task SHALL NOT be ticked

#### Scenario: Passing checks converge
- **GIVEN** checks that all exit `0`
- **WHEN** an iteration's judge answers `met` `True`
- **THEN** the loop SHALL end `"converged"` and tick the task

#### Scenario: A gate failure on the last iteration exhausts
- **GIVEN** `budget.maxIterations` `2` and checks that exit `1`
- **WHEN** iteration 2's judge answers `met` `True`
- **THEN** the loop SHALL end `"exhausted"` with two iterations, both unmet

### Requirement: A gate failure carries the failing output
When the gate fails, the next iteration's `carried` SHALL be the gate's reason, a blank line, then for each failing check `$ <command> (exit <code>)` on its own line followed by the last 4000 characters of its output, checks separated by a blank line.

#### Scenario: The next iteration sees what failed
- **GIVEN** checks `["pnpm check", "pnpm test"]` where only `pnpm test` exits `1` with output ending `1 failed`
- **WHEN** the gate fails and iteration 2 starts
- **THEN** its `carried` SHALL contain `$ pnpm test (exit 1)` and `1 failed`, and SHALL NOT contain `$ pnpm check`

### Requirement: The loop constrains next_action to its contract values
Every child run the task loop starts SHALL carry `choices: { next_action: ["retry", "amend-spec", "ask"], amend_path }`, `amend_path` being `""` then `specs/<capability path>/spec.md` for each delta in the order of `deltas`, so the judge step's result schema lists them and a value outside them is refused. A script whose `next_action` or `amend_path` default is not among its values MUST be refused at start, naming the variable and the default, before any loop exists.

#### Scenario: The judge step's schema lists the three values
- **WHEN** the bundled `task.agent`'s judge step is dispatched
- **THEN** its `submit_result` parameters SHALL give `next_action` `enum: ["retry", "amend-spec", "ask"]`

#### Scenario: A default outside the values is refused
- **GIVEN** a task script declaring `next_action: mutable string = "proceed"`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `next_action` and `"proceed"`, and no loop SHALL be created

#### Scenario: The judge step's schema lists the change's deltas
- **GIVEN** a change with deltas for `durable/cli` and `durable/host`
- **WHEN** the bundled `task.agent`'s judge step is dispatched
- **THEN** its `submit_result` parameters SHALL give `amend_path` `enum: ["", "specs/durable/cli/spec.md", "specs/durable/host/spec.md"]`

### Requirement: A run ended by a failed action is retried within budget
When a child run ends `"failed"` because a host action failed (its last report is an action result with `ok` false, such as a delegate timeout), the iteration SHALL be recorded unmet with that action's message as reason, an `"environment"` finding and `retry` feedback; the loop iterates with `carried` that message, or exhausts by budget.

#### Scenario: A delegate timeout costs one iteration
- **GIVEN** a budget of `8`
- **WHEN** iteration 1's run ends failed because `delegate/claude_code` answered `ok` false with `Claude Code timed out after 900000ms`
- **THEN** iteration 2 SHALL start with `carried` containing `timed out after 900000ms`, and the loop SHALL NOT end `"failed"`

#### Scenario: A failed action on the last iteration exhausts
- **GIVEN** `budget.maxIterations` `1`
- **WHEN** iteration 1's run ends failed because an action failed
- **THEN** the loop SHALL end `"exhausted"`

#### Scenario: A failed step still fails the loop
- **WHEN** iteration 1's run ends failed because its judge step failed with category `rate_limit`
- **THEN** the loop SHALL end `"failed"`

### Requirement: The bundled task judges iterate first
The judge in `task.agent` and `task-delegate.agent` SHALL say: the task is done only when the checks pass; retry is the default until they do; `amend-spec` only when the deltas contradict themselves or the code; `ask` only for a decision no passing check could settle; and `next_action` is exactly one word, every explanation going in `unmet`.

#### Scenario: The judge prompt says retry is the default
- **WHEN** either bundled script's judge step is composed
- **THEN** its prompt SHALL contain `It is done only when the checks pass`, `Default to retry` and `Answer next_action with exactly one word`

### Requirement: The delegate script shows the judge what changed and changes approach
`task-delegate.agent` SHALL set `act_files` from the delegate's `files_changed`, and its judge prompt SHALL contain `Files the delegate changed in this iteration: ` followed by that number, `(-1 means unknown)`, and `Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.` Its orient step SHALL say that when the carried feedback names a check that already failed before, the last approach did not work and a different one is needed.

#### Scenario: The judge sees an idle delegate
- **GIVEN** a fake `claude` that writes no file
- **WHEN** an iteration of `task-delegate.agent` reaches its judge step
- **THEN** the judge's prompt SHALL contain `Files the delegate changed in this iteration: 0` and `0 alone does not mean the task is unfinished`, and SHALL NOT contain `0 means the delegate changed nothing`

#### Scenario: Orient asks for a different approach
- **WHEN** `task-delegate.agent`'s orient step is composed for iteration `2`
- **THEN** its prompt SHALL contain `the last approach did not work`

### Requirement: An ungranted delete_file is an optional target
The start-up binding check SHALL treat an unbound `delete_file`, and no other name, as optional: the script is not refused. Unbound, it SHALL be left out of a model step's offered tools, and a deterministic call SHALL answer `ok: false` with `delete_file is not granted: set "deleteFiles": true under "task" in agentscript.config.json`. The loop SHALL seed boolean `delete_granted`, true exactly when `delete_file` is bound, only into scripts declaring it.

#### Scenario: A model step is not offered an ungranted delete
- **GIVEN** a harness without `deleteFiles` and the bundled `task.agent`
- **WHEN** the loop starts and the act step is dispatched
- **THEN** the start SHALL NOT be refused, `delete_granted` SHALL be seeded `False`, and the offered tools SHALL be `read_file`, `edit_file` and `run_command` only

#### Scenario: A deterministic ungranted delete is retried with the message
- **GIVEN** a harness without `deleteFiles`, a budget of `8`, and a custom script that does not declare `delete_granted` and deterministically runs `delete_file` on `src/legacy.ts`
- **WHEN** iteration 1 reaches that call
- **THEN** the start SHALL NOT have been refused, the call SHALL answer `ok` false, and iteration 2 SHALL start with `carried` containing `delete_file is not granted: set "deleteFiles": true under "task" in agentscript.config.json`

### Requirement: task.agent can delete when granted
Both bundled scripts SHALL declare `delete_granted: mutable boolean = False`. `task.agent`'s act step SHALL name the tools `read_file`, `edit_file`, `run_command` and `delete_file`, and its orient prompt SHALL contain `If the task retires a file, delete it with delete_file; do not empty it.` exactly when `delete_granted` is true.

#### Scenario: Granted, orient asks for deletion
- **GIVEN** a harness with `deleteFiles` `true`
- **WHEN** `task.agent`'s orient step is composed and its act step dispatched
- **THEN** the orient prompt SHALL contain `If the task retires a file, delete it with delete_file; do not empty it.` and the act step SHALL be offered `delete_file`

#### Scenario: Not granted, orient says nothing of deletion
- **GIVEN** a harness without `deleteFiles`
- **WHEN** `task.agent`'s orient step is composed
- **THEN** its prompt SHALL NOT contain `delete_file`

### Requirement: task-delegate.agent's outer step deletes what the delegate retires
When `delete_granted` is true, `task-delegate.agent`'s orient prompt SHALL have the planner end its plan with `You cannot delete files.` and ask for one `RETIRE: <path>` line per retired file; a model step `retire` SHALL set `retire_path` to the first such path, or `""`; a non-empty `retire_path` SHALL be passed to a deterministic `delete_file`, recorded as an `edit` action. When false, neither happens. The judge prompt SHALL contain `Files deleted: ` then `retire_path`, or `none`.

#### Scenario: The delegate's retired file is deleted
- **GIVEN** `deleteFiles` `true` and a fake `claude` whose reply ends `RETIRE: packages/agent/src/old-workspace.ts`
- **WHEN** iteration 1 runs
- **THEN** that file SHALL be gone, the stream SHALL hold an `action` event with `kind` `"edit"`, `summary` `"delete_file packages/agent/src/old-workspace.ts"` and that path in `refs`, and the judge prompt SHALL contain `Files deleted: packages/agent/src/old-workspace.ts`

#### Scenario: One file is retired per iteration
- **GIVEN** `deleteFiles` `true` and a fake `claude` whose reply ends `RETIRE: src/a.ts` then `RETIRE: src/b.ts`
- **WHEN** iteration 1 runs
- **THEN** `src/a.ts` SHALL be gone and `src/b.ts` SHALL remain

#### Scenario: Not granted, the delegate is not asked to retire
- **GIVEN** a harness without `deleteFiles` and a `claude_code` grant
- **WHEN** an iteration of `task-delegate.agent` runs
- **THEN** the start SHALL NOT be refused, the orient prompt SHALL NOT contain `RETIRE:`, no `retire` step or `delete_file` call SHALL run, and the judge prompt SHALL contain `Files deleted: none`

### Requirement: The bundled task scripts show carried feedback whenever it is non-empty
The orient and judge prompts of `task.agent` and `task-delegate.agent` SHALL contain the `carried` text whenever it is non-empty, including on the first iteration of a run resumed by an answer. The judge SHALL label it `Feedback carried in (from an earlier iteration or the principal's answer): `, never as the principal's alone, and when it answers a question SHALL not choose `ask` for it again; checks still decide done. When `carried` is empty neither prompt SHALL contain it.

#### Scenario: task.agent shows an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task.agent` whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its orient step is composed for iteration `1`
- **THEN** the orient prompt SHALL contain `Use the v2 API`

#### Scenario: task-delegate.agent shows an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its orient step is composed for iteration `1`
- **THEN** the orient prompt SHALL contain `Use the v2 API` and `the last approach did not work`

#### Scenario: A fresh run's first iteration shows no carried line
- **GIVEN** a fresh run of the bundled `task.agent`, and one of `task-delegate.agent`, each seeded with `carried` `""`
- **WHEN** each orient and judge step is composed for iteration `1`
- **THEN** neither orient prompt SHALL contain `Carried in` or `This is iteration`, and neither judge prompt SHALL contain `Feedback carried in`

#### Scenario: task.agent's judge sees an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task.agent` whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its judge step is composed for iteration `1`
- **THEN** the judge prompt SHALL contain `Feedback carried in (from an earlier iteration or the principal's answer): Use the v2 API` and `do not choose ask for that question again`
- **AND** it SHALL NOT contain `The principal's answer or earlier feedback`

#### Scenario: task-delegate.agent's judge sees an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its judge step is composed for iteration `1`
- **THEN** the judge prompt SHALL contain `Feedback carried in (from an earlier iteration or the principal's answer): Use the v2 API` and `do not choose ask for that question again`
- **AND** it SHALL NOT contain `The principal's answer or earlier feedback`

### Requirement: The bundled task scripts' system block is role-neutral
The `system` instructions of `task.agent` and `task-delegate.agent` SHALL start with `You are one step of a task loop that implements one task of an OpenSpec change` and SHALL contain `Each step's prompt says its role.` and `A step without tools decides only from the text it is given.` They MUST NOT contain `real workspace`. They SHALL keep the contract rules: the spec deltas are the contract, never tick boxes, never edit the spec, and say so when the spec looks wrong.

#### Scenario: The system block names no workspace
- **WHEN** a model step of either bundled task script is composed
- **THEN** its `instructions` section SHALL start with `You are one step of a task loop that implements one task of an OpenSpec change` and contain `Each step's prompt says its role.` and `A step without tools decides only from the text it is given.`
- **AND** it SHALL NOT contain `real workspace` or `You implement one task`

#### Scenario: The system block keeps the contract rules
- **WHEN** the `system` instructions of either bundled task script are read
- **THEN** they SHALL contain `The spec deltas are the contract`, `never tick boxes`, `never edit the spec` and `If the spec itself looks wrong, say so`

### Requirement: Each bundled task step's prompt says its role
In `task.agent` and `task-delegate.agent`, the prompt of every step that makes a model request SHALL start with `You are the <step> step`. The prompts of the tool-less steps (orient and judge in both, and retire in `task-delegate.agent`) SHALL contain `You have no tools: decide only from the text below.` `task.agent`'s `act` prompt SHALL contain `you act in the real workspace` and SHALL NOT contain that sentence. Retire's role line SHALL sit inside its `delete_granted` branch.

#### Scenario: task.agent's tool-less steps say their role
- **WHEN** an iteration of the bundled `task.agent` composes its orient and judge steps
- **THEN** the orient prompt SHALL start with `You are the orient step` and the judge prompt with `You are the judge step`
- **AND** each SHALL contain `You have no tools: decide only from the text below.`

#### Scenario: task-delegate.agent's tool-less steps say their role
- **GIVEN** a harness with `deleteFiles` `true` and a `claude_code` grant on a fake `claude`
- **WHEN** an iteration of the bundled `task-delegate.agent` composes its orient, retire and judge steps
- **THEN** their prompts SHALL start with `You are the orient step`, `You are the retire step` and `You are the judge step`
- **AND** each SHALL contain `You have no tools: decide only from the text below.`

#### Scenario: task.agent's act step acts in the real workspace
- **WHEN** an iteration of the bundled `task.agent` dispatches its act step
- **THEN** the act prompt SHALL start with `You are the act step`, contain `you act in the real workspace` and `Carry out this plan`
- **AND** it SHALL NOT contain `You have no tools`

#### Scenario: Without the delete grant, retire makes no model request
- **GIVEN** a harness without `deleteFiles` and a `claude_code` grant on a fake `claude`
- **WHEN** an iteration of the bundled `task-delegate.agent` runs
- **THEN** no model request's prompt SHALL start with `You are the retire step`

### Requirement: The bundled judges see the plan as another step's instructions
`task-delegate.agent`'s judge prompt SHALL show `plan` after `The instructions the delegate was given (for the delegate, not for you): `, and `task.agent`'s after `The plan the act step followed (for the act step, not for you): `. Neither judge prompt SHALL have a line starting `Plan:`.

#### Scenario: task-delegate.agent's judge sees the delegate's instructions
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose orient step answers the plan `Edit src/a.ts`
- **WHEN** its judge step is composed
- **THEN** the judge prompt SHALL contain `The instructions the delegate was given (for the delegate, not for you): Edit src/a.ts`
- **AND** no line of it SHALL start with `Plan:`

#### Scenario: task.agent's judge sees the act step's plan
- **GIVEN** a run of the bundled `task.agent` whose orient step answers the plan `Edit src/a.ts`
- **WHEN** its judge step is composed
- **THEN** the judge prompt SHALL contain `The plan the act step followed (for the act step, not for you): Edit src/a.ts`
- **AND** no line of it SHALL start with `Plan:`

### Requirement: The bundled judges say what next_action is when the task is met
The loop ignores `next_action` on a met verdict, and no value means done. Each bundled judge prompt (`task.agent`, `task-delegate.agent`) SHALL contain the line `When the task is met, next_action is ignored: answer retry.` directly before the line `Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.`

#### Scenario: The judges say next_action is ignored when the task is met
- **GIVEN** a run of the bundled `task.agent`, and a run of the bundled `task-delegate.agent` with a `claude_code` grant
- **WHEN** each judge step is composed
- **THEN** each judge prompt SHALL contain the line `When the task is met, next_action is ignored: answer retry.`
- **AND** the next line SHALL be `Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.`

### Requirement: The loop hands every delegate the task preamble
Each iteration's `agentscript.run` child SHALL carry `delegatePreamble` set to the task preamble rendered from the loop's durable input, so every delegate the iteration calls with `run` receives it before its instructions. A group loop's task runs SHALL carry it the same way; the group judge's run and the spec loop's runs SHALL carry none. No script variable is added.

#### Scenario: The bundled delegate script's delegate sees the contract
- **GIVEN** a task loop for task `2.1` of a change directory, running `task-delegate.agent` with `claude_code` granted to a fake `claude` that records its stdin
- **WHEN** iteration 1 calls the delegate
- **THEN** stdin SHALL start with the task preamble, then a blank line, then the iteration's `plan`

#### Scenario: A group's task run carries the preamble
- **GIVEN** a group loop over group `2` of a change directory
- **WHEN** it runs task `2.1` as a child task loop
- **THEN** that task loop's iteration run SHALL carry the task preamble for task `2.1`

#### Scenario: The group judge's run carries no preamble
- **GIVEN** a group loop whose group check fails
- **WHEN** it runs its judge
- **THEN** the judge's `agentscript.run` input SHALL have no `delegatePreamble`

#### Scenario: A resumed loop's preamble uses the texts read at start
- **GIVEN** a loop started from a directory, whose proposal.md is edited after the start
- **WHEN** the loop is resumed after a crash and runs its next iteration
- **THEN** that iteration's `delegatePreamble` SHALL hold the proposal text read at start

### Requirement: The task preamble is fixed text over the loop's sources
`taskPreamble(input)` SHALL return the opening line, `Change: <change>` (only when `change` is set), `Task <task>: <taskText>`, the three rules, then `# proposal.md`, `# design.md` (only when design is not `""`) and `# Spec deltas`, each followed by a blank line and its text with trailing newlines trimmed, and end with `# Instructions`. Blocks are separated by one blank line.

#### Scenario: The preamble for a change directory
- **GIVEN** a loop input with `change` `"add-x"`, `task` `"2.1"`, `taskText` `"Do X"`, `proposal` `"P\n"`, `design` `"D"` and `deltas` `"## a/b\nR\n"`
- **WHEN** `taskPreamble` renders it
- **THEN** it SHALL equal exactly:

```text
You are working on one task of an OpenSpec change. The documents below are its contract; the instructions after them are this iteration's plan.

Change: add-x
Task 2.1: Do X

Rules:
- Change only what the task needs.
- Never tick boxes in tasks.md, and never edit the change's proposal, design or spec deltas.
- If the spec itself looks wrong, say so in your reply instead of coding around it.

# proposal.md

P

# design.md

D

# Spec deltas

## a/b
R

# Instructions
```

#### Scenario: An empty design is left out
- **GIVEN** the same input with `design` `""`
- **WHEN** `taskPreamble` renders it
- **THEN** it SHALL contain no `# design.md` line, and `P` SHALL be followed by a blank line and `# Spec deltas`

#### Scenario: A change given as texts has no Change line
- **GIVEN** a loop started with `change` `{ proposal: { text }, deltas: [{ text }], tasks: { text } }`
- **WHEN** its preamble is rendered
- **THEN** it SHALL contain no line starting `Change:`, and its second block SHALL start with `Task `

### Requirement: The loop input names the change it came from
`TaskLoopInput` SHALL carry an optional `change`: the base name of `change.dir` for a `{ dir }` change, and absent for a change given as texts. A group loop SHALL pass its change's base name to each task loop it runs. A loop whose stored input has no `change` SHALL still run.

#### Scenario: A directory change is named
- **WHEN** a task loop starts with `change` `{ dir: "openspec/changes/add-x" }`
- **THEN** its durable input SHALL have `change` `"add-x"`

### Requirement: A script that declares changed is seeded what changed since the loop started
A task script MAY declare `changed`. Before each iteration the loop SHALL seed it, only into a script that declares it, with the paths changed in the loop's workspace since the loop started, sorted, one per line, or `""`. A script declaring `changed` with a type other than string MUST be refused at start, naming `changed` and `string`. A script that does not declare it SHALL keep the contract.

#### Scenario: A script without changed keeps the contract
- **GIVEN** a script declaring every contract variable and not `changed`
- **WHEN** `startTaskLoop` is called with it
- **THEN** the start SHALL NOT be refused, and no iteration's run SHALL be seeded with `changed`

#### Scenario: A mistyped changed is refused
- **GIVEN** a script declaring every contract variable and `changed: mutable number = 0`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `changed` and `string`, no loop SHALL be created, and no model request SHALL be made

#### Scenario: The second iteration sees the first iteration's files
- **GIVEN** a clean git workspace and a script declaring `changed` whose iteration 1 writes `src/b.ts` and `src/a.ts` and ends unmet
- **WHEN** iteration 2 starts
- **THEN** its run SHALL be seeded with `changed` `"src/a.ts\nsrc/b.ts"`, and iteration 1's run SHALL have been seeded with `changed` `""`

#### Scenario: Edits made before the loop started are not listed
- **GIVEN** a git workspace with an uncommitted edit to `src/old.ts`, and a script declaring `changed` whose iteration 1 writes `src/a.ts` and leaves `src/old.ts` alone
- **WHEN** iteration 2 starts
- **THEN** its run SHALL be seeded with `changed` `"src/a.ts"`

### Requirement: changed is measured from a baseline the loop keeps
The loop SHALL snapshot the workspace its gate uses once, at its first iteration, and keep that baseline durably. A resumed loop, and a run started by `answerEscalation`, SHALL measure `changed` from the original baseline. `changed` SHALL leave out the change's `tasks.md` and every path in the option `excludeChanged`. A workspace that cannot snapshot SHALL be seeded `(unknown)`.

#### Scenario: A resumed loop measures from the loop's start
- **GIVEN** a loop whose iteration 1 wrote `src/a.ts` and ended unmet, and whose process died before iteration 2 started
- **WHEN** the loop resumes in a new process and iteration 2 starts
- **THEN** its run SHALL be seeded with `changed` `"src/a.ts"`

#### Scenario: An answered run measures from the blocked loop's start
- **GIVEN** a loop blocked after iteration 1, which wrote `src/a.ts`
- **WHEN** the principal answers and the new run's first iteration starts
- **THEN** that run SHALL be seeded with `changed` `"src/a.ts"`

#### Scenario: The tick and excluded paths are not listed
- **GIVEN** a loop started with `excludeChanged` `["runs.sqlite", "runs.sqlite-wal"]` over a git workspace holding the change's `tasks.md`, whose iteration 1 writes `src/a.ts`, `tasks.md`, `runs.sqlite` and `runs.sqlite-wal`
- **WHEN** iteration 2 starts
- **THEN** its run SHALL be seeded with `changed` `"src/a.ts"`

#### Scenario: A workspace without snapshots seeds unknown
- **GIVEN** a harness bound to a `memoryWorkspace` and a script declaring `changed`
- **WHEN** iteration 1 starts
- **THEN** its run SHALL be seeded with `changed` `"(unknown)"`

### Requirement: Each task loop of a group measures changed from its own start
Every task loop a group starts SHALL take its own baseline at its first iteration and SHALL be given the group's `excludeChanged`. This covers a task's first run, a rework, and the rerun of a blocked task after the group is answered. Its `changed` SHALL list only what changed since that task loop started.

#### Scenario: A later task does not see an earlier task's files
- **GIVEN** a two-task group whose script declares `changed`, where task `1.1` writes `src/a.ts` and converges
- **WHEN** task `1.2`'s first iteration starts
- **THEN** its run SHALL be seeded with `changed` `""`

#### Scenario: A reworked task measures from its rerun
- **GIVEN** a group whose judge reworks task `1.1` after its first loop wrote `src/a.ts`
- **WHEN** the rework's first iteration starts
- **THEN** its run SHALL be seeded with `changed` `""`

### Requirement: The bundled task judges see the changes since the loop started
`task.agent` and `task-delegate.agent` SHALL declare `changed: mutable string = ""`. Each judge prompt SHALL contain `Files changed since the loop started (iteration <n>):` followed by `changed`, or `none` when it is `""`, and `counting the work of every iteration since the loop started`. Each orient prompt SHALL contain `Files changed since the loop started:` and `changed` when `iteration` is above 1 and `changed` is not `""`, and SHALL NOT otherwise.

#### Scenario: The judge counts work done in an earlier iteration
- **GIVEN** a run of `task-delegate.agent` seeded with `iteration` `2` and `changed` `"src/a.ts"`, and a fake `claude` that writes no file
- **WHEN** its judge step is composed
- **THEN** the prompt SHALL contain `Files changed since the loop started (iteration 2):`, `src/a.ts` and `Files the delegate changed in this iteration: 0`

#### Scenario: task.agent's judge shows none on a fresh loop
- **GIVEN** a run of `task.agent` seeded with `iteration` `1` and `changed` `""`
- **WHEN** its judge step is composed
- **THEN** the prompt SHALL contain `Files changed since the loop started (iteration 1):` followed by `none`

#### Scenario: The judge asks about the work since the loop started
- **WHEN** either bundled script's judge step is composed
- **THEN** its prompt SHALL contain `counting the work of every iteration since the loop started` and `It is done only when the checks pass`

#### Scenario: Orient shows earlier work from iteration 2
- **GIVEN** either bundled script
- **WHEN** its orient step is composed for `iteration` `2` with `changed` `"src/a.ts"`, and for `iteration` `1` with `changed` `""`
- **THEN** the first prompt SHALL contain `Files changed since the loop started:` and `src/a.ts`, and the second SHALL NOT contain `Files changed since the loop started`

### Requirement: A script can make passing checks sufficient
A host MAY make passing checks enough for a met verdict with a logic-only subagent after the judge that runs `set @variables.met = True` under `if @variables.checks_passed:`. The loop SHALL treat that `met` like any other, gate included. The bundled scripts SHALL NOT do this: their judge decides.

#### Scenario: Passing checks converge a loop whose judge said unmet
- **GIVEN** a copy of `task.agent` with a trailing subagent `accept` holding only `if @variables.checks_passed:` / `set @variables.met = True`, a judge that answers `met` `False`, and checks that pass
- **WHEN** iteration 1 runs
- **THEN** the loop SHALL end `converged` after the gate, with the task ticked
