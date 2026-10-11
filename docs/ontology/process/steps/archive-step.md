---
id: archive-step
name: archive
kind: step
area: process
spec:
  - "openspec/process: Archive folds a converged change, guarded"
  - "openspec/process: Failure kinds mean distinct things"
  - "openspec/process: Archiving needs convergence and a fresh valid report"
related: [step, change, change-outcome, loop-outcome, archive-result, validation-report, validate-step, execute-step, change-state, step-failure]
status: modelled
---

# archive

A tool folds a converged change's deltas into the specs and moves the change to the archive, behind a guard.

## Definition

```
archive: Step<{ change: Change, outcome: LoopOutcome<ChangeOutcome> }, ArchiveResult>, actor "tool"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ change: Change, outcome: LoopOutcome<ChangeOutcome> }` | The [Change](../../../taxonomy/change.md) and the [LoopOutcome](../../loops/loop-outcome.md) of its execution, as [execute](execute-step.md) returned it. |
| **Output** | [ArchiveResult](../archive-result.md) | Where it was archived, the totals, and the capabilities updated. |
| **Actor** | `"tool"` | |

## Invariants

- The outcome's `status` MUST be `"converged"`. An outcome with `status` `"exhausted"` fails with `kind` `"refused"`.
- A change whose latest `ValidationReport` has `valid` `false` fails with `kind` `"refused"`.
- `converged → archived` needs a report with `valid` `true` produced after convergence.

## Relations

- Follows [execute](execute-step.md), guarded by a fresh report from [validate](validate-step.md).
- A refusal is a [StepFailure](../step-failure.md) of kind `"refused"`.
- Drives `converged → archived` in [ChangeState](../change-state.md).

## Example

`pnpm spec:archive <id>` is this guard in practice: it runs `openspec validate <id> --strict` and refuses to archive unless it passes. That matters because OpenSpec 1.14.1's own `archive --yes` archives an invalid change with exit 0. Archiving `baseline-agentscript-durable` returned `{ archivedAs: "2026-10-11-baseline-agentscript-durable", totals: { added: 140, modified: 0, removed: 0, renamed: 0 }, specsUpdated }` with nine paths.

## Spec

- `openspec/process`: Archive folds a converged change, guarded
- `openspec/process`: Failure kinds mean distinct things
- `openspec/process`: Archiving needs convergence and a fresh valid report
