---
id: validation-report
name: ValidationReport
kind: type
area: process
spec:
  - "openspec/process: Validate reports issues by level"
related: [validate-step, validation-evidence, change-state, archive-step]
status: implemented
---

# ValidationReport

Strict validation's verdict on a change, with every issue it found by level.

## Definition

```
ValidationReport { valid: boolean, issues: { level: "ERROR" | "WARNING" | "INFO", path: string, message: string }[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `valid` | boolean | Whether the change passes. |
| `issues` | array | Every issue found. |
| `issues[].level` | `"ERROR"` \| `"WARNING"` \| `"INFO"` | How serious the issue is. |
| `issues[].path` | string | Where the issue is. |
| `issues[].message` | string | What the issue is. |

## Invariants

- Under strict validation, `valid` SHALL be `false` when any issue is `ERROR` or `WARNING`.

## Relations

- Output of [validate](steps/validate-step.md).
- Guards two [ChangeState](change-state.md) transitions: `planned → validated` and `converged → archived` both need one with `valid` `true`, and the second needs one produced after convergence.
- Also an input to [approve](steps/approve-step.md), and carried as [ValidationEvidence](../evidence/validation-evidence.md).

## Example

A requirement whose text runs over 500 characters is reported by OpenSpec 1.14.1 as a `WARNING`; under `openspec validate --strict` the report's `valid` is `false`. This is why every requirement in this repo stays under 500 characters.

## Spec

- `openspec/process`: Validate reports issues by level
