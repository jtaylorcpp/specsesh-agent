## 1. Workspaces list and search

- [x] 1.1 `packages/agent/src/durable/workspace.ts`: optional `list(glob)` and `search(pattern, { glob, limit })` on `Workspace`; a small glob matcher (`*`, `**`, `?`, `{a,b}`) with no new dependency; `searchActions(workspace)` returning `list_files` and `search_files` (kind `"read"`, replay `"safe"`, no `Action` recorded, `cannot list files` / `cannot search files` without support); exported from `src/durable/index.ts`
- [x] 1.2 `packages/agent/src/node/local-workspace.ts`: `list` (`git ls-files -co --exclude-standard -z` in git, a walk without `.git/` outside) and `search` (UTF-8 in JavaScript, NUL-byte files skipped, `limit` default 200)
- [x] 1.3 `packages/agent/src/durable/harness.ts`: `createAgentHarness` adds `searchActions(workspace)` after the built-ins when the workspace has `list` and `search`
- [x] 1.4 `packages/agent/__tests__/durable/workspace-search.test.ts`: `actions/workspace` "A search finds lines in matching files", "An ignored file is not listed", "search_files formats matches" and "Search needs a searchable workspace"; `host/agent-config` "A local workspace gets list_files and search_files" and "A workspace that cannot search gets neither" (6), each named `Scenario: <exact scenario name>`

## 2. Scope, step limits and durable host actions

- [x] 2.1 `packages/agent/src/durable/extension.ts` + `src/durable/actions.ts`: `RunInput.scope` (the binding check refuses an action outside it with `outside this run's scope`) and `RunInput.maxSteps` (the run ends `failed`, category `unknown`, `reached its limit of <n> steps`, before dispatching step `n + 1`)
- [x] 2.2 `packages/agent/src/durable/actions.ts` + `src/durable/extension.ts`: `HostAction.durable { start, finish }`. The `act` phase commits intent `{ replay: "safe" }`, then creates the child and stores `child` (and `before`, the workspace snapshot) in one commit, waits by id on every later entry, and applies `finish`. The `act` checkpoint shape gains `child?` and `before?`.
- [x] 2.3 `packages/agent/__tests__/durable/durable-actions.test.ts` (faux provider only): `durable/run-task` "An action outside the scope is refused", "The third step is never asked", "A durable action's child is created once", plus the modified "A deterministic subagent walks next, act, next" and "The script travels inside the task" still passing (5)

## 3. The agent runner

- [ ] 3.1 `packages/agent/src/durable/agent-runner.ts` (new) + `src/durable/index.ts`:
  - `agentRunner()`, kind `"agent"`, accepting `model`, `script`, `tools` (default `read_file`, `list_files`, `search_files`) and `maxSteps` (default `20`);
  - a durable host action whose `start` builds the child `RunInput` (`entry` every subagent, `variables: { instructions }`, the grant's model, `scope`, `maxSteps`), honouring `maxCalls`;
  - `finish` answers `{ ok, summary, files_changed }`; a child not `completed`, or completing with `ok` false, answers `{ ok: false }`;
  - the record refs `delegate/<name>` and `run:<childId>`, with `DiffEvidence`.
- [ ] 3.2 `packages/agent/src/durable/delegate-scripts.ts` (new): `READ_AGENT` and `EDIT_AGENT` as source strings (the delegate contract: `instructions`; `ok`, `summary`), lint clean; the delegate-contract checker beside the task contract's
- [ ] 3.3 `packages/agent/src/durable/harness.ts`: the two-pass registry, with agent grants validated against the first pass and `models`:
  - unknown model, listing the models;
  - an unknown or `delegate/` tool;
  - a script diagnostic, unsupported construct, out-of-tools action or contract problem.

  The binding check refuses an agent delegate under `reasoning.actions` with `call it with run`.
- [ ] 3.4 `packages/agent/src/node/claude-code-runner.ts` (where `defaultRunners` lives): `defaultRunners` gains `agent: agentRunner()`
- [ ] 3.5 `packages/agent/__tests__/durable/agent-runner-grants.test.ts`: `actions/agent-runner` "The node defaults hold both runners", "A minimal agent grant takes the defaults", "An unknown model is refused, listing the models", "A delegate cannot be given a delegate", "A script that uses a tool it was not granted is refused", "A script without summary is refused", "A reasoning-offered agent delegate is refused" and "The bundled delegate scripts are clean" (8)
- [ ] 3.6 `packages/agent/__tests__/durable/agent-runner-calls.test.ts` (faux provider, real SQLite for the crash case): "A reviewer on another model answers", "An editing delegate's changes are counted", "A child past its step limit fails the call" and "Resume waits for the same child" (4, the last with a crash fixture beside `__tests__/durable/fixtures/`)

## 4. Config and CLI

- [ ] 4.1 `packages/agent/src/task/config.ts` + `src/bin/agentscript-task.ts`:
  - the top-level `models` map, each becoming a model factory through the CLI's provider resolution; `default`, an unknown provider or an unknown key exits `2` naming it;
  - an agent grant's `script` is `read`, `edit`, or a path resolved against the config's directory (missing exits `2`).
- [ ] 4.2 `packages/agent/__tests__/task/config-models.test.ts`: `task/headless` "A named model reaches the harness", "Redefining default is refused" and "A bundled delegate script by name" (3)

## 5. Docs

- [ ] 5.1 `docs/ontology/loops/action.md`: the two runner kinds (process, agent), the durable delegate call, scope and step limits; `pnpm docs:check` passes
- [ ] 5.2 `CLAUDE.md`: "Running a task" shows an agent grant with a named model; the layout notes `src/durable/agent-runner.ts` and `delegate-scripts.ts`

## 6. Verify

- [ ] 6.1 `pnpm -r check`, `pnpm -r test` (twice, stable), `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass
- [ ] 6.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive add-agent-runner`
