## Why

The group loop drives one task group to green. Each task runs in its own task loop, and a judge agent reworks whichever task broke the group check. Executing a whole change still means running `--next-group` once per group and watching for the end. The principal wants one command that builds the change, with agents managing each chunk of tasks. The ontology already defines that loop: the change loop runs its group loops in order, then a change check, and returns `LoopOutcome<ChangeOutcome>`. Nothing implements it yet. This change does; the command follows in `add-build-cli`.

## What Changes

- **`agentscript.change-loop`**, one durable task with phases `next`, `group` and `check`:
  - every group in `tasks.md` runs in order as an `agentscript.group-loop` child, with its own task loops and judge. A group that is already ticked starts no task loop, but its group check still runs;
  - a blocked group blocks the change, with the escalation raised to level `change`;
  - a group that fails or runs out of budget ends the change `failed`, and later groups don't run;
  - after the last group, `changeChecks` (default: the `checks`) run once over the workspace.
- **A guard before anything runs.** The change must pass strict validation and, when `approvals.json` exists, every stage must be approved with its files unchanged. Scenarios no task names are reported in the outcome's `unclaimed`, not refused.
- **`answerChangeEscalation`** hands an answer to the blocked group and continues with the groups after it.
- **`startChangeLoop`, `waitForChangeLoop`, `answerChangeEscalation`, `changeLoopExtensions` and `ChangeLoopOptions`** in `./task`.

## Out of scope

- The `build` command: `add-build-cli`.
- A change judge that reopens a group, or adds tasks for a scenario no task names. A failing change check ends the change `failed`.
- Running groups in parallel.
- JSON Lines events for change loops.

## Capabilities

- **New:** `task/change`.

## Impact

- New: `packages/agent/src/task/change-input.ts`, `change-guard.ts`, `change-loop.ts`, `change-api.ts`; tests with the faux provider and staged checks, like the group loop's.
- Depends on `add-spec-review` for `approvals.json` and `add-spec-plan-stage` for `withClaims`, archived first. It comes after `add-draft-cli` in the queue so that `add-build-cli` can follow it.
