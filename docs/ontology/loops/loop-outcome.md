---
id: loop-outcome
name: LoopOutcome
kind: type
area: loops
spec:
  - "openspec/loops: A loop outcome has one of four statuses"
  - "openspec/loops: Each status has one cause"
related: [loop, iteration, escalation, budget, task-outcome, group-outcome, change-outcome]
status: implemented
---

# LoopOutcome

How a loop run ended: its status, every iteration, and its result or escalation.

## Definition

```
LoopOutcome<Out> { status: "converged" | "blocked" | "exhausted" | "failed", iterations: Iteration[], result?: Out, escalation?: Escalation }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| status | `"converged"` · `"blocked"` · `"exhausted"` · `"failed"` | How the run ended. |
| iterations | `Iteration[]` | Every iteration the run took. |
| result | `Out`, optional | Present when `status` is `"converged"`. |
| escalation | `Escalation`, optional | Present exactly when `status` is `"blocked"`. |

## Invariants

- `"converged"`: an iteration's verdict is met. `result` SHALL be present and `escalation` absent.
- `"blocked"`: feedback has action `"ask"` or `"amend-spec"`. `escalation` SHALL be present.
- `"exhausted"`: `budget.maxIterations` iterations ran with targets unmet.
- `"failed"`: an error the loop cannot act on.
- Each status has that one cause.

## Relations

- Output of every [Loop](loop.md); `Out` is [TaskOutcome](task-outcome.md), [GroupOutcome](group-outcome.md) or [ChangeOutcome](change-outcome.md) by level.
- Records its [Iteration](iteration.md)s; carries an [Escalation](escalation.md) when blocked; `exhausted` comes from the [Budget](budget.md).

## Example

With `budget.maxIterations: 3`, a loop whose third verdict is not met and whose feedback neither asks nor amends ends `{ status: "exhausted", iterations: [<1>, <2>, <3>] }`, with no `result` and no `escalation`.

## Spec

- `openspec/loops: A loop outcome has one of four statuses`
- `openspec/loops: Each status has one cause`
