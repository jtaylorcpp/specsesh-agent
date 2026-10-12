## Why

The principal's rule: **a task iterates until its tests pass or it hits the loop limit, and iterating is the default.** Running `add-group-loop` on our own agent showed where today's loop falls short of that:

- **Convergence is the judge's word, not the checks'.** The task loop converges whenever the judge says `met`. Nothing in the loop requires the checks to pass; only a tuned script's wording asked for it.
- **The bundled judges escalate too readily.** `task.agent` offers retry, amend-spec and ask as equals, so a solvable failure can end as a question to a person. Driving `add-group-loop` needed a tuned copy of the script (`task-iterate.agent`) that defaults to retry.
- **`next_action` is free text.** The step's result schema says only `string`, so the model once answered `"retry. Both questions can be settled…"`, and the loop correctly failed it as a broken contract. Nothing told the model the three allowed values.
- **The budget is too small.** The default of 3 iterations ran out on real tasks: 4.4 needed 6.

## What Changes

- **Choices: a host constrains a string variable to fixed values.** `StartOptions` gains `choices` (a variable name mapped to its allowed strings). A structured step that writes a chosen variable gets `enum` in its result schema, so the provider sees the values and `submit_result` refuses anything else. A result outside the choices sets nothing. `start` refuses choices that name an undeclared or non-string variable, or that exclude the variable's own default. The dialect has no enum syntax, so the value set comes from the host that owns the contract, not the script.
- **The loops pass their contract values as choices:**
  - the task loop: `next_action` is one of `retry`, `amend-spec`, `ask`;
  - the group loop: `next_action` is one of `rework`, `ask`, `amend-spec`.

  The read-back checks stay as a second line of defence.
- **A met verdict converges only when the checks pass.** The task loop gains a fourth phase, `gate`. When the judge says `met` and checks are configured, the loop runs every check itself, with no model. If all pass, the task converges. If not, the iteration is recorded unmet, the failing commands and their output are carried into the next iteration, and the loop retries within budget. With no checks configured, `met` converges as before.
- **The bundled judges iterate first:**
  - **task scripts** (`task.agent`, `task-delegate.agent`): retry is the default. The task is done only when the checks pass. `amend-spec` is only for deltas that contradict themselves or the code. `ask` is only for a decision no passing check could settle. The judge answers `next_action` with one word and puts every explanation in `unmet`.
  - **`group.agent`:** rework stays the default while budget remains, with sharper feedback. `ask` is only for a decision no rework could settle.

  `task-iterate.agent` is retired: the bundled scripts now do what it did.
- **A bigger default budget.** `maxIterations` defaults to `8` in the library and the CLI.
- **This repo's config** runs its tasks on Opus (`model` and `delegateModel` `opus`, per the principal) with `maxIterations` `8`.
- **Task sizing guidance.** `CLAUDE.md`'s spec workflow says one task covers a handful of scenarios: a test task names at most about 8, so a capability's tests split across tasks.

## Out of scope

- **Not counting an iteration in which the delegate changed nothing.** Seeing that needs the delegate to report the files it changed. That belongs to `add-agentscript-delegation`, whose delegate `Evidence` already includes `DiffEvidence`.
- **Choices on action inputs and on deterministic `set` lines.** Choices constrain model results only.
- **Any change to the Agent Script dialect.**

## Capabilities

- **Modified:**
  - `core/composition`: choices, the schema's `enum`, refusing a result outside its choices;
  - `core/step-machine`: the new error class;
  - `durable/run-task`: `RunInput` options carry choices; `checkResult` refuses a value outside its `enum`;
  - `durable/host`: `startScript` passes choices through;
  - `task/agent`: the default budget, the `gate` phase, `next_action` choices, the bundled scripts' stance;
  - `task/group`: `next_action` choices, the bundled judge's stance;
  - `task/headless`: the default budget, this repo's config.

## Impact

- `packages/agent/src/interpreter/` (start options, schema derivation, applying results), `src/durable/` (`checkResult`, run input), `src/task/` (loop phases, defaults, choices, scripts), the CLI defaults, `agentscript.config.json`, `CLAUDE.md`, the docs pages for loop phases and budgets, and tests (faux provider and fake `claude` only).
- Depends on nothing open. `add-agentscript-delegation` follows it.
- Scripts that relied on `met` alone, with failing checks, now iterate instead of converging. That's the point.
