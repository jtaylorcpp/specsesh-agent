---
id: loop
name: Loop
kind: loop
area: loops
spec:
  - "openspec/loops: A loop has one shape at every level"
related: [loop-input, iteration, verdict, feedback, loop-outcome, task-loop, group-loop, change-loop]
status: implemented
---

# Loop

The one feedback-loop shape that the task, group and change loops all instantiate.

## Definition

```
Loop<Goal, Out> {
  input:  LoopInput<Goal>
  each:   Iteration[]
  output: LoopOutcome<Out>
}
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| input | `LoopInput<Goal>` | The goal, context, budget and carried feedback. |
| each | `Iteration[]` | The rounds the loop runs, numbered from `1`. |
| output | `LoopOutcome<Out>` | How the loop ended, its iterations, and its result or escalation. |

## Invariants

- The task, group and change loops MUST be instances of this one shape, differing only in `Goal`, targets and `Out`.
- Each level SHALL use `LoopInput`, `Iteration`, `Verdict`, `Feedback` and `LoopOutcome` unchanged.

## Relations

- [LoopInput](loop-input.md) is what a run starts from.
- [Iteration](iteration.md) is one round; its [Verdict](verdict.md) decides whether the loop ends.
- [LoopOutcome](loop-outcome.md) is what a run returns.
- Instances: [Task loop](task-loop.md) (`Goal` = one task), [Group loop](group-loop.md) (`Goal` = one task group), [Change loop](change-loop.md) (`Goal` = the task list).

## Example

Executing `baseline-agentscript-durable` is one change loop over its three task groups; group `2` is a group loop over tasks `2.1`–`2.5`; task `2.4` is a task loop. All three are `Loop<Goal, Out>` with different `Goal` and `Out`.

## Spec

- `openspec/loops: A loop has one shape at every level`
