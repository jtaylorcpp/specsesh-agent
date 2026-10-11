---
id: step-failure
name: StepFailure
kind: type
area: process
spec:
  - "openspec/process: A step returns a result, never throws"
  - "openspec/process: Failure kinds mean distinct things"
related: [step-result, step, finding, escalation]
status: implemented
---

# StepFailure

Why a step failed, as one of four distinct kinds, with any findings behind it.

## Definition

```
StepFailure { step: string, kind: "invalid-input" | "refused" | "blocked" | "error", message: string, findings: Finding[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `step` | string | The name of the step that failed. |
| `kind` | `"invalid-input"` \| `"refused"` \| `"blocked"` \| `"error"` | What kind of failure it is (below). |
| `message` | string | What went wrong. |
| `findings` | [Finding](../evidence/finding.md)`[]` | The findings of the evidence that caused the failure, if any. |

**Kinds:**

| Kind | Means |
|---|---|
| `"invalid-input"` | The input failed its schema. |
| `"refused"` | A guard did not hold. |
| `"blocked"` | A decision the step cannot make itself is needed, and is escalated to a principal or an agent. |
| `"error"` | Anything the step could not act on. |

## Invariants

- The four kinds mean distinct things and are never interchangeable.
- A failure caused by evidence SHALL carry that evidence's findings.

## Relations

- Carried by a failed [StepResult](step-result.md).
- A `"blocked"` failure corresponds to an [Escalation](../loops/escalation.md) to a principal or an agent.
- `findings` are [Finding](../evidence/finding.md)s.

## Example

`pnpm spec:archive` refusing a change that does not pass `openspec validate --strict` is a `"refused"` failure: the guard did not hold.

## Spec

- `openspec/process`: A step returns a result, never throws
- `openspec/process`: Failure kinds mean distinct things
