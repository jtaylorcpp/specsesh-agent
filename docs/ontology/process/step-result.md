---
id: step-result
name: StepResult
kind: type
area: process
spec:
  - "openspec/process: A step returns a result, never throws"
related: [step, step-failure]
status: implemented
---

# StepResult

What every step returns: its output value, or a failure. A step never throws.

## Definition

```
StepResult<Out> = { ok: true, value: Out } | { ok: false, failure: StepFailure }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | The discriminant: `true` for success, `false` for failure. |
| `value` | `Out` | The step's output. Present only when `ok` is `true`. |
| `failure` | [StepFailure](step-failure.md) | Why the step failed. Present only when `ok` is `false`. |

## Invariants

- A step MUST return a `StepResult`, never throw. Input that fails its schema is returned as `{ ok: false, failure }` with `failure.kind` `"invalid-input"`.
- Exactly one of `value` and `failure` is present, as `ok` says.

## Relations

- Every [Step](step.md) returns one, wrapping its `Out`.
- A failure carries a [StepFailure](step-failure.md).

## Example

`archive` given a change whose latest report has `valid: false` returns `{ ok: false, failure: { step: "archive", kind: "refused", message, findings: [] } }`.

## Spec

- `openspec/process`: A step returns a result, never throws
