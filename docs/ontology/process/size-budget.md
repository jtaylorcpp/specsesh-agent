---
id: size-budget
name: SizeBudget
kind: type
area: process
spec:
  - "openspec/size: A size budget has fixed limits with defaults"
related: [change-size, validation-report, change, proposal, task]
status: implemented
---

# SizeBudget

The limits that a change and its tasks are checked against.

## Definition

```
SizeBudget { capabilities, requirements, scenarios, groups, tasks, taskFiles, taskChars, testScenarios }   each a positive integer
```

A TypeBox schema in `./openspec` (`packages/agent/src/openspec/size.ts`), next to the other `./openspec` types. `DEFAULT_SIZE_BUDGET` is the frozen default.

## Fields

| Field | Type | Default | What it limits |
|---|---|---|---|
| `capabilities` | integer ≥ 1 | 2 | Distinct capability paths across the proposal and the deltas. |
| `requirements` | integer ≥ 1 | 6 | Deltas in the change, one requirement each. |
| `scenarios` | integer ≥ 1 | 16 | Scenarios in the change's ADDED and MODIFIED deltas. |
| `groups` | integer ≥ 1 | 4 | Groups in the change's tasks.md. |
| `tasks` | integer ≥ 1 | 12 | Tasks across all groups. |
| `taskFiles` | integer ≥ 1 | 1 | Files that one task names. |
| `taskChars` | integer ≥ 1 | 240 | Characters in one task's text. |
| `testScenarios` | integer ≥ 1 | 4 | Scenarios that one test task claims. |

## Invariants

- Every field SHALL be a positive integer, and `DEFAULT_SIZE_BUDGET` SHALL pass the `SizeBudget` check.
- Every size rule (`sizeIssues`, `proposalSizeIssues`, `taskIssues`) SHALL take an optional budget that defaults to `DEFAULT_SIZE_BUDGET`.
- Each overrun SHALL be a `WARNING` issue, so `strictlyValid` fails on any overrun.

## Relations

- Checked against [ChangeSize](change-size.md), which `sizeIssues` reads from a [Change](../../taxonomy/change.md). `proposalSizeIssues` checks a [Proposal](../../taxonomy/proposal.md) and `taskIssues` checks a [Task](../../taxonomy/task.md).
- Overruns are issues in a [ValidationReport](validation-report.md).

## Example

The defaults come from measuring this repository's changes, as recorded in the design of `add-change-size-rules` (columns are capabilities, requirements, scenarios, groups and tasks):

| Change | Size | Outcome |
|---|---|---|
| `bound-step-results` | 1 / 5 / 8 / 3 / 7 | converged cleanly |
| `switch-ontology-to-typebox` | 2 / 8 / 10 / 5 / 12 | converged cleanly |
| `add-group-loop` | 5 / 44 / 65 / 6 / 27 | did not converge cleanly |
| `add-actors-and-workspaces` | 8 / 50 / 82 / 6 / 25 | did not converge cleanly |

The change-level limits are set at about the size of the two changes that converged cleanly, well below the two that did not. `taskFiles` is 1 because every task that converged on its first run named a single source file or a single test file.

The budget is a parameter, so a repo config can raise it later. This change ships only the defaults. To raise one limit, spread the default:

```ts
sizeIssues(change, { ...DEFAULT_SIZE_BUDGET, tasks: 20 });
```

## Spec

- `openspec/size`: A size budget has fixed limits with defaults
