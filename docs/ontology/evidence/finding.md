---
id: finding
name: Finding
kind: type
area: evidence
spec:
  - "openspec/evidence: A finding classifies what went wrong"
  - "openspec/evidence: Finding kinds say where the fault lies"
related: [evidence, target, feedback]
status: modelled
---

# Finding

What a failed check found, and where the fault lies.

## Definition

```
Finding { kind: "code-defect" | "spec-defect" | "test-defect" | "environment" | "needs-decision", target?: Target, evidence: Evidence[], message: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | see below | Where the fault lies. |
| target | `Target`, optional | The target it concerns. |
| evidence | `Evidence[]` | What it rests on. Non-empty. |
| message | `string` | What was found. |

## Invariants

- `evidence` SHALL be non-empty: a finding rests on evidence.
- `"code-defect"`: the code is wrong against the spec.
- `"spec-defect"`: the spec is wrong against intended behaviour.
- `"test-defect"`: the test is wrong.
- `"environment"`: a cause outside the change.
- `"needs-decision"`: a choice the loop cannot make itself, which it escalates to a principal or an agent.

## Relations

- Rests on [Evidence](evidence.md); may name a [Target](../loops/target.md).
- Every [Feedback](../loops/feedback.md) item comes `from` one; `"spec-defect"` becomes `"amend-spec"`, `"needs-decision"` becomes `"ask"`.

## Example

A test written to a scenario failing because the scenario misdescribes intended behaviour is a `"spec-defect"`, as on 2026-10-11 for `baseline-agentscript-durable`. A `Finding` with `evidence: []` fails its check.

## Spec

- `openspec/evidence: A finding classifies what went wrong`
- `openspec/evidence: Finding kinds say where the fault lies`
