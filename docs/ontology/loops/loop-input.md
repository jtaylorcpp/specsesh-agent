---
id: loop-input
name: LoopInput
kind: type
area: loops
spec:
  - "openspec/loops: A loop input carries the goal, context, budget and carried feedback"
related: [loop, budget, feedback, escalation-answer, context-ref]
status: modelled
---

# LoopInput

What a loop run starts from: its goal, the context it reads, its budget, and feedback handed down to it.

## Definition

```
LoopInput<Goal> { goal: Goal, context: ContextRef[], budget: Budget, carried: Feedback[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| goal | `Goal` | What the loop drives to: a `Task`, a `TaskGroup` or a `TaskList`, by level. |
| context | `ContextRef[]` | What the loop reads: files, spec items, changes or docs (see [ContextRef](context-ref.md)). |
| budget | `Budget` | How many iterations (and optionally how long) the loop may take. |
| carried | `Feedback[]` | Feedback handed down from the enclosing loop, or from an escalation answer. |

## Invariants

- `budget.maxIterations` SHALL be at least `1`; a `LoopInput` with `0` fails its check.
- When a blocked loop resumes, `carried` SHALL include the `EscalationAnswer`'s `feedback`.

## Relations

- [ContextRef](context-ref.md) names each thing the loop reads.
- [Budget](budget.md) bounds the run.
- [Feedback](feedback.md) fills `carried`.
- [EscalationAnswer](escalation-answer.md) supplies `carried` when a blocked loop resumes.
- Input of every [Loop](loop.md).

## Example

The task loop for task `2.4` of `baseline-agentscript-durable` starts from `{ goal: <task 2.4>, context: [{ kind: "file", ref: "packages/agentscript-durable/src/cli.ts" }, …], budget: { maxIterations: 3 }, carried: [] }`. If it is blocked and the principal answers with `"retry"` feedback, the new run starts with that feedback in `carried`.

## Spec

- `openspec/loops: A loop input carries the goal, context, budget and carried feedback`
