Depends on `package-specsesh-agent`, `add-openspec-ontology` and `add-agentscript-actions`: implement after all three are archived.

## 1. Inputs and sources

- [ ] 1.1 `packages/agent/src/task/options.ts`: `TaskLoopOptions`, `Source`, defaults (budget 3, escalateTo `"principal"`, empty checks and allow, bundled `task.agent`)
- [ ] 1.2 `packages/agent/src/task/sources.ts`: read every `Source` once at start into text; refuse an unreadable path naming it; resolve `{ dir }` to proposal.md, optional design.md, `specs/**/spec.md` (capability path = directory under `specs/`, sorted) and tasks.md; refuse a missing proposal.md, tasks.md or delta naming the path
- [ ] 1.3 `packages/agent/src/task/tasks-md.ts`: find a task line `- [ ] <id> <text>` / `- [x] <id> <text>`; refuse an unknown id listing every id in the file; `task_text` without checkbox and id
- [ ] 1.4 `packages/agent/src/task/deltas.ts`: concatenate deltas, each preceded by `## <capability path>`, separated by one blank line

## 2. Script contract

- [ ] 2.1 `packages/agent/src/task/contract.ts`: the seeded and read-back variable tables; check a script's declarations (name and type), naming each missing or mistyped variable and its expected type
- [ ] 2.2 `packages/agent/src/task/start.ts`: run the contract check together with the actions binding check from `add-agentscript-actions`, before any task is created or any model is called

## 3. The loop task and judge mapping

- [ ] 3.1 `packages/agent/src/task/loop.ts`: pi-durable task `agentscript.task-loop` v1 with phases `iterate` (start an `agentscript.run` child, variables seeded, entry = subagents in source order), `await` (idempotent by child id) and `judge`
- [ ] 3.2 `packages/agent/src/task/judge.ts`: every mapping row: run not completed or kind ≠ completed → `failed` + `environment` finding; met → `converged`; retry with budget → next iteration with `carried = unmet`; retry without budget → `exhausted`; ask → `blocked` with `Escalation { level: "task", to: escalateTo, reason: unmet, question }`; amend-spec → the same plus a `spec-defect` finding; any other `next_action` → `failed` naming the value
- [ ] 3.3 `packages/agent/src/task/iteration.ts`: record each `Iteration` (`n`, `plan` from the run's `plan` variable or `""`, the host actions' `Action`s and `Evidence`, `verdict` from met/unmet, `feedback` from `next_action`)
- [ ] 3.4 `packages/agent/src/task/index.ts`: `startTaskLoop`, `waitForTaskLoop`, `waitForTaskLoopResult`, `TaskLoop` and `taskLoopExtensions`, exports; result `{ task, ticked }` present exactly when converged, escalation exactly when blocked; the outcome checked with the ontology's `LoopOutcome(TaskOutcome)`

## 4. Ticking

- [ ] 4.1 `packages/agent/src/task/tick.ts`: on convergence with tasks.md from a path, change only `- [ ] <id>` to `- [x] <id>`; no write for text input, an already-ticked line or a missing line, with `ticked: false` and a note; never untick

## 5. Escalation answer

- [ ] 5.1 `packages/agent/src/task/answer.ts`: `answerEscalation` accepts only a blocked loop and only `by === escalation.to`, else rejects as invalid input; resumes as a new run with `carried = decision`, keeping earlier iterations

## 6. Bundled scripts

- [ ] 6.1 Move `openspec/changes/add-task-agent/task.agent` and `task-delegate.agent` to `packages/agent/src/task/scripts/`, copy them into `dist/task/scripts/` in `pnpm build` (so `files` stays `dist`), point `__tests__/core/helpers/actions.ts` at the new location, and resolve the default script from the installed package

## 7. CLI

- [ ] 7.1 `packages/agent/src/bin/agentscript-task.ts`: `run <change-dir> <task-id>`, `resume <loop-id>`, `answer <loop-id>`; usage and exit 2 cases; flag mapping (`--script`, `--workspace` default cwd, repeatable `--check`/`--allow`, `--max-iterations`, `--escalate-to`, `--db`); malformed flag values exit 2
- [ ] 7.2 Provider and model resolution as `agentscript-durable` (flag, env, `anthropic`/`claude-haiku-4-5`), unknown model exits 2 before a task exists; a refused start exits 2; the loop-id resume hint on stderr before any model call
- [ ] 7.3 Text and `--json` output; exit 0 converged, 1 blocked/exhausted/failed; harness closed in every path
- [ ] 7.4 Add the `agentscript-task` bin and the `./task` entry to `packages/agent/package.json`; list both in `packages/agent/README.md`
- [ ] 7.5 `packages/agent/__tests__/package/{manifest,layers,build,pack}.test.ts`: every scenario of the `package/distribution` deltas (eight entries, three bins, `src/task/` layer, bundled scripts in `dist/`, the installed task bin's usage)

## 8. Tests (one per scenario, named `Scenario: <exact name>`)

- [ ] 8.1 `packages/agent/__tests__/task/sources.test.ts`: every scenario of the options, defaults, change-directory, sources and task-lookup requirements (incl. task `2.4` and unknown `9.9` against a fixture copy of the archived `baseline-agentscript-durable` change)
- [ ] 8.2 `packages/agent/__tests__/task/contract.test.ts`: deltas concatenation, seeded and read-back variables, both contract refusals, bundled scripts lint clean and pass the contract
- [ ] 8.3 `packages/agent/__tests__/task/loop.test.ts`: every judge row, budget default and exhaustion, carried feedback, iteration recording, crash during `await` starts no second run, outcome shape — on the faux provider
- [ ] 8.4 `packages/agent/__tests__/task/tick.test.ts`: only the task's line changes, text never written, missing line not written, never unticks
- [ ] 8.5 `packages/agent/__tests__/task/answer.test.ts`: wrong recipient rejected, principal's answer resumes with earlier iterations kept
- [ ] 8.6 `packages/agent/__tests__/task/e2e.test.ts`: end to end — the bundled `task.agent` on the faux provider against a temp workspace and a temp change directory: iteration 1 edits a file and its check fails, iteration 2 fixes it and converges, and tasks.md is ticked
- [ ] 8.7 `packages/agent/__tests__/task/cli.test.ts`: every scenario of `task/cli`

## 9. Close

- [ ] 9.1 `pnpm test`, `pnpm check` and `pnpm pack:check` pass; `pnpm docs:check` passes after linking `docs/ontology/loops/task-loop.md` to the implementation and setting its `status` to `implemented`
- [ ] 9.2 `pnpm spec:archive add-task-agent`, then `pnpm spec:check`
