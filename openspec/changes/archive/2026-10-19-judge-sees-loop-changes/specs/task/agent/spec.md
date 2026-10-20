## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: The delegate script shows the judge what changed and changes approach
`task-delegate.agent` SHALL set `act_files` from the delegate's `files_changed`, and its judge prompt SHALL contain `Files the delegate changed in this iteration: ` followed by that number, `(-1 means unknown)`, and `Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.` Its orient step SHALL say that when the carried feedback names a check that already failed before, the last approach did not work and a different one is needed.

#### Scenario: The judge sees an idle delegate
- **GIVEN** a fake `claude` that writes no file
- **WHEN** an iteration of `task-delegate.agent` reaches its judge step
- **THEN** the judge's prompt SHALL contain `Files the delegate changed in this iteration: 0` and `0 alone does not mean the task is unfinished`, and SHALL NOT contain `0 means the delegate changed nothing`

#### Scenario: Orient asks for a different approach
- **WHEN** `task-delegate.agent`'s orient step is composed for iteration `2`
- **THEN** its prompt SHALL contain `the last approach did not work`
