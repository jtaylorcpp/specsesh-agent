## Why

Our task loops converge when a task is one small, checkable step, and struggle when it isn't. Task 2.2 of iterate-by-default needed a bug fix and a rerun. Add-group-loop 4.4 exhausted its budget on a task that bundled code and tests. Our changes are also large by habit. The archived changes average about 40 requirements and 23 tasks; `add-actors-and-workspaces` has 8 capabilities, 82 scenarios and 25 tasks. The two that went smoothly were small: `bound-step-results` (5 requirements, 7 tasks) and `switch-ontology-to-typebox` (8 requirements, 12 tasks).

The spec agent has to push users toward small changes and single-action tasks, which means "small" needs a definition a tool can check, not a judgement call. This change gives it one: a size budget and pure rules that report every overrun as a validation issue, with a suggested split.

## What Changes

- **`SizeBudget`** with defaults (`DEFAULT_SIZE_BUDGET`):

  | Limit | Default |
  |---|---|
  | capabilities | 2 |
  | requirements | 6 |
  | scenarios | 16 |
  | groups | 4 |
  | tasks | 12 |
  | files per task | 1 |
  | characters per task | 240 |
  | scenarios per test task | 4 |

- **`changeSize(change)`** counts capabilities, requirements, scenarios, groups and tasks.
- **`sizeIssues(change, budget?)`** reports one `WARNING` per exceeded limit, naming the count and the limit. Too many capabilities suggests one change per capability; too many tasks suggests one change per group.
- **`proposalSizeIssues(proposal, budget?)`** checks the capability count before any delta exists, so the agent can propose a split at the first stage.
- **`taskIssues(task, budget?)`**: a task names at most one file, is one line, fits the character limit, and claims at most four scenarios.
- All are pure functions in `./openspec`, returning `ValidationReport` issues, so strict validation fails on them just as it does on OpenSpec's own warnings.

## Out of scope

- Running the rules from a CLI or a check: the spec agent's stages (`add-spec-loop` and after) call them.
- Re-sizing the three open changes. They predate the budget and stay as written.
- Judging whether a task is "one action" from its wording. Only file count, line count, length and claimed scenarios are checked.

## Capabilities

- **New:** `openspec/size`.

## Impact

- `packages/agent/src/openspec/size.ts` (new), exported from `./openspec`; tests; two docs concept pages and the docs index.
- Independent of every other open change.
