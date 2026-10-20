## Context

Issue #8. The delegate action's `files_changed` is the diff of the workspace across one call (`src/durable/delegation.ts`, the `before`/`after` snapshots). `task-delegate.agent`'s judge shows it as:

```
Files the delegate changed: {!@variables.act_files}
0 means the delegate changed nothing; -1 means the count is unknown.
```

`task.agent`'s judge shows no file information at all.

The loop converges only on a met verdict (`judge.ts`): the gate can turn a "done" into "not done" when a check fails, but nothing turns a "not done" into "done". So once iteration *k* has made the change and the checks pass, iteration *k+1*'s delegate usually finds nothing to do and changes 0 files. The judge reads "0 means the delegate changed nothing" as "the task was not done" and returns `met: false`. The loop then spins on finished work until `maxIterations` and ends `exhausted`.

Measured on 84 loops with a small judge model:

- the judge returned `met: false` on **70%** of iterations whose checks had passed;
- **42%** of loop time came after the checks first passed.

A second, parked bug has the same root. The headless runner's `loop-ended.changed` diffs a porcelain snapshot it takes when the process starts waiting (`finish` in `src/bin/agentscript-task.ts`) against one at the end. After `resume`, edits made before the crash are not listed. Nothing durable records the workspace as it was when the loop started.

## Goals / Non-Goals

**Goals:**

- The judge can see what changed since the loop started, not only in this call.
- The bundled wording no longer invites reading 0 as "not done".
- `changed` and `loop-ended.changed` are measured from the loop's original start, through `resume` and through answered escalations.
- Existing user scripts keep passing the contract.

**Non-Goals:**

- Making passing checks sufficient in the bundled scripts or in the loop (see Decision 6).
- Touching the parts of the bundled scripts the sibling changes own:
  - `clarify-step-context`: the system blocks, step role lines, the plan's framing to the judge, and the `carried` label;
  - `loop-supplies-delegate-contract`: `task-delegate.agent`'s `act` step and delegation stdin.
- `group-ended.changed` across a group `resume`.

## Decisions

### 1. A seeded variable, not a new action output

The issue suggests a `files_changed_total` output. We seed a variable instead.

- **The loop already knows when it started; an action does not.** A delegate action is one call. To report a total it would need the loop's baseline handed to it, and the action host has no notion of a loop. `task.agent` has no delegate at all, so an output would not help it.
- **Seeds are where per-iteration loop state already goes** (`iteration`, `carried`, `delete_granted`). A seed is visible to every step, so orient can see it too, not only the steps after an action.
- **No new action signature.** That keeps `actions/delegation` and the sibling `loop-supplies-delegate-contract` untouched.

The variable is `changed`, a string with one repository-relative path per line, sorted, and `""` when nothing changed. A string, not a list, because Agent Script variables here are scalars and every other multi-line seed (`deltas`, `carried`) is a string.

**Timing.** `changed` is seeded before the iteration's run starts, so the judge inside iteration *n* sees what iterations 1..*n-1* changed. It does not see the current iteration's own edits, which `act_files` (delegate) or the act summary cover. The judge's label names the iteration (`Files changed since the loop started (iteration N):`) for that reason, and the bundled script adds one line saying the list was taken when the iteration began.

### 2. An optional seed in the contract

`SEEDED` in `contract.ts` is all-mandatory. Adding `changed` there would refuse every existing user script. Instead, `contract.ts` gets a second table, `OPTIONAL_SEEDED`, with `changed: "string"` and `delete_granted: "boolean"`:

- A script that does not declare an optional seed keeps the contract and is not seeded with it.
- A script that declares it with another type gets a `contractProblems` line, `changed is declared number; the contract needs string`, and `startTaskLoop` refuses it as it refuses any contract break. No task is created and no model is called.
- `delete_granted` moves into the same table. Its check in `start.ts` folds into `contractProblems`, keeping its existing message, so its behaviour does not change.
- `seededVariables` seeds an optional variable only when the script declares it, as it does for `delete_granted` today.

### 3. The baseline: a workspace snapshot, taken by the loop, kept durably

**What.** The baseline is `loopWorkspace(input, bound).snapshot()`: the same workspace the gate's checks run in.

- That is the worktree for `--worktree` runs, or the bound `Workspace` for a library host, such as a sandbox workspace.
- The snapshot is the existing `WorkspaceSnapshot` (path → `porcelain:sha256`, dirty paths only), stored as a sorted JSON object.
- `changed` is `changedBetween(baseline, now)` minus the exclusions, the same comparison `loop-ended` already uses. A file that was dirty before the loop and is not touched is not listed. A dirty file the loop edits further is listed, because its hash changes.

**Why a snapshot and not a start commit.** The runner never commits, and with `--allow-dirty` the tree may be dirty at start, so `git diff <start>` would list the principal's own edits. The snapshot comparison is what `loop-ended` and `files_changed` already mean by "changed". Its size is the number of dirty paths at start, which the clean-tree guard keeps at zero by default.

**When.** The baseline is taken in the loop's first `iterate` phase, when neither the checkpoint nor the input holds one. It is committed with that phase's child creation, in the same commit. A crash before that commit retakes it, and nothing has run by then. It is not taken in `startTaskLoop`, because `startTaskLoop` sees only the workspace directory, not a bound `Workspace`. The gate's workspace is resolved inside the task, so the baseline is too.

**How it survives.**

- **Resume.** The baseline lives in the checkpoint (`since`, on every phase), so the resumed task reads the one it stored. The `iterate` phase of a resumed run computes `changed` from it with a fresh snapshot.
- **Answers.** `answerEscalation` starts a *new* task from `{ ...input, carried, earlier }`. The terminal result gains `since` beside `notes`. `answerEscalation` copies it into the new run's input as `TaskLoopInput.since`, and the new run's first `iterate` uses `checkpoint.since ?? input.since` before it takes a fresh one. A chain of answers so measures from the very first run.
- **Old loops.** A checkpoint or result stored before this change has no `since`. The next `iterate` takes one, so the loop measures from then (the principal accepted this, 2026-10-19: it matches how `resume` measured before). The task version stays 1, and both new fields are optional.

**Exclusions.**

- `changed` leaves out the change's `tasks.md` (`input.tasksPath`, made relative to the workspace's root), because other loops tick it.
- It also leaves out every path in a new option, `excludeChanged: string[]` (repository-relative), stored in the input. The loop cannot know where its database lives. The CLI passes the database's files (`<db>`, `-wal`, `-shm`, `.lock`, as `bookkeeping` already computes) when they are inside the repository.
- Group inputs carry `excludeChanged` to their task loops (`taskLoopInputFor`), and the change loop passes it on to its groups.

### 4. A sentinel for a workspace that cannot snapshot

`memoryWorkspace`, a directory outside git, or a bound workspace whose `snapshot()` answers `undefined` has no baseline. The checkpoint then records `since: null`, and `changed` is seeded as the single line `(unknown)`. That string cannot be a repository-relative path that git would list, because a path starting `(` would be listed as is and `(unknown)` with its parentheses is not a plausible file. It also reads plainly in a prompt. The bundled judge says `(unknown) means the workspace cannot list its changes.` The delegate's `-1` stays as it is: `files_changed` is a number, and the sentinel there was already `-1`.

A snapshot that throws, for example git failing mid-loop, is treated as `undefined` for that iteration: `(unknown)`. It is not a loop failure, since the seed is advisory.

### 5. Group task loops measure from their own start

A group starts each task loop with `earlier: []`. That covers a first run, a rework, and the rerun of a blocked task after the group is answered. Each such task loop takes its own baseline. So task `1.2` does not see `1.1`'s files as its own, and a reworked task sees what its rerun changed. A rerun after a group answer does **not** inherit the blocked task loop's baseline. The group answer reruns the task as a fresh loop with fresh iterations, unlike `answerEscalation` on a task loop, so measuring from its start matches what its iterations count.

`loop-ended.changed` for a group's task is computed the same way, from that task loop's result `since`, instead of from when the watcher first saw the child. `group-ended.changed` stays measured from the group process's start and is parked: the group has no baseline of its own, and adding one is a separate change.

### 6. Checks-sufficient stays a documented host policy

The issue also suggests making passing checks sufficient. We document it and don't ship it:

- **The bundled checks are repo-wide.** They are `pnpm check` and `pnpm test`, not the task's scenarios. A task whose tests were never written still passes them, because the existing suite is green. Treating "checks pass" as "task done" would converge tasks that did nothing.
- **The judge is what reads the task text and the deltas.** With `changed` and the reworded count, the judge has the information the issue showed it lacked.
- **A host whose checks are the task** (scenario-scoped tests, a CI test picker) can opt in with a logic-only subagent after `judge`:

  ```
  subagent accept:
      description: "Passing checks are enough, without the model"

      reasoning:
          instructions: ->
              if @variables.checks_passed:
                  set @variables.met = True
  ```

  The docs say plainly that this makes the configured checks the whole definition of done. A test pins that the snippet converges a loop whose judge said `met: false`. The gate still runs the checks again before converging.

### 7. Bundled wording

Only these lines change, in both scripts' `judge` and `orient`. The rest belongs to the sibling changes.

- **Variables.**
  - Add `changed: mutable string = ""`, `description: "seeded: files changed since the loop started, one per line"`.
- **Judge, `task-delegate.agent`.** Replace the two `act_files` lines with:
  - `Files the delegate changed in this iteration: {!@variables.act_files} (-1 means unknown). Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.`
- **Judge, both scripts.**
  - Add `Files changed since the loop started (iteration {!@variables.iteration}):`, then `{!@variables.changed}` or `none` when it is `""`.
  - Then `The list was taken when this iteration began; (unknown) means the workspace cannot list its changes.`
  - The question becomes `Is the task done against the spec deltas, counting the work of every iteration since the loop started?` Its following sentence, `It is done only when the checks pass.`, stays, so `The bundled task judges iterate first` still holds.
- **Orient, both scripts.** Under `if @variables.iteration > 1:` and when `changed` is not `""`:
  - `Files changed since the loop started:`, then the list;
  - then `Earlier iterations may already have done part of the task; check these files before redoing it.`
  - Iteration 1 of a fresh loop shows nothing new. An answered run's first iteration has `iteration > 1`, so it shows the blocked run's files.

## Risks / Trade-offs

- **The judge still sees only the paths, not their content.** A judge that wants to verify needs the delegate's summary and the check output, as today. Paths are enough to break the "0 means nothing was done" reading. A diff would bloat every judge prompt.
- **One snapshot per iteration.** This is a `git status` plus a hash of each dirty file, the cost `files_changed` already pays per delegate call.
- **The baseline is taken at the first iteration, not at `run`.** Anything between creation and the first phase is not the loop's. In the CLI nothing runs then: worktree setup happens before creation, and its output is ignored files.
- **Sibling overlap.**
  - `clarify-step-context` edits the same judge and orient steps, in other lines.
  - `loop-supplies-delegate-contract` edits `act`.
  - Merge conflicts are textual and local. The requirement this change modifies (`The delegate script shows the judge what changed and changes approach`) pins only the files-changed text and orient's "different approach" line.

## Migration Plan

No migration. The new checkpoint, result and input fields are optional, and a stored loop without them takes a baseline at its next `iterate`. User scripts need no change. Declaring `changed` opts in.

## Decided

- `group-ended.changed` keeps measuring from the group process's start; a group baseline is parked (task 3.2).
- The group judge (`group.agent`) is not seeded `changed`.
- Old loops take their baseline at their next `iterate` (above).
