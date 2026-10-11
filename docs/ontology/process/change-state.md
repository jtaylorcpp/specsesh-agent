---
id: change-state
name: ChangeState
kind: state-machine
area: process
spec:
  - "openspec/process: A change moves through a fixed sequence of states"
  - "openspec/process: Each forward transition follows its step"
  - "openspec/process: Execution needs approval"
  - "openspec/process: Archiving needs convergence and a fresh valid report"
  - "openspec/process: A spec defect sends the change back through amendment"
  - "openspec/process: Any change may be abandoned"
related: [change, validation-report, approval, change-outcome, loop-outcome, propose-step, finding, specify-step, design-step, plan-step, validate-step, approve-step, execute-step, archive-step]
status: implemented
---

# ChangeState

The state machine a change moves through, from drafting to archived, with a guard on every transition.

## Definition

```
ChangeState = "drafting" | "specified" | "designed" | "planned" | "validated" | "approved"
            | "executing" | "converged" | "archived" | "amended" | "abandoned"
```

```
drafting → specified → designed → planned → validated → approved → executing → converged → archived
                                               ↑                        │
                                               └──── amended ◄──────────┘   (a spec-defect finding)

any state except archived ──→ abandoned          archived, abandoned: terminal
```

**Transitions.** Any transition not in this table MUST be refused.

| From | To | Guard |
|---|---|---|
| `drafting` | `specified` | follows [specify](steps/specify-step.md) |
| `specified` | `designed` | follows [design](steps/design-step.md) |
| `designed` | `planned` | follows [plan](steps/plan-step.md) |
| `planned` | `validated` | a [ValidationReport](validation-report.md) with `valid` `true` |
| `validated` | `approved` | an [Approval](approval.md) with `approved` `true` from the principal |
| `approved` | `executing` | [execute](steps/execute-step.md) starting |
| `executing` | `converged` | a [LoopOutcome](../loops/loop-outcome.md)`<ChangeOutcome>` with `status` `"converged"` |
| `converged` | `archived` | a `ValidationReport` with `valid` `true`, produced after convergence |
| `executing` | `amended` | the change loop ends on a `spec-defect` finding |
| `amended` | `validated` | the amended deltas validate |
| any except `archived` | `abandoned` | none |

## Invariants

- `drafting` is the initial state: the first `Proposal` from [propose](steps/propose-step.md) creates the change in it, and no transition leads into it.
- The forward path SHALL be drafting → specified → designed → planned → validated → approved → executing → converged → archived.
- A change MUST NOT enter `executing` from any state other than `approved`.
- A valid report produced before execution does not license `converged → archived`.
- From `amended`, the change returns to `validated` only once the amended deltas validate, and to `approved` only with a new `Approval`.
- `archived` and `abandoned` are terminal: no transition leaves them.

## Relations

- The `state` field of a [Change](../../taxonomy/change.md).
- Forward transitions follow the lifecycle [steps](step.md); the guards read a [ValidationReport](validation-report.md), an [Approval](approval.md) and the change loop's [LoopOutcome](../loops/loop-outcome.md).
- `amended` is entered on a `spec-defect` [Finding](../evidence/finding.md).

## Example

- **Refused transitions:**
  - `designed → validated` is refused: planning was skipped.
  - `validated → executing` is refused: there is no approval.
  - `archived → abandoned` is refused: `archived` is terminal.
- **The amended path, 2026-10-11:** tests written for `baseline-agentscript-durable` showed two requirements described the code wrongly. That is a `spec-defect`, which sends the change from `executing` to `amended`. Once the corrected deltas validated, it returned to `validated` and needed a new approval.

## Spec

- `openspec/process`: A change moves through a fixed sequence of states
- `openspec/process`: Each forward transition follows its step
- `openspec/process`: Execution needs approval
- `openspec/process`: Archiving needs convergence and a fresh valid report
- `openspec/process`: A spec defect sends the change back through amendment
- `openspec/process`: Any change may be abandoned
