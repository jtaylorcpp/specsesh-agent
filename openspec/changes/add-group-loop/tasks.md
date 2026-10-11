## 1. The group-loop task and its phases

- [x] 1.1 `packages/agent/src/task/group.ts`: `GroupLoopOptions` (task-loop options with `group`, `groupScript`, `budget.maxReworks` default `2`); sources read once into the durable input; group lookup by `## <n>.` heading in `tasks.md` (unknown number refused listing the numbers; no task lines or no `checks` refused)
- [x] 1.2 `packages/agent/src/task/group.ts`: `agentscript.group-loop` v1 with checkpoint `{ phase, queue, entries, reworks, carried?, child? }` and phases `next`, `task`, `check`, `judge`; the queue from unticked tasks in file order, ticked tasks entered as converged with `runs` `0`
- [x] 1.3 `packages/agent/src/task/group.ts`: the `task` phase starts an `agentscript.task-loop` child (rework `carried` passed through), awaits it idempotently by child id, records converged entries (`runs` + 1); blocked → group blocked with the escalation at level `group`; exhausted/failed → group failed naming the task
- [x] 1.4 `packages/agent/src/task/group.ts`: the `check` phase runs each check in the workspace with no shell; all exit `0` → converged; otherwise → `judge` with commands, exit codes and output
- [x] 1.5 `packages/agent/src/openspec/loops.ts`: `GroupOutcome.tasks[].runs` allows `0` (per the modified `openspec/loops` requirement); its tests
- [x] 1.6 `packages/agent/src/task/index.ts`: export `startGroupLoop`, `waitForGroupLoop`, `answerGroupEscalation`, `GroupLoop`, `groupLoopExtensions`, `GroupLoopOptions`

## 2. The group judge

- [x] 2.1 `packages/agent/src/task/group-judge.ts`: seed `group_number`, `group_title`, `tasks`, `proposal`, `deltas`, `check_output`, `rework_count`; read back `next_action`, `rework_task`, `feedback`, `question`; the contract checked at start (missing or mistyped variable refused, naming it)
- [x] 2.2 `packages/agent/src/task/scripts/group.agent`: the bundled judge, copied from `openspec/changes/add-group-loop/group.agent`; the build copies it to `dist/task/scripts/` with the task scripts
- [x] 2.3 `packages/agent/src/task/group.ts`: judge transitions: `rework` of a task in the group within budget → untick its line (path only), queue it, `carried` = check output + feedback, `reworks` + 1; budget spent → exhausted; `ask`/`amend-spec` → blocked (level `group`, `to` = `escalateTo`, `amend-spec` recorded as `spec-defect`); anything else or a task outside the group → failed
- [x] 2.4 `packages/agent/src/task/group.ts`: each check round recorded as an ontology `Iteration` (one `CheckEvidence` per check, target `{ check: "group <n>" }`, one finding and its feedback when unmet); the outcome built as `LoopOutcome<GroupOutcome>` and passed through `check` before it is stored
- [x] 2.5 `packages/agent/src/task/group-answer.ts`: `answerGroupEscalation` (blocked and `by` = `to` only; a task block reruns that task with `carried` = decision; a judge block reruns the check, then the judge with the decision appended to `check_output`)
- [ ] 2.6 `packages/agent/src/task/tick.ts`: `untick(tasksPath, id)` for a group rework, that line only, never from text input; the task loop itself still never unticks (modified `task/agent` requirement)

## 3. The CLI

- [ ] 3.1 `packages/agent/src/bin/agentscript-task.ts`: `run <change> <task-id>|<group>|--next|--next-group` (a bare positive integer is a group; exactly one of the four, else usage and exit `2`); usage line updated
- [ ] 3.2 `packages/agent/src/task/config.ts` + the bin: `groupScript` (bundled `group` or a path; missing path → exit `2`) and `maxReworks` (positive integer) in the config's fixed field set and precedence; `--group-script`, `--max-reworks` (malformed → exit `2`)
- [ ] 3.3 `packages/agent/src/task/resolve.ts`: `--next-group` picks the first group with an unticked task; none → `no unticked task in <change>`, exit `0`
- [ ] 3.4 `packages/agent/src/task/worktree.ts`: a group runs in `<worktreeDir>/<change-id>-<group>` on `task/<change-id>/<group>`, with the task-worktree rules (no reuse, committed change, setup, explicit `--db`, remembered for `resume`/`status`)
- [ ] 3.5 `packages/agent/src/task/events.ts`: `group-started`, `group-check`, `rework`, `group-ended`; task events inside a group carry `group`
- [ ] 3.6 `packages/agent/src/task/status.ts` + the bin: `status` lists group loops as `group <n>` beside task loops; `resume` and `answer` handle group loops; text output for a group (`# group loop`, `## task <id>: <status> (runs <n>)`, `## group check: …`, the answer command when blocked); JSON outcome `LoopOutcome<GroupOutcome>`; exit `0` converged, `1` otherwise

## 4. Tests (vitest; faux provider and fake `claude` only, no live calls)

- [ ] 4.1 `packages/agent/__tests__/task/group.test.ts`: one test per `task/group` scenario, named `Scenario: <exact scenario name>`
- [ ] 4.2 `packages/agent/__tests__/task/group-e2e.test.ts`: a two-task group on the faux provider in a temp workspace: both tasks converge, the group check fails once, the judge reworks `1.1`, its loop converges, the check passes; asserts `converged`, `1.1` at `runs` `2`, `1.2` at `runs` `1`, `1.1` ticked again, and the outcome passing `check`
- [ ] 4.3 `packages/agent/__tests__/task/group-crash.test.ts`: `Scenario: Killed during a task`: kill the process mid-task (exit 137), resume from the same database, no second child loop
- [ ] 4.4 `packages/agent/__tests__/task/cli-group.test.ts`: one test per new and modified `task/cli` and `task/headless` scenario (group positional, `--next-group`, flags, events, worktree, status, resume, answer, text and JSON output, exit codes), via the built bin and a fake `claude`
- [ ] 4.5 `packages/agent/__tests__/openspec/loops.test.ts`: `Scenario: A task ticked before the group loop has no runs`; `packages/agent/__tests__/task/tick.test.ts`: the task loop still never unticks
- [ ] 4.6 `packages/agent/__tests__/task/group-script.test.ts`: `Scenario: The bundled judge script is clean` (no diagnostic, no unsupported construct, no action, contract passes)

## 5. Live

- [ ] 5.1 `packages/agent/__tests__/live/task.live.test.ts`: a second fixture change with a two-task group, run headless on the repo config under the same limit and process-group kill; expect exit `0`, `group-ended` `converged`, both tasks ticked (`Scenario: A live group converges`). Do not run it in `pnpm test`

## 6. Close

- [ ] 6.1 `pnpm -r check`, `pnpm -r test` (twice, stable), `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass; `CLAUDE.md` "Running a task" covers groups
- [ ] 6.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive add-group-loop`
