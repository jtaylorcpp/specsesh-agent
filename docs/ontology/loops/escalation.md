---
id: escalation
name: Escalation
kind: type
area: loops
spec:
  - "openspec/loops: An escalation names who must decide and what"
  - "openspec/loops: A question goes to the escalation's recipient"
  - "openspec/loops: A spec defect leaves the loops as an amendment"
related: [loop-outcome, escalation-answer, feedback]
status: implemented
---

# Escalation

The question a blocked loop sends to a principal or an agent, and why.

## Definition

```
Escalation { level: "task" | "group" | "change", to: "principal" | "agent", reason: string, question: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| level | `"task"` · `"group"` · `"change"` | The loop that stopped. |
| to | `"principal"` · `"agent"` | Who must answer: a human principal or an AI agent outside the loop. |
| reason | `string` | Why the loop stopped. |
| question | `string` | What the recipient must decide. |

## Invariants

- A `"blocked"` outcome SHALL carry exactly one escalation, and only a blocked outcome carries one.
- Its `question` MUST be one its recipient can answer.
- The loop stays `"blocked"` until it is answered, whoever `to` names.
- An agent may answer and draft an amendment, but re-approving an amended change stays the principal's.

## Relations

- Set by `"ask"` or `"amend-spec"` [Feedback](feedback.md).
- Carried by a blocked [LoopOutcome](loop-outcome.md).
- Answered by an [EscalationAnswer](escalation-answer.md).

## Example

A task loop ending `"blocked"` on `"ask"` feedback has `escalation.level: "task"`. A `"test-defect"` finding a reviewing agent can settle may escalate with `to: "agent"`; the loop is still blocked until that agent answers.

## Spec

- `openspec/loops: An escalation names who must decide and what`
- `openspec/loops: A question goes to the escalation's recipient`
- `openspec/loops: A spec defect leaves the loops as an amendment`
