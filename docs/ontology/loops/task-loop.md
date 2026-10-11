---
id: task-loop
name: Task loop
kind: loop
area: loops
spec:
  - "openspec/loops: The task loop drives one task to its targets"
  - "openspec/loops: Only a converged task loop ticks its box"
  - "openspec/loops: Rework unticks a task"
  - "task/agent: The loop is one durable task with three phases"
related: [loop, task, task-link, task-outcome, group-loop]
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
- `task/agent: The loop is one durable task with three phases`
