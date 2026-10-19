## 1. The baseline and the `changed` seed

- [ ] 1.1 `packages/agent/src/task/contract.ts`: add `OPTIONAL_SEEDED` (`changed: "string"`, `delete_granted: "boolean"`). `contractProblems` reports an optional seed that is declared with the wrong type as `<name> is declared <type>; the contract needs <type>`, and says nothing when it is not declared. Fold `start.ts`'s `delete_granted` type check into it, keeping its message `delete_granted is declared <type>; the loop seeds it as boolean`. Tests in `__tests__/task/`: "Scenario: A script without changed keeps the contract" and "Scenario: A mistyped changed is refused". The existing `delete_granted` and contract tests still pass
- [ ] 1.2 `src/task/loop.ts`, `loop-input.ts`, `options.ts`: the baseline, as `design.md` Decision 3 sets out.
  - Add `since?: Record<string, string> | null` on every `LoopCheckpoint` phase and on `TaskLoopResult`; `since?` and `excludeChanged?: string[]` on `TaskLoopInput`; `excludeChanged?` on `TaskLoopOptions`, copied by `prepareTaskLoop`.
  - The `iterate` phase snapshots `loopWorkspace(input, bound)`. The gate already has `bound`, so make `iterate` a factory like `gatePhase` and bind it in `boundTaskLoopTask` too.
  - The baseline is `checkpoint.since ?? input.since ?? <this snapshot>`, committed with the child creation. `null` means the workspace cannot snapshot (no `snapshot`, `undefined`, or a throw).
  - Seed `changed` through `seededVariables`: `changedBetween(baseline, now)` minus `tasksPath` (relative to the workspace's root) and `excludeChanged`, joined with `\n`, or `(unknown)` when the baseline is `null`.
  - Every terminal `result(...)` carries `since`.
  - Tests: "Scenario: The second iteration sees the first iteration's files", "Scenario: Edits made before the loop started are not listed", "Scenario: The tick and excluded paths are not listed", "Scenario: A workspace without snapshots seeds unknown"
- [ ] 1.3 Resume and answers.
  - `src/task/answer.ts`: `answerEscalation` copies the blocked loop's result `since` into the new run's input.
  - A stored loop with no `since` takes one at its next `iterate`.
  - Tests: "Scenario: A resumed loop measures from the loop's start" (a child process killed after iteration 1's judge commit, resumed by a fresh harness) and "Scenario: An answered run measures from the blocked loop's start"
- [ ] 1.4 Groups.
  - `src/task/group.ts`: `GroupLoopInput.excludeChanged`, from the group options, reaches each task loop through `taskLoopInputFor`, with no `since`.
  - `src/task/cmd-build.ts` / the change loop: pass `excludeChanged` on to its groups.
  - Tests in `__tests__/task/`: "Scenario: A later task does not see an earlier task's files" and "Scenario: A reworked task measures from its rerun"

## 2. The bundled scripts

- [ ] 2.1 `src/task/scripts/task-delegate.agent` and `task.agent`. Touch only the `changed` declaration, the judge's files lines and its question sentence, and orient's new `changed` lines. The system blocks, role lines, the `Plan:` line, the `carried` lines and the `act` step belong to the sibling changes.
  - Declare `changed: mutable string = ""` (`description: "seeded: files changed since the loop started, one per line"`).
  - Judge, `task-delegate.agent`: replace the two `act_files` lines with `Files the delegate changed in this iteration: {!@variables.act_files} (-1 means unknown). Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.`
  - Judge, both scripts:
    - add `Files changed since the loop started (iteration {!@variables.iteration}):`, then `{!@variables.changed}`, or `none` when it is `""`;
    - then `The list was taken when this iteration began; (unknown) means the workspace cannot list its changes.`;
    - make the question `Is the task done against the spec deltas, counting the work of every iteration since the loop started?`, keeping `It is done only when the checks pass.` after it.
  - Orient, both scripts, under `iteration > 1` and only when `changed` is not `""`: `Files changed since the loop started:`, then the list, then `Earlier iterations may already have done part of the task; check these files before redoing it.`
  - Update the existing test "Scenario: The judge sees an idle delegate" to the modified scenario.
  - Tests: "Scenario: The judge counts work done in an earlier iteration", "Scenario: task.agent's judge shows none on a fresh loop", "Scenario: The judge asks about the work since the loop started", "Scenario: Orient shows earlier work from iteration 2". "Scenario: Orient asks for a different approach" and "Scenario: The bundled scripts lint clean" still pass
- [ ] 2.2 Checks-sufficient as a host policy: test "Scenario: Passing checks converge a loop whose judge said unmet". Use a test-local copy of `task.agent` with a trailing logic-only `subagent accept` (`if @variables.checks_passed:` / `set @variables.met = True`), a recording port whose judge answers `met: False`, and passing checks. The loop converges through the gate and ticks. The bundled scripts are unchanged by this task

## 3. The headless runner

- [ ] 3.1 `src/bin/agentscript-task.ts`:
  - `run` passes the database's in-repo files (the `bookkeeping` set minus `tasks.md`) as `excludeChanged` to task, group and change loops.
  - `finish` computes `loop-ended.changed` from the loop's result `since` against a fresh snapshot, with the same bookkeeping exclusions. It falls back to the process-start snapshot only when the result has no `since`, and gives `[]` outside git or for a `null` baseline.
  - `GroupWatcher`'s per-child `loop-ended.changed` uses each child's result `since` the same way.
  - Tests in `__tests__/task/`: "Scenario: A database in the repository is not seeded as changed", "Scenario: Only the edited file is listed" (still passes), "Scenario: A resumed loop lists edits made before the crash", "Scenario: An answered run lists the blocked run's edits", "Scenario: A group's task lists only its own files"
- [ ] 3.2 `openspec/parked.md`:
  - remove the entry "`changed` after `resume` is measured from the resume, not the loop's start";
  - under "Headless runner", add: "**`group-ended.changed` after a group `resume` is measured from the resume.** A group has no baseline of its own; its task loops' `loop-ended.changed` are measured from each task loop's start (`judge-sees-loop-changes`)."

## 4. Docs

- [ ] 4.1 `guides/07-task-loop.md`, "Tune the agent":
  - list `changed` in the contract block as an optional seeded variable (`seeded if declared: files changed since the loop started, one per line; "(unknown)" when the workspace cannot snapshot`), and fix "the first seven" to say which are always seeded and which only when declared (`changed`, `delete_granted`);
  - add a short "Make passing checks sufficient" paragraph with the `subagent accept` snippet from `design.md` Decision 6. It says that this makes the configured checks the whole definition of done, that the bundled checks (`pnpm check`, `pnpm test`) are repo-wide and would pass for a task whose tests were never written, and that the bundled scripts keep the judge;
  - in "The event stream", say `loop-ended.changed` is measured from the loop's start, across `resume` and `answer`.
- [ ] 4.2 `CLAUDE.md`, "Running a task": one bullet saying the loop seeds `changed` (files changed since the loop started, kept across `resume` and answers) into scripts that declare it, that the bundled judges show it beside the delegate's per-iteration count, and that a host may make passing checks sufficient with a logic-only subagent, at the cost of making the checks the whole definition of done. Also amend the `loop-ended.changed` line under "Clean tree". `pnpm docs:check` and `pnpm spec:check` pass

## 5. Close

- [ ] 5.1 `pnpm check` and `pnpm test` pass. The change ends with `pnpm change close judge-sees-loop-changes`
