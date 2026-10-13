## Why

The last stage turns approved deltas into `tasks.md`. Our loops execute tasks one at a time, and they converge when a task is a single action on a single file that a check can confirm. The principal wants tasks to be small, single-action items, so this stage's gate holds every task to that:
- one file, one line, in 240 characters or less;
- a test task covers at most four scenarios;
- every scenario of the change is named by some task, so nothing in the spec goes unbuilt.

With this stage, the spec agent covers the whole flow, from intent to a change `pnpm task` can execute.

## What Changes

- **`tasksStage`** (`./task`):
  - owns `tasks.md`, and follows `specs`;
  - its bundled script is `spec-plan.agent`;
  - it seeds `approved` with the proposal, the design and the deltas, and `base` with the repository's tracked file paths, so tasks name real files.
- **The gate:**
  - `tasks.md` reads as an ontology `TaskList`, with no task ticked and each task passing `taskIssues`;
  - every ADDED and MODIFIED scenario is named, in double quotes, by some task;
  - the groups and tasks limits from `openspec/size`.
- **`SPEC_STAGES`** becomes `[proposalStage, designStage, specsStage, tasksStage]`.
- **A guide**, `guides/09-spec-agent.md`: the four stages, approving and revising, slicing, and the rules each gate holds.

## Out of scope

- A live run through all four stages. It's parked as a follow-up.
- Ordering tasks by dependency. The script is told to order them, but the gate doesn't check it.

## Capabilities

- **Modified:** `spec/stages`.

## Impact

- New: `packages/agent/src/task/stages/tasks-gate.ts`, `stages/tasks.ts`, `src/task/scripts/spec-plan.agent`, `guides/09-spec-agent.md`.
- Depends on `add-spec-specify-stage`, archived first.
