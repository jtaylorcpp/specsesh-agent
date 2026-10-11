---
id: validate-step
name: validate
kind: step
area: process
spec:
  - "openspec/process: Validate reports issues by level"
  - "openspec/process: Each forward transition follows its step"
  - "openspec/process: Archiving needs convergence and a fresh valid report"
related: [step, change, validation-report, plan-step, approve-step, archive-step, change-state]
status: implemented
---

# validate

A tool checks a change strictly and reports every issue by level.

## Definition

```
validate: Step<Change, ValidationReport>, actor "tool"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | [Change](../../../taxonomy/change.md) | The change to check. |
| **Output** | [ValidationReport](../validation-report.md) | `valid`, and every issue with its level, path and message. |
| **Actor** | `"tool"` | |

## Invariants

- Under strict validation, `valid` SHALL be `false` when any issue is `ERROR` or `WARNING`.
- A report with `valid` `true` licenses `planned → validated`.
- Run again after convergence, a report with `valid` `true` licenses `converged → archived`. A report from before execution does not.

## Relations

- Follows [plan](plan-step.md); its report is input to [approve](approve-step.md) and the guard of [archive](archive-step.md).
- Guards two transitions of [ChangeState](../change-state.md).

## Example

`openspec validate <id> --strict`. A requirement over 500 characters is a `WARNING`, so the report's `valid` is `false`.

## Spec

- `openspec/process`: Validate reports issues by level
- `openspec/process`: Each forward transition follows its step
- `openspec/process`: Archiving needs convergence and a fresh valid report
