## Why

The bundled task judges see only what the delegate changed in the current iteration (issue #8). `task-delegate.agent` shows `Files the delegate changed: N` with `0 means the delegate changed nothing`, and `task.agent` shows nothing about files at all. Once one iteration has done the work and the checks pass, the next delegate often has nothing left to do and changes 0 files. The judge reads that as "not done", returns `met: false`, and the loop keeps iterating on finished work until its budget runs out. A met verdict is the only way to converge: the gate can veto a "done" but never overrides a "not done".

In a sample of 84 loops with a small judge model, the judge returned `met: false` on 70% of iterations whose checks had passed, and 42% of loop time came after the checks first passed.

A related bug is parked in `openspec/parked.md`: `loop-ended.changed` after `resume` is measured from the resume, not from the loop's start, so edits made before a crash are not listed. Both need the same thing: a durable record of the workspace as it was when the loop started.

## What Changes

- **A baseline per loop.** At its first iteration the task loop snapshots the workspace its gate uses and keeps that snapshot durably, in its checkpoint and its result. A resumed loop keeps it. A run started by answering a blocked loop takes it from the blocked loop. A workspace that cannot snapshot records that it has none.
- **An optional seeded variable, `changed`.** Before every iteration the loop seeds `changed`, one path per line and sorted, with the paths that changed since the baseline. It leaves out the change's `tasks.md` and the paths given as the new `excludeChanged` option. With no baseline it seeds `(unknown)`. Only scripts that declare `changed` are seeded. A script that declares it with a type other than string is refused at start, as other contract variables are. Existing scripts that don't declare it keep the contract.
- **Group task loops.** Each task loop a group starts, whether a first run, a rework or the rerun of an answered block, measures from its own start and gets the group's `excludeChanged`.
- **The bundled judges.** In `task.agent` and `task-delegate.agent`:
  - `changed` is declared.
  - The judge shows `Files changed since the loop started (iteration N):` followed by the list, or `none`.
  - The judge's question asks whether the task is done counting the work of every iteration since the loop started.
  - In `task-delegate.agent`, the per-call count is reworded to `Files the delegate changed in this iteration: N (-1 means unknown). Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.`
  - Orient shows `changed` from iteration 2 on, so the plan knows what is already done.
- **`loop-ended.changed` measured from the loop's start.** The headless runner computes it from the loop's baseline, not from a snapshot it took when the process started waiting, so it is right after `resume` and for answered runs. The CLI passes its database's own files as `excludeChanged`. The parked entry is removed.
- **Docs.** `guides/07-task-loop.md` and CLAUDE.md's "Running a task" list `changed` as an optional seeded variable. They also document that a host may make passing checks sufficient with a trailing logic-only subagent (`if @variables.checks_passed:` / `set @variables.met = True`), and that this makes the configured checks the whole definition of done. The bundled scripts keep the judge.

## Out of scope

- Making passing checks sufficient in the bundled scripts, or in the loop itself.
- The system blocks, step role lines, the plan's framing and the `carried` label in the bundled scripts (`clarify-step-context`), and delegation stdin and `task-delegate.agent`'s `act` step (`loop-supplies-delegate-contract`).
- A new action output such as `files_changed_total`.
- `group-ended.changed` after a group `resume`. It is still measured from the process's start, and is parked.
- `changed` for the group judge (`group.agent`) and the spec loop.

## Capabilities

- **Modified:**
  - `task/agent`;
  - `task/headless`.

## Impact

- **Code:**
  - `packages/agent/src/task/contract.ts`: an optional-seed table.
  - `src/task/loop.ts` and `loop-input.ts`: the baseline in the checkpoint and the result, `excludeChanged`, the seed.
  - `answer.ts`: carries the baseline over.
  - `group.ts`: `excludeChanged` reaches the task loops.
  - `options.ts`.
  - `src/bin/agentscript-task.ts`: `loop-ended.changed` from the baseline, and the database's files as `excludeChanged`.
  - `cmd-build.ts`: passes `excludeChanged` through.
- **Scripts:** `src/task/scripts/task.agent` and `task-delegate.agent`, only the `changed` declaration, the judge's files lines and question, and orient's `changed` lines.
- **Docs:** `guides/07-task-loop.md`, `CLAUDE.md`, `openspec/parked.md`.
- **Durable state:** the `agentscript.task-loop` version stays 1. The new checkpoint and result fields are optional. A loop stored before this change takes its baseline at its next iteration.
