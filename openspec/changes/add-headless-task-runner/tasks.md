> Depends on `add-task-agent`, and through it `add-agentscript-actions` and `add-openspec-ontology`. Implement and archive after all three.

## 1. Before starting

- [ ] 1.1 Once `add-task-agent` and `add-agentscript-actions` are archived, re-check this change's MODIFIED and REMOVED deltas in `specs/task/cli` and `specs/actions/registry` against the archived `openspec/specs/task/cli` and `openspec/specs/actions/registry`: each header verbatim, every base scenario kept. Fix any drift, then `openspec validate add-headless-task-runner --strict` (the "archive would refuse" INFO notes must be gone)

## 2. Config loader and precedence

- [ ] 2.1 `packages/agent/src/task/config.ts`: find `agentscript.config.json` by walking up from the cwd; read only its `task` object; validate every field's type; refuse unknown keys and wrong types (exit `2`, naming the key and the config path)
- [ ] 2.2 `packages/agent/src/task/config.ts`: resolve each value as flag → environment (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`) → config → default; resolve `changesDir`, `db`, a `script` path and `delegateContext` against the config's directory; create the database's parent directory
- [ ] 2.3 `packages/agent/src/task/config.ts`: `script` as a bundled name (`task`, `task-delegate`) or a path; a missing path refuses the run

## 3. Resolving the change and the task

- [ ] 3.1 `packages/agent/src/task/resolve.ts`: change argument as a path (contains a separator, or names an existing directory) or an id under `changesDir`; an unknown id exits `2`, listing open changes (directories other than `archive`)
- [ ] 3.2 `packages/agent/src/task/resolve.ts`: `--next` selects the first `- [ ] <id>` line in file order; none → stdout `no unticked task in <change>`, exit `0`, no loop; a task id together with `--next` → usage, exit `2`

## 4. Headless output

- [ ] 4.1 `packages/agent/src/task/events.ts`: the six event kinds (`loop-started`, `iteration-started`, `action`, `evidence`, `verdict`, `loop-ended`) plus `warning`, one JSON object per stderr line, after the resume hint; `at` as ISO-8601
- [ ] 4.2 `packages/agent/src/task/events.ts`: emit events from the task loop's checkpoints and host action records for `run`, `resume` and `answer`
- [ ] 4.3 `packages/agent/src/bin/agentscript-task.ts`: never read stdin, behave the same without a TTY; the blocked text outcome ends with `agentscript-task answer <loop> --by <to> --decision "…"`

## 5. Clean-tree guard and changed files

- [ ] 5.1 `packages/agent/src/task/git.ts`: `git status --porcelain` before creating the loop; refuse (exit `2`) listing at most 20 paths plus `N more`, unless `--allow-dirty` or `requireCleanTree: false`; outside a git repo skip it with a `warning` event
- [ ] 5.2 `packages/agent/src/task/git.ts`: `loop-ended.changed` = sorted paths whose porcelain entry differs between loop start and end; `[]` outside git
- [ ] 5.3 Audit: no code path in `packages/agent/src/task/` runs a git command that changes git state (only `git status` and `git rev-parse`)

## 6. The delegate, headless

- [ ] 6.1 `packages/agent/src/actions/delegate.ts`: argv adds `--tools Read,Edit,Write,Glob,Grep,Bash`, `--permission-mode dontAsk`, `--output-format json`, `--no-session-persistence`, and `--allowedTools` = the five file tools + `Bash(<word>:*)` per allowlist entry, in order
- [ ] 6.2 `packages/agent/src/actions/delegate.ts`: `--model <delegateModel>` (else the step model); one `--append-system-prompt-file` per context file, resolved against the workspace; a missing context file answers `{ ok: false }` naming it, without spawning; still `--safe-mode`, never `--bare`, `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped, never the OAuth token

## 7. status

- [ ] 7.1 `packages/agent/src/bin/agentscript-task.ts` + `packages/agent/src/task/status.ts`: `status [--db]` lists loops newest first (id, change, task, status, iterations); empty → `no loops in <db>`, exit `0`; usage lists four commands

## 8. Wiring this repo in

- [ ] 8.1 Root `agentscript.config.json` with exactly the values in "This repo ships a config for its own tasks"
- [ ] 8.2 `.gitignore`: add `.agentscript/`
- [ ] 8.3 Root `package.json`: `task` → the built `agentscript-task` bin; `test:live` → the live acceptance run
- [ ] 8.4 `CLAUDE.md`: a "Running a task" section: `pnpm task <change-id> <task-id>`, `--next`, `status`, answering an escalation, the clean-tree guard, and that the runner never commits

## 9. Tests (vitest; fake `claude` binaries and temp git repos only, no live calls)

- [ ] 9.1 `packages/agent/__tests__/task/config.test.ts`: one test per scenario of the config, precedence, path and `script` requirements in `task/headless`, and of "run maps its flags onto the task loop options" and "run resolves provider and model like agentscript-durable" in `task/cli`
- [ ] 9.2 `packages/agent/__tests__/task/resolve.test.ts`: the change id/path and `--next` scenarios, and "run takes a change and a task, with the database from flag or config"
- [ ] 9.3 `packages/agent/__tests__/task/events.test.ts`: the headless, JSON Lines, six-event, `changed` and blocked-output scenarios, driving the CLI against a faux model in a temp git repo
- [ ] 9.4 `packages/agent/__tests__/task/git.test.ts`: the clean-tree guard scenarios (dirty refusal, truncation at 20, `--allow-dirty`, ignored database, outside git) and "A converged loop leaves its work uncommitted"
- [ ] 9.5 `packages/agent/__tests__/actions/delegate.test.ts`: "The delegate never prompts", "The delegate's model and context are configurable" and the modified hard-lines scenario, against a fake `claude` that records its argv and env
- [ ] 9.6 `packages/agent/__tests__/task/status.test.ts`: the `status` and four-command usage scenarios
- [ ] 9.7 `packages/agent/__tests__/repo/config.test.ts`: "The shipped config is valid" and "The database directory is ignored" against the repo's real files
- [ ] 9.8 Every test above is named `Scenario: <exact scenario name>`

## 10. The live acceptance run

- [ ] 10.1 `packages/agent/__tests__/live/task.live.test.ts` + `vitest.live.config.ts` (excluded from the default vitest config): copy the repo to a temp dir, `git init` + commit, add the fixture change `fixture-live-task` (task `1.1` replaces a named stale comment; its check is a vitest file asserting the new text), run `agentscript-task run fixture-live-task 1.1`, assert exit `0`, `loop-ended` converged, `1.1` ticked, only the target file in `changed`
- [ ] 10.2 The live test skips, saying why, when `claude` is missing or not logged in

## 11. Close

- [ ] 11.1 `pnpm -r check`, `pnpm -r test`, `pnpm pack:check`, `pnpm spec:check` and `pnpm docs:check` pass; `pnpm test:live` passes once with `claude` logged in
- [ ] 11.2 `pnpm spec:archive add-headless-task-runner`
