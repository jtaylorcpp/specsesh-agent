## RENAMED Requirements

- FROM: `### Requirement: The loop is one durable task with three phases`
- TO: `### Requirement: The loop is one durable task with four phases`

## REMOVED Requirements

### Requirement: Defaults for optional options
**Reason**: The default budget rises from 3 to 8, which falsifies its scenario's name.
**Migration**: Replaced by "Optional options have defaults", with the same defaults except `budget.maxIterations` `8`.

## MODIFIED Requirements

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
In `judge`, a child run that did not complete, or completed with `RunResult.kind` other than `"completed"`, SHALL end the loop `"failed"` with a `Finding` of kind `"environment"`. A completed run with `met` true SHALL move to `gate` when `checks` is non-empty, and otherwise end the loop `"converged"`, ticking the task as the ticking requirements allow.

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

### Requirement: The bundled scripts are the default and the subscription variant
The package SHALL ship `task.agent` (orient, act with model-callable `read_file`, `edit_file`, `run_command`, check with deterministic `run_checks`, judge) as the default, and `task-delegate.agent`, acting through the deterministic `delegate_claude_code`, for providers without model-callable tools. Both MUST satisfy the contract, lint with zero diagnostics, and judge iterate-first as the iterate-first requirement says.

#### Scenario: The bundled scripts lint clean
- **WHEN** the shipped `task.agent` and `task-delegate.agent` are analysed
- **THEN** each SHALL have zero diagnostics and pass the contract check

## ADDED Requirements

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
Every child run the task loop starts SHALL carry `choices: { next_action: ["retry", "amend-spec", "ask"] }`, so the judge step's result schema lists them and a value outside them is refused. A script whose `next_action` default is not one of them MUST be refused at start by the contract check, naming the default, before any loop exists.

#### Scenario: The judge step's schema lists the three values
- **WHEN** the bundled `task.agent`'s judge step is dispatched
- **THEN** its `submit_result` parameters SHALL give `next_action` `enum: ["retry", "amend-spec", "ask"]`

#### Scenario: A default outside the values is refused
- **GIVEN** a task script declaring `next_action: mutable string = "proceed"`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `next_action` and `"proceed"`, and no loop SHALL be created

### Requirement: The bundled task judges iterate first
The judge in `task.agent` and `task-delegate.agent` SHALL say: the task is done only when the checks pass; retry is the default until they do; `amend-spec` only when the deltas contradict themselves or the code; `ask` only for a decision no passing check could settle; and `next_action` is exactly one word, every explanation going in `unmet`.

#### Scenario: The judge prompt says retry is the default
- **WHEN** either bundled script's judge step is composed
- **THEN** its prompt SHALL contain `It is done only when the checks pass`, `Default to retry` and `Answer next_action with exactly one word`
