## Context

`./openspec` already has pure rules over its types: `unclaimedScenarios`, `proposalIssues`, `specifyIssues` and `strictlyValid`. It imports only `typebox`. Size rules sit beside them and return `ValidationReport["issues"]` entries, so a caller merges them with `openspec validate --json` output and applies `strictlyValid` once.

## Where the numbers come from

Measured from this repository's 12 archived changes and 3 open ones (counting `### Requirement` and `#### Scenario` lines in deltas, `- [ ] n.m` lines in tasks.md):

| Change | Capabilities | Requirements | Scenarios | Groups | Tasks |
|---|---|---|---|---|---|
| bound-step-results | 1 | 5 | 8 | 3 | 7 |
| switch-ontology-to-typebox | 2 | 8 | 10 | 5 | 12 |
| add-group-loop | 5 | 44 | 65 | 6 | 27 |
| add-actors-and-workspaces | 8 | 50 | 82 | 6 | 25 |

The budget sits at the size of the two that converged cleanly. One task, one file comes from the tasks that converged first time: each named one source file or one test file.

## The API

```ts
import { DEFAULT_SIZE_BUDGET, changeSize, sizeIssues, proposalSizeIssues, taskIssues, strictlyValid } from "@specsesh/agent/openspec";

changeSize(change);
// { capabilities: 2, requirements: 4, scenarios: 6, groups: 2, tasks: 5 }

sizeIssues(change, { ...DEFAULT_SIZE_BUDGET, tasks: 20 });
// [{ level: "WARNING", path: "tasks.md",
//    message: "27 tasks, over the budget of 20. Split it into one change per group: 1. Model, 2. Loop, 3. CLI" }]

taskIssues(task);
// [{ level: "WARNING", path: "tasks.md#2.1",
//    message: "names 3 files (src/a.ts, src/b.ts, test/a.test.ts); a task changes one file" }]

strictlyValid([...openspecIssues, ...sizeIssues(change), ...tasks.flatMap((t) => taskIssues(t))]);
```

## Counting

- **capabilities:** distinct paths across `proposal.capabilities.new`, `.modified` and every delta's `capability`.
- **requirements:** deltas, one each (ADDED, MODIFIED, REMOVED, RENAMED).
- **scenarios:** scenarios inside ADDED and MODIFIED deltas.
- **groups, tasks:** from `change.tasks`, zero when absent.
- **A test task** is one whose links include a `scenario-named` link. Its claimed scenarios are those links, plus each scenario of a `requirement-named` link's requirement.

## Issue paths

`proposal.md` for capabilities, `specs` for requirements and scenarios, `tasks.md` for groups and tasks, and `tasks.md#<id>` for one task. Paths are relative to the change directory, as `openspec validate` reports them.

## Decisions

- **Warnings, not errors.** Strict validation already fails on a warning, so the agent's gate treats them as blocking. A non-strict caller can still read a large change.
- **The budget is a parameter.** A repo config may raise it later; this change ships only the defaults.
- **A task naming no file passes.** "Run the checks" and "archive" tasks name commands, not files.
