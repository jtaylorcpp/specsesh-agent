---
id: iteration
name: Iteration
kind: type
area: loops
spec:
  - "openspec/loops: An iteration plans, acts, gathers evidence and judges"
related: [loop, action, evidence, verdict, feedback]
status: modelled
---

# Iteration

One round of a loop: plan, act, gather evidence, judge it, feed back.

## Definition

```
Iteration { n: integer, plan: string, actions: Action[], evidence: Evidence[], verdict: Verdict, feedback: Feedback[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| n | `integer` | The iteration's number, starting at `1` and increasing by one. |
| plan | `string` | What this iteration means to do. |
| actions | `Action[]` | What it did to the workspace. |
| evidence | `Evidence[]` | What it gathered. |
| verdict | `Verdict` | Whether the goal's targets are met, judged from `evidence` only. |
| feedback | `Feedback[]` | What the unmet targets call for. |

## Invariants

- `n` SHALL start at `1` and increase by one.
- `verdict` SHALL be judged from `evidence` only.
- Each unmet target of `verdict` SHALL produce at least one `feedback` item.

## Relations

- [Action](action.md), [Evidence](../evidence/evidence.md), [Verdict](verdict.md) and [Feedback](feedback.md) are its parts.
- A [Loop](loop.md) runs a sequence of them; [LoopOutcome](loop-outcome.md) records them all.

## Example

A task loop that has run three iterations has iterations with `n` `1`, `2` and `3`. In iteration `1`, task `2.4`'s test for one scenario fails: the verdict lists that scenario as unmet, and `feedback` holds a `"retry"` item for it.

## Spec

- `openspec/loops: An iteration plans, acts, gathers evidence and judges`
