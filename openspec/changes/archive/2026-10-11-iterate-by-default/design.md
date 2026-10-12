## Context

Probed on 2026-10-11 against the pinned dialect: a variable declaration carries only `description`, `label` and `is_required` (`@sf-agentscript/language` `VariablePropertiesBlock`). There is no enum syntax. The result schema is derived from the `set` lines and the declared types (`outputSchemaFor` in `interpreter/compose.ts`), so every string field is a bare `{ type: "string" }`.

The task loop's `judge` phase converges on `met` alone (`openspec/loops.ts` `outcomeStatus`: last verdict met → `"converged"`). Checks run only if the script calls `run_checks`, and their result reaches the loop only through the judge's own reading of them.

## Choices

```
StartOptions = { entry?, variables?, choices?: Record<string, readonly string[]> }

start:    after the undeclared check, refuse InvalidChoicesError when a choice
            - names a variable the document does not declare
            - names a variable not declared string
            - is an empty list
            - excludes the variable's opening value (authored default, then override)
schema:   a field writing a chosen variable → { type: "string", enum: [...choices] }
            (a field feeding two variables takes the later one's, as for type)
apply:    a structured value for a chosen variable outside its choices → the step fails
            category unknown, message naming the field, @variables.<x>, the choices, "No variable was set"
durable:  RunInput.options carries choices (it is StartOptions); checkResult adds
            "<field>" must be one of "a", "b", got "x"   for a property with enum
```

- **Choices sit in the run's state** with the other start options, so a resumed run uses the same choices. `RunState`'s exact shape gains an optional `choices` key only when choices were given, so a run started without them keeps today's shape exactly.
- **Only model results are constrained.** A deterministic `set` from an action output or a literal is the author's code, and the host's read-back still checks it.
- **Why a host option, not syntax:** the value set belongs to whoever reads the variable back, here the loop's contract. A script author who tunes the judge can't widen it.

## The gate

```
task-loop phases: iterate → await → judge → (gate) → iterate | terminal

judge:  met and checks.length > 0 → checkpoint { phase: "gate", iterations, carried, child, read }
        met and no checks         → converged (as today)
        otherwise                 → as today
gate:   run every check in the workspace, argv split, no shell (the group check's runner)
        all exit 0 → converged, tick
        any fail   → iteration n recorded unmet:
                       reason   "the judge said met, but the checks failed: <cmd> exited <code>[, …]"
                       finding  kind "code-defect", evidence one CheckEvidence per check
                       feedback retry
                     then outcomeStatus over this run's iterations: under budget → iterate with
                     carried = reason + "\n\n" + per failing check "$ <cmd> (exit <code>)\n<last 4000 chars of output>"
                     budget spent → exhausted
```

- **The version stays 1.** The checkpoint union gains one phase, and every old checkpoint is still valid. A process that dies in `gate` re-runs the checks on resume. That's safe: checks only read.
- **The gate always runs when the judge says met,** even when the script's own check step just passed. A custom script may edit after checking, or not check at all. The cost is one extra check run per converging iteration, not per iteration.
- **Events:** no new kind. The `verdict` event for a gated iteration reports `met: false` with the gate's reason, so the stream shows exactly why the loop went round again.

## Contract choices

| Loop | Variable | Choices |
|---|---|---|
| `agentscript.task-loop` | `next_action` | `retry`, `amend-spec`, `ask` (`NEXT_ACTIONS`) |
| `agentscript.group-loop` | `next_action` | `rework`, `ask`, `amend-spec` |

Each loop passes these as `choices` on every child run it starts. A script whose `next_action` default lies outside them is refused at start, by the contract check, before any loop exists (today's bundled defaults are `retry` and `rework`).

## Iterate-first judges

The task scripts' judge instructions end with these four lines, adapted from `task-iterate.agent`, which drove `add-group-loop` from 1.4 to 6.1:

```
| Is the task done against the spec deltas? It is done only when the checks pass. If not, say exactly what is unmet.
| Choose next_action. Default to retry: keep iterating until the checks pass. A change outside this task's files is allowed when the spec deltas already require it and the checks need it.
| Choose amend-spec only when the spec deltas themselves contradict each other or the code they describe. Choose ask only for a decision that no passing check could settle.
| Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.
```

`group.agent`'s stance changes from "prefer asking over repeating a rework that did not help" to "while reworks remain, rework the task most likely at fault with sharper feedback; ask only for a decision no rework could settle".

## Risks

- **More iterations cost more.** The default rises from 3 to 8 and the gate adds a check run per converging iteration. The budget still bounds both, and a converging task usually stops in 1 to 3 iterations, as `add-group-loop` showed.
- **A flaky check can bounce a met verdict.** The loop retries it, as it should, and exhausts if the flake persists. That's visible in the stream, not hidden.
