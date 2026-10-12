## 1. Delegation actions (additive: the built-in delegate stays until group 2)

- [ ] 1.1 `packages/agent/src/durable/delegation.ts` (new) + `src/durable/index.ts`: `DelegateGrant`, `DelegateGrants`, `DelegateGrantError`; grant validation (unknown key, wrong type, runner, permissionMode, positive integers, name pattern; nothing built when any grant is invalid) and defaults; `delegationActions(grants, { workspace, claudeBinary? })` returning one `delegate/<name>` action per grant with the fixed inputs and outputs
- [ ] 1.2 `packages/agent/src/durable/delegation.ts`: the `claude-code` runner, with argv, environment, cwd and time limit built from the grant alone. Move `delegateArgs`, `claudeCodeEnv` and `readDelegateResult` here from `src/durable/builtins.ts`. `--allowedTools` gets Bash patterns only when `Bash` is in the grant's tools. Context files are resolved, and a missing one fails without spawning. Stdin carries the instructions plus the terms block from `design.md`. A timeout kills the process and answers `{ ok: false }`.
- [ ] 1.3 `packages/agent/src/durable/workspace-snapshot.ts` (new): move `repoRoot`, `status`, `snapshot` and `changedBetween` here from `src/task/git.ts`, which re-exports them, so the durable layer doesn't import from `task/`. Then `src/durable/delegation.ts` records each call: snapshots before and after, `files_changed`, a `DiffEvidence` (added, deleted or modified), the `Action` with refs `delegate/<name>`, and a `CheckEvidence`. Outside git: `-1` and no `DiffEvidence`.
- [ ] 1.4 `packages/agent/src/durable/delegation.ts` + `src/durable/extension.ts` + `src/durable/actions.ts`: `maxCalls` counted from the run's own reports (its `run` action reports and its steps' tool calls for that action). A call past the limit answers `{ ok: false }` with `reached its limit of <n> calls in this run`, starting nothing.
- [ ] 1.5 `packages/agent/src/durable/actions.ts`: `createActionRegistry` refuses a `delegate/` name that `delegationActions` didn't make (a module-private brand). For an unregistered `mcpTool://delegate/<name>`, `ActionBindingError` adds the granted names, or `no delegates are granted`.
- [ ] 1.6 `packages/agent/__tests__/durable/delegation-grants.test.ts`: tests for `actions/delegation` "One action per grant", "An extra output is refused at start", "A hand-made delegate action is refused", "No grants", "A different grant", "An unused grant is fine", "Another permission mode is refused" and "An unknown runner is refused" (8), each named `Scenario: <exact scenario name>`
- [ ] 1.7 `packages/agent/__tests__/durable/delegation-runner.test.ts` (fake `claude` only): "A minimal grant takes the defaults", "Instructions cannot add a flag", "The argv and environment keep the hard lines", "The allowlist becomes Bash patterns", "An empty allowlist allows no shell", "A missing context file fails the call" and "The terms follow the instructions" (7)
- [ ] 1.8 `packages/agent/__tests__/durable/delegation-records.test.ts` (fake `claude` only): "The call past the limit fails", "A delegate that never finishes is killed", "A change is recorded with its diff", "A delegate that changed nothing says so" and "Outside git the count is unknown" (5)

## 2. The switch (one group, so the next group's run starts on grants: the agent runs on this code)

- [ ] 2.1 `packages/agent/src/task/options.ts`, `src/task/loop-input.ts`, `src/task/loop.ts` (`taskLoopExtensions`, `taskLoopRegistry`), `src/task/start.ts`, `src/task/group.ts`: `delegates?: DelegateGrants` replaces `delegateModel` and `delegateContext` through the options, the durable input and the group input. The registry is the built-ins plus `delegationActions(delegates)`, the same at start and at run.
- [ ] 2.2 `packages/agent/src/task/scripts/task-delegate.agent`:
  - `act` runs an action `claude_code` targeting `mcpTool://delegate/claude_code`, with outputs `ok`, `summary` and `files_changed`, setting `act_ok`, `act_summary` and `act_files` (declared `number`);
  - the judge prompt gains `Files the delegate changed: {!@variables.act_files}`;
  - orient's iteration-2+ block gains the different-approach line from `design.md`;
  - it still lints clean and keeps the contract and the iterate-first judge lines.
- [ ] 2.3 `packages/agent/src/task/config.ts`:
  - read the top-level `delegates`, validated with the grant validator from 1.1; errors name the config path, the grant and the key, and exit `2`;
  - resolve each grant's `context` against the config's directory;
  - remove `delegateModel` and `delegateContext` from the `task` fields and refuse them with `moved: grant a delegate under "delegates" instead`;
  - update `__tests__/task/config.test.ts` for the new field set.
- [ ] 2.4 `packages/agent/src/bin/agentscript-task.ts` + `__tests__/task/cli-helpers.ts`: pass `delegates` to task and group loops (worktree runs rebase grant context paths as they did `delegateContext`). Add `--no-delegates`, which passes none. List `--no-delegates` in the options usage.
- [ ] 2.5 `agentscript.config.json`: drop `delegateModel` and `delegateContext`; add `delegates.claude_code` (`runner` `claude-code`, `model` `opus`, `allow` `["pnpm", "node"]`, `context` `["CLAUDE.md"]`). `packages/agent/__tests__/repo/config.test.ts` pins the modified scenario.
- [ ] 2.6 `packages/agent/src/durable/builtins.ts`: remove `delegate_claude_code`, `delegateModel`, `delegateContext` and `claudeBinary`, leaving four built-ins. Move or delete the tests in `__tests__/durable/actions/delegate.test.ts` and `__tests__/durable/actions/registry.test.ts` that pinned the removed `actions/registry` requirements; the new tests below replace them. Add `Scenario: No delegate is built in` to `registry.test.ts`.

## 3. Tests for the loop, config and CLI

- [ ] 3.1 `packages/agent/__tests__/task/delegation-loop.test.ts` (faux provider and fake `claude` only): `task/agent` "The delegate configuration is stored with the loop" (moved from `__tests__/task/agent-options.test.ts`), "A delegating script without a grant is refused at start", "Only the delegate script delegates", "The judge sees an idle delegate" and "Orient asks for a different approach" (5). Also check that "A delegate timeout costs one iteration" in `__tests__/task/action-retry.test.ts` names `delegate/claude_code` and 900000 ms, as modified.
- [ ] 3.2 `packages/agent/__tests__/task/config-delegates.test.ts`: `task/headless` "No config grants nothing", "A grant's context is anchored at the config", "A misspelled grant key is refused", "Grants reach the loop" and "An old config is refused with directions", and `task/cli` "A delegating script is refused without grants" and "A delegate-free script still runs" (7)

## 4. Docs

- [ ] 4.1 `docs/ontology/loops/action.md`: a `delegate` action is a user-granted `mcpTool://delegate/<name>`, recorded with `DiffEvidence` and `CheckEvidence`; `pnpm docs:check` passes
- [ ] 4.2 `CLAUDE.md`: "Running a task" explains grants (`delegates` in the config, `--no-delegates`, nothing granted by default) and drops `delegateModel`/`delegateContext`; the hard lines (no `--bare`, `--safe-mode`, stripped env, never the OAuth token) are stated for the `claude-code` runner

## 5. Verify

- [ ] 5.1 `pnpm -r check`, `pnpm -r test` (twice, stable), `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass
- [ ] 5.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive add-agentscript-delegation`
