> Depends on `add-task-agent`, and through it `add-agentscript-actions` and `add-openspec-ontology`. Implement and archive after all three.

## 1. Before starting

- [x] 1.1 Once `add-task-agent` and `add-agentscript-actions` are archived, re-check this change's MODIFIED and REMOVED deltas in `specs/task/cli` and `specs/actions/registry` against the archived `openspec/specs/task/cli` and `openspec/specs/actions/registry`: each header verbatim, every base scenario kept. Fix any drift, then `openspec validate add-headless-task-runner --strict` (the "archive would refuse" INFO notes must be gone)

- [x] 1.2 `packages/agent/src/task/{options,loop-input,loop,start}.ts`: `TaskLoopOptions` gains `delegateModel`, `delegateContext` and `worktree`, stored in the loop's input; `taskLoopExtensions` takes `delegateModel` and `delegateContext` and passes them to `builtinActions` (`task/agent` deltas)

## 2. Config loader and precedence

- [x] 2.1 `packages/agent/src/task/config.ts`: find `agentscript.config.json` by walking up from the cwd; read only its `task` object; validate every field's type; refuse unknown keys and wrong types (exit `2`, naming the key and the config path)
- [x] 2.2 `packages/agent/src/task/config.ts`: resolve each value as flag → environment (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`) → config → default; resolve `changesDir`, `db`, a `script` path and `delegateContext` against the config's directory; create the database's parent directory
- [x] 2.3 `packages/agent/src/task/config.ts`: `script` as a bundled name (`task`, `task-delegate`) or a path; a missing path refuses the run

## 3. Resolving the change and the task

- [x] 3.1 `packages/agent/src/task/resolve.ts`: change argument as a path (contains a separator, or names an existing directory) or an id under `changesDir`; an unknown id exits `2`, listing open changes (directories other than `archive`)
- [x] 3.2 `packages/agent/src/task/resolve.ts`: `--next` selects the first `- [ ] <id>` line in file order; none → stdout `no unticked task in <change>`, exit `0`, no loop; a task id together with `--next` → usage, exit `2`

## 4. Headless output

- [x] 4.1 `packages/agent/src/task/events.ts`: the six event kinds (`loop-started`, `iteration-started`, `action`, `evidence`, `verdict`, `loop-ended`) plus `warning`, one JSON object per stderr line, after the resume hint; `at` as ISO-8601
- [x] 4.2 `packages/agent/src/task/events.ts`: emit events from the task loop's checkpoints and host action records for `run`, `resume` and `answer`
- [x] 4.3 `packages/agent/src/bin/agentscript-task.ts`: never read stdin, behave the same without a TTY; the blocked text outcome ends with `agentscript-task answer <loop> --by <to> --decision "…"`

## 5. Clean-tree guard and changed files

- [x] 5.1 `packages/agent/src/task/git.ts`: `git status --porcelain` before creating the loop; refuse (exit `2`) listing at most 20 paths plus `N more`, unless `--allow-dirty` or `requireCleanTree: false`; outside a git repo skip it with a `warning` event
- [x] 5.2 `packages/agent/src/task/git.ts`: `loop-ended.changed` = sorted paths whose porcelain entry differs between loop start and end; `[]` outside git
- [x] 5.3 `packages/agent/src/task/worktree.ts`: `--worktree` / `worktree: true`: path `<worktreeDir>/<change-id>-<task-id>` (default `../<repo-dir-name>-worktrees`), branch `task/<change-id>/<task-id>`; refuse (exit `2`) if the branch or path exists or the change is absent at `HEAD`; `git worktree add -b <branch> <path> HEAD`; run `worktreeSetup` in order (non-zero → exit `1`, naming it, worktree kept); resolve the change and workspace inside the worktree
- [x] 5.4 `packages/agent/src/task/worktree.ts`: in worktree mode the guard checks the worktree; main-tree uncommitted changes emit a `warning` event with their count; the loop records `worktree: { path, branch }`; `resume` uses the path; `status` shows the branch; the outcome prints path, branch, `git -C <path> diff` and `git worktree remove <path>`
- [x] 5.6 `packages/agent/src/bin/agentscript-task.ts`: `run --worktree` requires `--db` on the command line (config `db` ignored in worktree mode; missing → exit `2` before creating anything)
- [x] 5.7 `packages/agent/src/task/lock.ts`: exclusive `<db>.lock` holding the pid for `run` and `resume`; another live holder → exit `2` naming the pid; a dead holder's lock taken over with a `warning` event; released on every exit path
- [x] 5.5 Audit: no code path in `packages/agent/src/task/` runs any git command other than `status`, `rev-parse`, `worktree add` and `worktree list`

## 6. The delegate, headless

- [x] 6.1 `packages/agent/src/durable/builtins.ts`: argv adds `--tools Read,Edit,Write,Glob,Grep,Bash`, `--permission-mode dontAsk`, `--output-format json`, `--no-session-persistence`, and `--allowedTools` = the five file tools + `Bash(<word>:*)` per allowlist entry, in order
- [x] 6.2 `packages/agent/src/durable/builtins.ts`: `--model <delegateModel>` when set (the CLI defaults it to the resolved model); one `--append-system-prompt-file` per context file, resolved against the workspace; a missing context file answers `{ ok: false }` naming it, without spawning; still `--safe-mode`, never `--bare`, `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped, never the OAuth token

## 7. status

- [x] 7.1 `packages/agent/src/bin/agentscript-task.ts` + `packages/agent/src/task/status.ts`: `status [--db]` lists loops newest first (id, change, task, status, iterations); empty → `no loops in <db>`, exit `0`; usage lists four commands

## 8. Wiring this repo in

- [x] 8.1 Root `agentscript.config.json` with exactly the values in "This repo ships a config for its own tasks", plus `worktreeSetup: ["pnpm install --frozen-lockfile --prefer-offline"]`
- [x] 8.2 `.gitignore`: add `.agentscript/`
- [x] 8.3 Root `package.json`: `task` → the built `agentscript-task` bin (through `scripts/task.mjs`, which implies `run` unless the first argument is a command, so `pnpm task status` still works); `test:live` → the live acceptance run
- [x] 8.4 `CLAUDE.md`: a "Running a task" section: `pnpm task <change-id> <task-id>`, `--next`, `--worktree` (and reviewing/removing the worktree it leaves), `status`, answering an escalation, the clean-tree guard, and that the runner never commits

## 9. Tests (vitest; fake `claude` binaries and temp git repos only, no live calls)

- [x] 9.1 `packages/agent/__tests__/task/config.test.ts`: one test per scenario of the config, precedence, path and `script` requirements in `task/headless`, and of "run maps its flags onto the task loop options" and "run resolves provider and model like agentscript-durable" in `task/cli`
- [x] 9.2 `packages/agent/__tests__/task/resolve.test.ts`: the change id/path and `--next` scenarios, and "run takes a change and a task, with the database from flag or config"
- [x] 9.3 `packages/agent/__tests__/task/events.test.ts`: the headless, JSON Lines, six-event, `changed` and blocked-output scenarios, driving the built bin against a fake `claude` (claude-code provider, `task-delegate`) in a temp git repo
- [x] 9.4 `packages/agent/__tests__/task/git.test.ts`: the clean-tree guard scenarios (dirty refusal, truncation at 20, `--allow-dirty`, ignored database, outside git) and "A converged loop leaves its work uncommitted"
- [x] 9.5 `packages/agent/__tests__/durable/actions/delegate.test.ts`: "The delegate never prompts" and "The delegate's model and context are configurable", against a fake `claude` that records its argv; the modified hard-lines scenario keeps its test in `packages/agent/__tests__/durable/actions/registry.test.ts`
- [x] 9.6 `packages/agent/__tests__/task/status.test.ts`: the `status` and four-command usage scenarios
- [x] 9.7 `packages/agent/__tests__/repo/config.test.ts`: "The shipped config is valid" and "The database directory is ignored" against the repo's real files
- [x] 9.9 `packages/agent/__tests__/task/agent-options.test.ts`: "The delegate configuration is stored with the loop"
- [x] 9.10 `packages/agent/__tests__/task/worktree.test.ts` and `packages/agent/__tests__/task/lock.test.ts`: the worktree, parallel and lock scenarios, spawning the built bin against a fake `claude`
- [x] 9.8 Every test above is named `Scenario: <exact scenario name>`

## 10. The live acceptance run

- [ ] 10.1 (written, never run: it needs the principal's subscription; the orchestrator runs it after merge) `packages/agent/__tests__/live/task.live.test.ts` + `vitest.live.config.ts` (excluded from the default vitest config): copy the repo to a temp dir, `git init` + commit, add the fixture change `fixture-live-task` (task `1.1` replaces a named stale comment; its check is a vitest file asserting the new text), run `agentscript-task run fixture-live-task 1.1`, assert exit `0`, `loop-ended` converged, `1.1` ticked, only the target file in `changed`
- [x] 10.2 The live test skips, saying why, when `claude` is missing or not logged in (`packages/agent/__tests__/live/ready.ts`, tested with fake `claude` binaries in `packages/agent/__tests__/task/live-skip.test.ts`)

## 10b. Fixes from the first live run (2026-10-11)

- [x] 10b.1 `agentscript.config.json`: `worktreeSetup` uses `--prefer-offline` (the `/tmp` worktree's pnpm store lacked `undici-types-6.21.0`, and `--offline` refused to fetch it); update the shipped-config test
- [x] 10b.2 `packages/agent/__tests__/live/task.live.test.ts`: spawn the runner `detached` in its own process group, give each run a limit below the test timeout, and kill the group (`process.kill(-pid)`) at the limit and in `afterEach`/`afterAll`; `Scenario: A stalled live run is killed with its children`, proven offline with a fake `claude` that never answers
- [ ] 10b.3 Depends on `bound-step-results` (a typed judge result and the refusal bound); re-run `pnpm test:live` after both land

## 11. Close

- [ ] 11.1 `pnpm -r check`, `pnpm -r test`, `pnpm pack:check`, `pnpm spec:check` and `pnpm docs:check` pass; `pnpm test:live` passes once with `claude` logged in
- [ ] 11.2 `pnpm spec:archive add-headless-task-runner`
