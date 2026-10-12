---
id: plan-step
name: plan
kind: step
area: process
spec:
  - "openspec/process: Plan follows the deltas and the design"
  - "openspec/process: Each forward transition follows its step"
related: [step, proposal, delta, design, task-list, design-step, specify-step, validate-step, change-state]
status: implemented
---

# plan

Writes the change's task list from its proposal, deltas and design.

## Definition

```
plan: Step<{ proposal, deltas, design }, TaskList>, actor "agent"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ proposal: Proposal, deltas: Delta[], design: Design }` | Everything the earlier steps produced: the deltas from [specify](specify-step.md) and the [Design](../../../taxonomy/design.md) from [design](design-step.md), which ran before `specify`. The tasks are derived from both the requirements and the approved design. |
| **Output** | [TaskList](../../../taxonomy/task-list.md) | The numbered task groups of `tasks.md`. |
| **Actor** | `"agent"` | |

## Invariants

- Its input SHALL include the `design` the `design` step produced.
- Completing it moves the change `specified → planned`.

## Relations

- Fourth in `STEPS`: propose → design → specify → plan → validate → approve → execute → archive.
- Follows [specify](specify-step.md); its output is what [validate](validate-step.md) checks next, and what the loops later execute.
- Drives a transition of [ChangeState](../change-state.md).

## Example

`baseline-agentscript-durable`'s `tasks.md`: three groups (core tests, durable tests, close), with tasks such as `2.4`.

## Spec

- `openspec/process`: Plan follows the deltas and the design
- `openspec/process`: Each forward transition follows its step
