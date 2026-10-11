## Why

`pnpm task <change> <task-id>` works one task. A task group, a top-level number in `tasks.md` with its `2.1`, `2.2`, `2.3`, is a feature set, and the ontology already says what driving one means: the **group loop**. It runs its task loops in order, then a group check that the feature set holds together and nothing earlier regressed, with feedback that can reopen a task. Today that is done by hand, one `pnpm task` per task, with nobody checking the whole suite afterwards. This change makes the group loop runnable, so one command carries a whole group to green.

## What Changes

- **A durable group loop** (`agentscript.group-loop`, in `@specsesh/agent/task`). It takes a change and a group number, with the same sources, script, workspace, checks, allowlist and model options as the task loop.
  - **Order.** It runs one task loop per task, in file order, as durable child tasks.
  - **Ticked tasks are skipped** as already converged, so a re-run continues where it stopped.
  - **The group check.** After the last task it runs the configured checks once more over the whole workspace. Passing means every check exits `0`.
- **Its outcome is the ontology's `LoopOutcome<GroupOutcome>`:**
  - **`converged`:** every task converged and the group check passed.
  - **`blocked`:** a task loop blocked (its escalation is carried up, level `group`), or the group judge asks or finds the spec wrong.
  - **`exhausted`:** the group check still fails when the rework budget is spent.
  - **`failed`:** a task loop failed or exhausted, or a run broke its contract.
- **Rework.** When the group check fails, a **group judge** decides what to do. It is an Agent Script, `group.agent`, bundled and tunable like `task.agent`, which sees the group, its tasks and the check output, and answers:
  - **`rework`** with a task id: that task's loop runs again with the check output carried in (the ontology's `rework-task`), then the group check repeats;
  - **`ask`** or **`amend-spec`:** blocked, with an escalation.

  The rework budget defaults to 2. A reworked task appears once in the outcome, with `runs` counting its runs.
- **The CLI.** `pnpm task <change> <group>`, where a bare number with no dot names a group, runs the group loop. `--next-group` picks the first group with an unticked task. `--worktree`, `--db`, events, the clean-tree guard, the lock, `status`, `resume` and `answer` all work for groups as they do for tasks. A group in worktree mode uses one worktree and branch, `task/<change-id>/<group>`.
- **Events:**
  - `group-started`, and `group-check` (with each command's exit code);
  - `rework` (the task and why);
  - `group-ended` (status and per-task runs);
  - around each task loop, the existing task events, tagged with the group.

## Out of scope

- The change loop: all groups, then archive.
- Running a group's tasks in parallel. They run in order, as the ontology says, because later tasks build on earlier ones.
- Per-scenario evidence targets (still the task judge's verdict plus checks, as in the task loop).

## Capabilities

- **New:** `task/group` (the group loop, the group judge contract, rework, its outcome).
- **Modified:** `task/cli` (a group argument, `--next-group`, group events, group status and resume) and `package/distribution` (the bundled `group.agent`).

## Impact

- `packages/agent/src/task/group*.ts`, `src/task/scripts/group.agent`, the CLI, tests (faux and fake `claude` only), and `pnpm test:live` gaining a two-task group fixture.
- The first change this repo can run on itself with `pnpm task`. Tasks can be executed one at a time with the existing task runner while the group runner is built.
