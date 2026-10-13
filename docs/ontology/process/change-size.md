---
id: change-size
name: ChangeSize
kind: type
area: process
spec:
  - "openspec/size: A change's size counts its capabilities, deltas and tasks"
  - "openspec/size: A change over budget is reported per limit, with a split"
  - "openspec/size: A proposal is sized before any delta exists"
  - "openspec/size: A task is one action on one file"
related: [size-budget, validation-report, change, proposal, delta, task, task-list, task-link]
status: implemented
---

# ChangeSize

What a change holds, counted, so that three pure rules can check it and its tasks against a [SizeBudget](size-budget.md).

## Definition

```
ChangeSize { capabilities, requirements, scenarios, groups, tasks }   each an integer ≥ 0

changeSize(change)                  → ChangeSize
sizeIssues(change, budget?)         → ValidationReport["issues"]
proposalSizeIssues(proposal, budget?) → ValidationReport["issues"]
taskIssues(task, budget?)           → ValidationReport["issues"]
```

A TypeBox schema in `./openspec` (`packages/agent/src/openspec/size.ts`). `changeSize` builds it; the three rules return issues in the shape of a [ValidationReport](validation-report.md)'s `issues`.

## Fields

| Field | Type | What it counts |
|---|---|---|
| `capabilities` | integer ≥ 0 | Distinct capability paths across `proposal.capabilities.new`, `proposal.capabilities.modified` and every [Delta](../../taxonomy/delta.md)'s `capability`. |
| `requirements` | integer ≥ 0 | Deltas, one requirement each, whatever the op (ADDED, MODIFIED, REMOVED, RENAMED). |
| `scenarios` | integer ≥ 0 | Scenarios inside ADDED and MODIFIED deltas only. |
| `groups` | integer ≥ 0 | Groups in `change.tasks`; 0 when the change has no task list. |
| `tasks` | integer ≥ 0 | Tasks across those groups; 0 when the change has no task list. |

## Invariants

- `changeSize` and the three rules SHALL be pure: none reads a file.
- Each rule SHALL take an optional budget, defaulting to `DEFAULT_SIZE_BUDGET`, and report each overrun as one `WARNING`. A count exactly at its limit is not an overrun.
- `sizeIssues(change, budget?)` SHALL return one issue per count over its limit, naming the count and the limit. Its path is `proposal.md` for capabilities, `specs` for requirements and scenarios, and `tasks.md` for groups and tasks.
  - Too many capabilities SHALL suggest one change per capability, listing the paths.
  - Too many groups or tasks SHALL suggest one change per group, listing the group titles.
  - Too many requirements or scenarios carries no split suggestion: the spec names none.
- `proposalSizeIssues(proposal, budget?)` SHALL return one issue at `proposal.md` when the distinct `capabilities.new` and `capabilities.modified` paths together exceed `budget.capabilities`, listing them as the changes to split into, and `[]` otherwise. It lets the agent propose a split before any delta exists.
- `taskIssues(task, budget?)` SHALL return one issue at `tasks.md#<id>` per rule the task breaks:
  - more than `taskFiles` files, naming them. The files are the task's `files` plus every path-like token in its text (a `/` and an extension, such as `src/a.ts`). A task naming no file passes this rule;
  - text spanning more than one line;
  - text longer than `taskChars` characters;
  - for a test task (one with a `scenario-named` [TaskLink](../../taxonomy/task-link.md)), more than `testScenarios` claimed scenarios, naming the count and the limit. The implementation counts the distinct `scenario-named` targets.
- The rules do not judge whether a task's wording describes "one action": only its files, lines, length and claimed scenarios are checked.

## Relations

- Counted from a [Change](../../taxonomy/change.md): its [Proposal](../../taxonomy/proposal.md), its [Delta](../../taxonomy/delta.md)s and its [TaskList](../../taxonomy/task-list.md). `taskIssues` checks one [Task](../../taxonomy/task.md).
- Checked against a [SizeBudget](size-budget.md).
- Every issue is a `WARNING` entry of a [ValidationReport](validation-report.md), so it merges with `openspec validate --json` output and goes through `strictlyValid` once. Strict validation fails on a warning, so any overrun blocks.

## Example

The change of the "Counting a change" scenario covers two capabilities, with three ADDED deltas of two scenarios each, one REMOVED delta, and two groups holding five tasks:

```ts
import { DEFAULT_SIZE_BUDGET, changeSize, sizeIssues, proposalSizeIssues, taskIssues, strictlyValid } from "@specsesh/agent/openspec";

changeSize(change);
// { capabilities: 2, requirements: 4, scenarios: 6, groups: 2, tasks: 5 }
```

Each limit exceeded is its own issue. With the budget raised to 20 tasks, a 27-task change in three groups gives:

```ts
sizeIssues(change, { ...DEFAULT_SIZE_BUDGET, tasks: 20 });
// [{ level: "WARNING", path: "tasks.md",
//    message: "27 tasks, over the budget of 20. Split it into one change per group: 1. Model, 2. Loop, 3. CLI" }]
```

- A change over `["task","cli"]`, `["task","group"]` and `["durable","host"]` gets a `proposal.md` issue listing `task/cli`, `task/group` and `durable/host` as the changes to split into. `proposalSizeIssues` reports the same for a proposal with one new and two modified capabilities, before any delta is written.
- A change with 17 scenarios and 13 tasks gets two issues, one naming `17` and `16` (at `specs`), the other `13` and `12` (at `tasks.md`). A change exactly at every default limit gets `[]`.
- Task `2.1`, "`src/a.ts` and `src/b.ts`: rename the export", gets one issue at `tasks.md#2.1` naming both files. A task whose text continues onto indented sub-steps gets one issue saying it spans more than one line. A test task with five `scenario-named` links gets one issue naming `5` and `4`.
- The task `pnpm check and pnpm test pass` names no file and gets `[]`.

A caller merges all of them with OpenSpec's own issues and decides once:

```ts
strictlyValid([...openspecIssues, ...sizeIssues(change), ...tasks.flatMap((t) => taskIssues(t))]);
```

A change with 7 requirements makes `strictlyValid(sizeIssues(change))` `false`.

## Spec

- `openspec/size`: A change's size counts its capabilities, deltas and tasks
- `openspec/size`: A change over budget is reported per limit, with a split
- `openspec/size`: A proposal is sized before any delta exists
- `openspec/size`: A task is one action on one file
