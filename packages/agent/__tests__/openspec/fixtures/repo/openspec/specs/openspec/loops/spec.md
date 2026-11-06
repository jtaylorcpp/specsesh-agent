# openspec/loops Specification

## Purpose
Executing a change as three nested feedback loops sharing one shape: a task loop per task, a group loop per task group, and a change loop over the whole task list, with typed iterations, verdicts, feedback and outcomes.

## Requirements

### Requirement: A loop has one shape at every level
The model SHALL define `Loop<Goal, Out>` with input `LoopInput<Goal>`, a sequence of `Iteration`s and output `LoopOutcome<Out>`. The task, group and change loops MUST be instances of this one shape, differing only in `Goal`, targets and `Out`.

#### Scenario: Three levels, one shape
- **WHEN** the task, group and change loops are described
- **THEN** each SHALL use `LoopInput`, `Iteration`, `Verdict`, `Feedback` and `LoopOutcome` unchanged

### Requirement: A loop input carries the goal, context, budget and carried feedback
The model SHALL define `LoopInput<Goal>` as `{ goal: Goal, context: ContextRef[], budget: Budget, carried: Feedback[] }` and `Budget` as `{ maxIterations: integer, maxWallMs?: integer }` with `maxIterations` at least `1`. `carried` holds feedback handed down from the enclosing loop.

#### Scenario: A zero budget is refused
- **WHEN** a `LoopInput` with `budget.maxIterations` `0` is checked
- **THEN** the check SHALL fail

### Requirement: An iteration plans, acts, gathers evidence and judges
The model SHALL define `Iteration` as `{ n: integer, plan: string, actions: Action[], evidence: Evidence[], verdict: Verdict, feedback: Feedback[] }`, with `n` starting at `1` and increasing by one. `verdict` SHALL be judged from `evidence` only.

#### Scenario: Iterations are numbered from 1
- **WHEN** a loop has run three iterations
- **THEN** their `n` values SHALL be `1`, `2` and `3`

### Requirement: An action records what an iteration did
The model SHALL define `Action` as `{ kind: "edit" | "command" | "delegate", summary: string, refs: string[] }`. For `"edit"`, `refs` SHALL be the files edited; for `"command"`, the command line run; for `"delegate"`, the agent delegated to. Diffs and results SHALL NOT be stored on an action; they are evidence (see `openspec/evidence`).

#### Scenario: Running the tests is a command action
- **WHEN** an iteration runs `pnpm --filter agentscript-durable test`
- **THEN** its actions SHALL include `{ kind: "command", summary, refs: ["pnpm --filter agentscript-durable test"] }`, and the result SHALL be recorded as evidence, not on the action

#### Scenario: An unknown action kind is refused
- **WHEN** an `Action` with `kind` `"think"` is checked
- **THEN** the check SHALL fail

### Requirement: A context reference names what a loop reads
The model SHALL define `ContextRef` as `{ kind: "file" | "capability" | "requirement" | "scenario" | "change" | "doc", ref: string }`. For `"capability"`, `"requirement"` and `"scenario"`, `ref` SHALL be the serialised `CapabilityPath`, `RequirementRef` or `ScenarioRef` (see `openspec/model`); for `"file"` and `"doc"`, a repository-relative path; for `"change"`, a change id.

#### Scenario: A context reference to a spec item can be checked
- **GIVEN** a `ContextRef` of `kind` `"scenario"` whose `ref` names a scenario no capability has
- **WHEN** the loop input is checked against the specs
- **THEN** the dangling reference SHALL be detectable, because `ref` parses to a `ScenarioRef` that can be looked up

### Requirement: A verdict lists satisfied and unmet targets
The model SHALL define `Verdict` as `{ met: boolean, satisfied: Target[], unmet: { target: Target, reason: string }[] }`, where `Target` is a `RequirementRef`, a `ScenarioRef` or a named check `{ check: string }`, such as `{ check: "strict validation" }`. `met` SHALL be `true` exactly when `unmet` is empty.

#### Scenario: One unmet target means not met
- **WHEN** a verdict has two satisfied targets and one unmet
- **THEN** `met` SHALL be `false`

### Requirement: Feedback names a finding and an action
The model SHALL define `Feedback` as `{ from: Finding, action: "retry" | "rework-task" | "add-task" | "amend-spec" | "ask" }`. Each unmet target of a verdict SHALL produce at least one feedback item.

#### Scenario: An unmet target produces feedback
- **GIVEN** a verdict with one unmet scenario target
- **WHEN** the iteration ends
- **THEN** its `feedback` SHALL hold at least one item whose `from.target` is that scenario

### Requirement: A loop outcome has one of four statuses
The model SHALL define `LoopOutcome<Out>` as `{ status: "converged" | "blocked" | "exhausted" | "failed", iterations: Iteration[], result?: Out, escalation?: Escalation }`. `result` SHALL be present when `status` is `"converged"`; `escalation` exactly when it is `"blocked"`.

#### Scenario: A converged loop carries its result
- **WHEN** a loop ends `"converged"`
- **THEN** `result` SHALL be present and `escalation` absent

### Requirement: Each status has one cause
A loop SHALL end `"converged"` when an iteration's verdict is met; `"blocked"` when feedback has action `"ask"` or `"amend-spec"`; `"exhausted"` when `budget.maxIterations` iterations ran with targets unmet; `"failed"` on an error it cannot act on.

#### Scenario: The budget runs out
- **GIVEN** `budget.maxIterations` `3`
- **WHEN** the third iteration's verdict is not met and no feedback asks or amends
- **THEN** the loop SHALL end `"exhausted"` with three iterations

### Requirement: An escalation names who must decide and what
The model SHALL define `Escalation` as `{ level: "task" | "group" | "change", to: "principal" | "agent", reason: string, question: string, amendment?: Amendment }` and `Amendment` as `{ delta: string, text: string }`, where `delta` is `specs/<capability>/spec.md` relative to the change and `text` is that file's full new text. Only an escalation raised by `"amend-spec"` feedback MAY carry `amendment`. A `"blocked"` outcome's escalation MUST carry a question its recipient can answer.

#### Scenario: A task loop escalates
- **WHEN** a task loop ends `"blocked"` on an `"ask"` feedback
- **THEN** its `escalation.level` SHALL be `"task"`
- **AND** the escalation SHALL have no `amendment`

#### Scenario: An escalation can go to an agent
- **GIVEN** a `"test-defect"` finding a reviewing agent can settle
- **WHEN** the loop escalates it
- **THEN** `escalation.to` MAY be `"agent"`, and the loop SHALL still end `"blocked"` until it is answered

### Requirement: An answered escalation resumes the loop
The model SHALL define `EscalationAnswer` as `{ escalation: Escalation, by: "principal" | "agent", decision: string, feedback: Feedback[] }`. `by` MUST equal `escalation.to`. The reserved decision `"amendment-applied"` says the principal applied `escalation.amendment`; it SHALL be rejected as invalid input unless that is present and `by` is `"principal"`. A blocked loop SHALL resume only as a new run of the same loop whose `LoopInput.carried` includes the answer's `feedback`.

#### Scenario: A blocked task loop resumes with the answer
- **GIVEN** a task loop that ended `"blocked"` with `escalation.to` `"principal"`
- **WHEN** the principal answers with a decision and `"retry"` feedback
- **THEN** the task loop SHALL run again with that feedback in `carried`, and its earlier iterations SHALL stay recorded

#### Scenario: Only the named recipient answers
- **GIVEN** an escalation with `to` `"principal"`
- **WHEN** an `EscalationAnswer` arrives with `by` `"agent"`
- **THEN** it SHALL be rejected as invalid input

#### Scenario: amendment-applied needs an amendment
- **GIVEN** a blocked escalation with `to` `"principal"` and no `amendment`
- **WHEN** the principal answers with `decision` `"amendment-applied"`
- **THEN** the answer SHALL be rejected as invalid input, and the loop SHALL stay blocked

### Requirement: The task loop drives one task to its targets
The task loop SHALL take as goal one `Task` with its `TaskLink`s; its targets SHALL be the linked scenarios and requirements; it iterates attempts at that task. Its `Out` SHALL be `TaskOutcome` = `{ task: TaskId, ticked: boolean }`.

#### Scenario: A task's targets are its links
- **GIVEN** task `2.4` linking three CLI scenarios
- **WHEN** its loop runs
- **THEN** its verdicts SHALL judge exactly those three targets

### Requirement: The group loop drives one feature set
The group loop SHALL take as goal one `TaskGroup`; its targets SHALL be every target its tasks link to, plus no regression in targets earlier groups converged. It SHALL run its task loops in order, then a group check. Its `Out` SHALL be `GroupOutcome` (see the group outcome requirement).

#### Scenario: A regression fails the group check
- **GIVEN** group `1` converged with scenario S passing
- **WHEN** group `2`'s check finds S failing
- **THEN** group `2`'s verdict SHALL list S as unmet

### Requirement: The change loop makes the spec real
The change loop SHALL take as goal the change's `TaskList`; its targets SHALL be every scenario in every delta (unclaimed included), a `ValidationReport` with `valid` `true`, and the full suite passing. It runs its group loops in order, then a change check.

#### Scenario: An unclaimed scenario is still a target
- **GIVEN** a delta scenario no task claims
- **WHEN** the change check runs
- **THEN** that scenario SHALL be among the change loop's targets

### Requirement: A group outcome has one entry per task that was ticked or ran
The model SHALL define `GroupOutcome` as `{ group: integer, tasks: { task: TaskId, outcome: LoopOutcome<TaskOutcome>, runs: integer }[] }`, with one entry per task that was ticked before the loop or whose loop ran, in group order; a task still queued when the group ends early has no entry. `outcome` SHALL be the task's latest run, whatever its status; `runs` counts its loop's runs in this group loop, `0` if ticked before it began.

#### Scenario: A reworked task appears once
- **GIVEN** task `2.4` whose loop converged, was reopened by `"rework-task"`, and converged again
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold one entry for `2.4`, with `runs` `2` and the second run's `outcome`

#### Scenario: A task that never converged is still listed
- **WHEN** a task's loop ends `"exhausted"`
- **THEN** the group outcome SHALL hold its entry, with `outcome.status` `"exhausted"`

#### Scenario: A task still queued when the group ends has no entry
- **GIVEN** group `2` whose task `2.2` blocks while `2.3` is still queued
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold `2.1` and `2.2` and no entry for `2.3`, and `2.3` SHALL still be unticked in `tasks.md`

#### Scenario: A task ticked before the group loop has no runs
- **GIVEN** task `2.1` ticked before group `2`'s loop starts
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold `2.1` with `runs` `0` and `outcome.status` `"converged"`

### Requirement: The change loop reports its groups and what was unclaimed
The change loop's `Out` SHALL be `ChangeOutcome` = `{ groups: { group: integer, outcome: LoopOutcome<GroupOutcome>, runs: integer }[], unclaimed: ScenarioRef[] }`, with one entry per task group in order (latest run, and how many runs), and `unclaimed` the scenarios no task claimed at the start of execution.

#### Scenario: Unclaimed scenarios are reported
- **WHEN** the change loop converges after adding tasks for two unclaimed scenarios
- **THEN** `unclaimed` SHALL list those two scenarios

### Requirement: Feedback retries inside a loop
Feedback with action `"retry"` SHALL be carried into the next iteration of the same loop as that iteration's input, and MUST NOT leave the loop.

#### Scenario: A failing test is retried
- **WHEN** a task loop's verdict leaves a scenario unmet with action `"retry"`
- **THEN** the next iteration of that task loop SHALL receive the feedback

### Requirement: Feedback rises to the enclosing loop
A task loop ending `"exhausted"` or `"blocked"` SHALL hand its outcome to its group loop. A group or change check MAY answer with `"rework-task"` (reopen a task whose evidence regressed) or `"add-task"` (a target no task covered); the change check SHALL close unclaimed scenarios by adding tasks.

#### Scenario: A group check adds a task
- **WHEN** a group check finds a target none of its tasks links to
- **THEN** it SHALL issue `"add-task"` and run a task loop for the new task

### Requirement: A spec defect leaves the loops as an amendment
A finding of kind `"spec-defect"` SHALL produce feedback with action `"amend-spec"`, which ends the change loop `"blocked"` with an escalation, and moves the change to `amended` (see `openspec/process`). The fix is a delta change, not code; an agent may draft it, but re-approval stays the principal's.

#### Scenario: The 2026-10-11 amendment
- **GIVEN** `baseline-agentscript-durable`, whose spec said `run` throws `UndeclaredVariableError` and allowed nested `if`s
- **WHEN** tests showed the dialect's lint refuses both first, a `"spec-defect"` finding
- **THEN** the loop SHALL end with `"amend-spec"`, and the remedy SHALL be amended requirements, not changed code

### Requirement: A question goes to the escalation's recipient
Feedback with action `"ask"` SHALL set the loop's `escalation`, naming its recipient in `to`, and end the loop `"blocked"`.

#### Scenario: A needs-decision finding blocks
- **WHEN** a finding of kind `"needs-decision"` produces `"ask"` feedback
- **THEN** the loop SHALL end `"blocked"` with an `escalation` whose `question` states the decision

### Requirement: Only a converged task loop ticks its box
A task SHALL be ticked in tasks.md only when its task loop ends `"converged"`, and `TaskOutcome.ticked` SHALL then be `true`. A box MUST NOT be ticked from a summary line, a count or anything other than the loop's evidence.

#### Scenario: A passing summary line does not tick
- **WHEN** a test runner prints "all passed" but no evidence satisfies a task's targets
- **THEN** the task SHALL remain unticked

### Requirement: Rework unticks a task
Feedback with action `"rework-task"` SHALL untick the named task and run its task loop again.

#### Scenario: A regressed task is reopened
- **GIVEN** a ticked task whose scenario now fails
- **WHEN** a check issues `"rework-task"` for it
- **THEN** the task SHALL be unticked until its loop converges again
