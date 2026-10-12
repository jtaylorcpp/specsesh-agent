---
id: task-loop
name: Task loop
kind: loop
area: loops
spec:
  - "openspec/loops: The task loop drives one task to its targets"
  - "openspec/loops: Only a converged task loop ticks its box"
  - "openspec/loops: Rework unticks a task"
  - "task/agent: The loop is one durable task with four phases"
  - "task/agent: Judge maps a failed run and a met verdict"
  - "task/agent: The gate converges a met verdict only when every check passes"
  - "task/agent: A gate failure carries the failing output"
  - "task/agent: The loop constrains next_action to its contract values"
  - "task/agent: A run ended by a failed action is retried within budget"
  - "task/agent: Optional options have defaults"
  - "task/agent: The bundled task judges iterate first"
related: [loop, task, task-link, task-outcome, group-loop, check-evidence, finding, budget]
status: implemented
---

# Task loop

The loop that drives one task until the requirements and scenarios it links to hold.

## Definition

```
Loop<Task, TaskOutcome>
  goal:    one Task with its TaskLinks
  targets: the linked scenarios and requirements
  iterates: attempts at that task
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| Goal | `Task` (with its `TaskLink`s) | The task being made real. |
| Targets | linked `ScenarioRef`s and `RequirementRef`s | What each verdict judges, exactly. |
| Out | `TaskOutcome` | `{ task: TaskId, ticked: boolean }`. |

## Invariants

- A task SHALL be ticked in tasks.md only when its task loop ends `"converged"`, and `TaskOutcome.ticked` is then `true`.
- A box MUST NOT be ticked from a summary line, a count or anything other than the loop's evidence.
- `"rework-task"` feedback SHALL untick the task and run its loop again.
- Ending `"exhausted"` or `"blocked"`, it SHALL hand its outcome to its group loop.

## Four phases

The loop is one durable task with four phases:

```
iterate → await → judge → (gate) → iterate | terminal
```

- **iterate** starts an `agentscript.run` child with the script, the seeded variables, the contract's choices, and entry set to the script's subagents in source order.
- **await** waits for that child, idempotently by child id.
- **judge** reads the finished run.
  - If the run failed because a step failed, the loop ends failed with an `"environment"` finding.
  - If it failed because an action failed (for example a delegate timeout), the iteration is recorded unmet and retried within budget, carrying the action's message.
  - A met verdict goes to **gate** when checks are configured, and converges when none are.
  - Anything else retries or exhausts as before.
- **gate** runs every check in the workspace, argv split with no shell. If all exit 0, the loop converges and ticks the task. If any fail, the iteration is recorded unmet:
  - the reason is `the judge said met, but the checks failed: <cmd> exited <code>`, comma-joined over the failing checks;
  - one `"code-defect"` [Finding](../evidence/finding.md) with one [CheckEvidence](../evidence/check-evidence.md) per check, and retry feedback;
  - `carried` is the reason, a blank line, then per failing check `$ <cmd> (exit <code>)` followed by the last 4000 characters of its output, checks separated by a blank line.

  Then the loop iterates under budget or exhausts.

Notes:

- The checkpoint version stays 1.
- A crash in gate re-runs the checks on resume and starts no new child run, because checks only read.
- The gate always runs on met, even if the script's own check step passed.
- There is no new event kind: the gated iteration's `verdict` event reports `met: false` with the gate's reason.

## next_action choices

The loop passes `choices: { next_action: ["retry", "amend-spec", "ask"] }` (`NEXT_ACTIONS`) on every child run.

- The judge step's `submit_result` schema then carries an `enum` with those values, and a structured result outside them fails the step, so no variable is set.
- A script whose `next_action` default is outside them is refused at `startTaskLoop`, naming the default, before any loop exists.
- The read-back checks remain as a second line of defence.

The mechanism is `StartOptions.choices` in the interpreter; no concept page covers it.

## Budget and judge stance

The [Budget](budget.md)'s `maxIterations` defaults to 8 for a task loop. The bundled judges iterate first: `"retry"` is the default, and the task is done only when the checks pass. `"amend-spec"` and `"ask"` are reserved for contradictory deltas or undecidable questions, and `next_action` is one word.

## Relations

- An instance of [Loop](loop.md) over one [Task](../../taxonomy/task.md); its targets come from the task's [TaskLink](../../taxonomy/task-link.md)s.
- Returns a [TaskOutcome](task-outcome.md); run in order by its [Group loop](group-loop.md).
- Implemented as the pi-durable task `agentscript.task-loop` in `@specsesh/agent/task` (`packages/agent/src/task/`), with the `agentscript-task` CLI. Until the parser links tasks to scenarios, its verdicts judge the one target `{ check: "task <id>" }`, from the judge step of an Agent Script run once per iteration.

## Example

Task `2.4` of `baseline-agentscript-durable` links three CLI scenarios; its loop's verdicts judge exactly those three. A test runner printing "all passed" while no evidence satisfies them leaves the task unticked.

## Spec

- `openspec/loops: The task loop drives one task to its targets`
- `openspec/loops: Only a converged task loop ticks its box`
- `openspec/loops: Rework unticks a task`
- `task/agent: The loop is one durable task with four phases`
- `task/agent: Judge maps a failed run and a met verdict`
- `task/agent: The gate converges a met verdict only when every check passes`
- `task/agent: A gate failure carries the failing output`
- `task/agent: The loop constrains next_action to its contract values`
- `task/agent: A run ended by a failed action is retried within budget`
- `task/agent: Optional options have defaults`
- `task/agent: The bundled task judges iterate first`
