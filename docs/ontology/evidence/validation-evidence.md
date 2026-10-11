---
id: validation-evidence
name: ValidationEvidence
kind: type
area: evidence
spec:
  - "openspec/evidence: The other evidence kinds have fixed fields"
related: [evidence, validation-report, change-loop]
status: modelled
---

# ValidationEvidence

A ValidationReport, recorded as evidence.

## Definition

```
ValidationEvidence { kind: "validation", report: ValidationReport }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"validation"` | Discriminant. |
| report | `ValidationReport` | The validation's verdict and issues. |

## Invariants

None.

## Relations

- A kind of [Evidence](evidence.md) wrapping a [ValidationReport](../process/validation-report.md).
- The [Change loop](../loops/change-loop.md) needs one with `valid: true`.

## Example

`openspec validate baseline-pi-adapter --strict` failing on a requirement over 500 characters is recorded as `{ kind: "validation", report: { valid: false, issues: [{ level: "WARNING", … }] } }`.

## Spec

- `openspec/evidence: The other evidence kinds have fixed fields`
