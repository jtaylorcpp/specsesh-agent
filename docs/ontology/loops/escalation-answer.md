---
id: escalation-answer
name: EscalationAnswer
kind: type
area: loops
spec:
  - "openspec/loops: An answered escalation resumes the loop"
related: [escalation, loop-input, feedback]
status: implemented
---

# EscalationAnswer

The named recipient's decision on an escalation, which resumes the blocked loop.

## Definition

```
EscalationAnswer { escalation: Escalation, by: "principal" | "agent", decision: string, feedback: Feedback[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| escalation | `Escalation` | The escalation being answered. |
| by | `"principal"` · `"agent"` | Who answered. MUST equal `escalation.to`. |
| decision | `string` | What was decided. |
| feedback | `Feedback[]` | Feedback the resumed loop carries. |

## Invariants

- `by` MUST equal `escalation.to`; an answer from anyone else is rejected as invalid input.
- A blocked loop SHALL resume only as a new run of the same loop whose `LoopInput.carried` includes this `feedback`.
- The earlier run's iterations SHALL stay recorded.

## Relations

- Answers an [Escalation](escalation.md).
- Its [Feedback](feedback.md) goes into the new run's [LoopInput](loop-input.md)`.carried`.

## Example

A task loop ended `"blocked"` with `escalation.to: "principal"`. The principal answers `{ by: "principal", decision: "…", feedback: [{ action: "retry", … }] }`, and the task loop runs again with that feedback carried. An answer to the same escalation with `by: "agent"` is rejected.

## Spec

- `openspec/loops: An answered escalation resumes the loop`
