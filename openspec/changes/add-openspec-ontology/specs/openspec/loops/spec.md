## Purpose

Executing a change as three nested feedback loops sharing one shape: a task loop per task, a group loop per task group, and a change loop over the whole task list, with typed iterations, verdicts, feedback and outcomes.

## ADDED Requirements

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

### Requirement: A verdict lists satisfied and unmet targets
The model SHALL define `Verdict` as `{ met: boolean, satisfied: Target[], unmet: { target: Target, reason: string }[] }`, where `Target` is a `RequirementRef`, a `ScenarioRef` or a named check. `met` SHALL be `true` exactly when `unmet` is empty.

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

### Requirement: An escalation says what a person must decide
The model SHALL define `Escalation` as `{ level: "task" | "group" | "change", reason: string, question: string }`, where `level` is the loop that stopped. A `"blocked"` outcome's escalation MUST carry a question a person can answer.

#### Scenario: A task loop escalates
- **WHEN** a task loop ends `"blocked"` on an `"ask"` feedback
- **THEN** its `escalation.level` SHALL be `"task"`

### Requirement: The task loop drives one task to its targets
The task loop SHALL take as goal one `Task` with its `TaskLink`s; its targets SHALL be the linked scenarios and requirements; it iterates attempts at that task. Its `Out` SHALL be `TaskOutcome` = `{ task: TaskId, ticked: boolean }`.

#### Scenario: A task's targets are its links
- **GIVEN** task `2.4` linking three CLI scenarios
- **WHEN** its loop runs
- **THEN** its verdicts SHALL judge exactly those three targets

### Requirement: The group loop drives one feature set
The group loop SHALL take as goal one `TaskGroup`; its targets SHALL be every target its tasks link to, plus no regression in targets earlier groups converged. It SHALL run its task loops in order, then a group check. Its `Out` SHALL be `GroupOutcome` = `{ group: integer, tasks: TaskOutcome[] }`.

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

### Requirement: The change loop reports its groups and what was unclaimed
The change loop's `Out` SHALL be `ChangeOutcome` = `{ groups: GroupOutcome[], unclaimed: ScenarioRef[] }`, where `unclaimed` lists the scenarios no task claimed at the start of execution.

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
A finding of kind `"spec-defect"` SHALL produce feedback with action `"amend-spec"`, which ends the change loop and moves the change to `amended` (see `openspec/process`). The fix is a delta change, not code.

#### Scenario: The 2026-10-11 amendment
- **GIVEN** `baseline-agentscript-durable`, whose spec said `run` throws `UndeclaredVariableError` and allowed nested `if`s
- **WHEN** tests showed the dialect's lint refuses both first, a `"spec-defect"` finding
- **THEN** the loop SHALL end with `"amend-spec"`, and the remedy SHALL be amended requirements, not changed code

### Requirement: A question goes to a person
Feedback with action `"ask"` SHALL set the loop's `escalation` and end the loop `"blocked"`.

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
