---
id: step
name: Step
kind: type
area: process
spec:
  - "openspec/process: A step has a named input, output and actor"
  - "openspec/model: Every model type has a static type and a JSON Schema"
related: [step-result, step-failure, propose-step, specify-step, design-step, plan-step, validate-step, approve-step, execute-step, archive-step]
status: implemented
---

# Step

A named step of the change lifecycle, with one typed input, one typed output and the actor who performs it.

## Definition

```
Step<In, Out> { name: string, input: In, output: Out, actor: "principal" | "agent" | "tool" | "loop" }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `name` | string | The step's name: `propose`, `specify`, `design`, `plan`, `validate`, `approve`, `execute` or `archive`. |
| `In` | a model type | What the step takes. |
| `Out` | a model type | What the step hands back, wrapped in a [StepResult](step-result.md). |
| `actor` | `"principal"` \| `"agent"` \| `"tool"` \| `"loop"` | Who performs the step. |

## Invariants

- Every step's `In` and `Out` MUST be types defined in `openspec/model`, `openspec/process`, `openspec/loops` or `openspec/evidence`.
- Every `In` and `Out` is declared once as a JSON Schema with its static type derived from it; cross-field rules are checked alongside the schema, and the check is the authority.
- A step returns a [StepResult](step-result.md); it never throws.

## Relations

- Returns a [StepResult](step-result.md), which on failure carries a [StepFailure](step-failure.md).
- The eight lifecycle steps, in order:

  | Step | Input | Output | Actor |
  |---|---|---|---|
  | [propose](steps/propose-step.md) | [Intent](intent.md) | [Proposal](../../taxonomy/proposal.md) | `agent` |
  | [specify](steps/specify-step.md) | `{ proposal, base: Capability[] }` | [Delta](../../taxonomy/delta.md)`[]` | `agent` |
  | [design](steps/design-step.md) | `{ proposal, deltas }` | [Design](../../taxonomy/design.md) | `agent` |
  | [plan](steps/plan-step.md) | `{ proposal, deltas, design }` | [TaskList](../../taxonomy/task-list.md) | `agent` |
  | [validate](steps/validate-step.md) | [Change](../../taxonomy/change.md) | [ValidationReport](validation-report.md) | `tool` |
  | [approve](steps/approve-step.md) | `{ change, report }` | [Approval](approval.md) | `principal` |
  | [execute](steps/execute-step.md) | an approved [Change](../../taxonomy/change.md) | [ChangeOutcome](../loops/change-outcome.md) | `loop` |
  | [archive](steps/archive-step.md) | `{ change, outcome }` | [ArchiveResult](archive-result.md) | `tool` |

- Completing steps moves the change through its [ChangeState](change-state.md).

## Example

`validate` is `Step<Change, ValidationReport>` with actor `"tool"`: `openspec validate <id> --strict` reading a change and reporting its issues.

## Spec

- `openspec/process`: A step has a named input, output and actor
- `openspec/model`: Every model type has a static type and a JSON Schema
