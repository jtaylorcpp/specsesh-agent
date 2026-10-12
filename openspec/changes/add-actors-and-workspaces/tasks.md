## 1. Workspaces, the node entry and the host config (additive: everything that runs today keeps running)

- [x] 1.1 `packages/agent/src/durable/workspace.ts` (new) + `src/durable/index.ts`: `Workspace`, `ExecOptions`, `ExecResult`, `WorkspaceSnapshot`, `WorkspaceError`, `diffSnapshots`, `runChecks(workspace, checks, timeoutMs)`, and `workspaceActions(workspace, { allow, checks, timeoutMs })`. The last is the four built-ins over a workspace, with the behaviour and records `actions/registry` specifies and `this workspace cannot run commands` when there's no `exec`. No `node:` import.
- [x] 1.2 `packages/agent/src/node/local-workspace.ts` (new) + `src/node/snapshot.ts` (new):
  - `localWorkspace(dir)`: the confinement rules, `exec` through a child process with no shell and a timeout kill, `snapshot` via git or `undefined` outside git;
  - move `repoRoot`, `status`, `snapshot` and `changedBetween` from `src/task/git.ts` into `snapshot.ts`, with `git.ts` re-exporting them;
  - it may import `confine`, `runArgv` and `splitCommand` from `src/durable/builtins.ts`, which still exists until 3.6.
- [x] 1.3 `packages/agent/src/node/index.ts` (new), `packages/agent/package.json` (`./node` export, ninth, after `./durable`), `packages/agent/README.md` (nine entries), and the build copying nothing new. Update `__tests__/package/` for `Scenario: The exports map is exact` and `Scenario: Every entry is documented`.
- [x] 1.4 `packages/agent/src/durable/agent-config.ts` (new) + `src/durable/harness.ts` (new, runtime-neutral):
  - `ModelFactory<Env>` and `AgentConfig<Env>`;
  - `createAgentHarness(config, { storage, env, extensions?, context })`, awaiting an async `workspace` factory: each factory called once in key order, each distinct provider registered once, a name clash refused naming both keys;
  - the registry: `workspaceActions`, then `config.actions`, then `delegationActions` once group 2 lands (until then, `delegates` must be absent or empty, else reject);
  - run and step extensions over it, then `extensions`.
- [x] 1.5 `packages/agent/__tests__/durable/workspace.test.ts`: `actions/workspace` "The interface loads without Node built-ins", "A write then a read round-trips", "A created and an edited file", "The built-ins use the workspace they were given" and "Commands need exec" (5), named `Scenario: <exact scenario name>`
- [x] 1.6 `packages/agent/__tests__/node/local-workspace.test.ts`: `actions/workspace` "A metacharacter is an argument", "A slow process is killed", "A symlink out of the workspace is refused" and "Outside git there is no snapshot" (4)
- [x] 1.7 `packages/agent/__tests__/durable/agent-config.test.ts` (faux provider only): `host/agent-config` "A config without a default model does not type-check" (a `tsc --noEmit` fixture), "A script runs on the config's default model in its workspace", "A host's own action sits beside the built-ins", "Two models on one provider", "A provider name clash is refused" and "A binding-like value reaches the model factory" (6)

## 2. The delegation mechanism (additive: `delegate_claude_code` stays registered until group 3)

- [x] 2.1 `packages/agent/src/durable/delegation.ts` (new) + `src/durable/index.ts`:
  - `DelegateGrant`, `DelegateGrants`, `DelegateTerms`, `ProcessRunner`, `Runners`, `DelegateGrantError`;
  - grant validation, all or nothing: `runner` and `maxCalls` common, every other key declared by its runner (a `ProcessRunner` carries its accepted keys, types and defaults); defaults;
  - `delegationActions(grants, { workspace, runners })`. One call: the `maxCalls` check, snapshot, `prepare`, `workspace.exec`, snapshot, `read`, record. Cases:
    - no `exec` → `this workspace cannot run processes`;
    - `timed-out` or `spawn-error` → `{ ok: false }`;
    - no snapshot → `files_changed` `-1` and no `DiffEvidence`.
  - The terms block appended to stdin.
- [x] 2.2 `packages/agent/src/durable/extension.ts` + `src/durable/actions.ts`: `maxCalls` counted from the run's own reports (its `run` action reports and its steps' tool calls for that action); `createActionRegistry` refuses a `delegate/` name `delegationActions` didn't make (a module-private brand); for an unregistered `mcpTool://delegate/<name>`, `ActionBindingError` adds the granted names, or `no delegates are granted`
- [x] 2.3 `packages/agent/src/node/claude-code-runner.ts` (new) + `src/node/index.ts`: `claudeCodeRunner({ binary? })` and `defaultRunners`. The argv, env stripping and result reading are adapted from `delegateArgs`, `claudeCodeEnv` and `readDelegateResult` in `src/durable/builtins.ts`, which keeps its copies until 3.6. Context files resolved; a missing one is a `prepare` error. Wire `delegationActions` into `createAgentHarness` (1.4).
- [x] 2.4 `packages/agent/__tests__/durable/delegation-grants.test.ts`: `actions/delegation` "One action per grant", "An extra output is refused at start", "A hand-made delegate action is refused", "No grants", "A different grant", "An unused grant is fine", "Another permission mode is refused" and "An unknown runner is refused" (8)
- [x] 2.5 `packages/agent/__tests__/node/claude-code-runner.test.ts` (fake `claude` only): "A minimal grant takes the defaults", "Instructions cannot add a flag", "The terms follow the instructions", "The default runners hold claude-code", "The argv and environment keep the hard lines", "The allowlist becomes Bash patterns", "An empty allowlist allows no shell" and "A missing context file fails the call" (8)
- [x] 2.6 `packages/agent/__tests__/durable/delegation-records.test.ts` (fake `claude` and in-memory workspaces only): "A workspace that cannot run processes", "The call past the limit fails", "A delegate that never finishes is killed", "A change is recorded with its diff", "A delegate that changed nothing says so" and "Without snapshots the count is unknown" (6)

## 3. The switch (one group, so group 4's run starts on grants and workspaces: the agent runs on this code)

- [x] 3.1 `packages/agent/src/task/options.ts`, `src/task/loop-input.ts`, `src/task/loop.ts`, `src/task/start.ts`, `src/task/group.ts`:
  - `delegates?: DelegateGrants` replaces `delegateModel` and `delegateContext` through the options, the durable input and the group input;
  - `taskLoopExtensions({ workspace, checks, allow, delegates, runners })`, where `workspace` is a directory or a `Workspace` and `runners` defaults to `defaultRunners`;
  - its registry is `workspaceActions` plus `delegationActions`, the same at start and at run.
- [x] 3.2 `packages/agent/src/task/loop.ts` (the gate) + `src/task/group.ts` (the group check): checks run with `runChecks` over the loop's workspace (replacing the group's own runner); no `exec` fails with `this workspace cannot run commands`
- [x] 3.3 `packages/agent/src/task/scripts/task-delegate.agent`:
  - `act` runs an action `claude_code` targeting `mcpTool://delegate/claude_code`, with outputs `ok`, `summary` and `files_changed`, setting `act_ok`, `act_summary` and `act_files` (declared `number`);
  - the judge gains `Files the delegate changed: {!@variables.act_files}`;
  - orient's iteration-2+ block gains the different-approach line from `design.md`;
  - it still lints clean, keeps the contract and keeps the iterate-first judge lines.
- [x] 3.4 `packages/agent/src/task/config.ts`:
  - read the top-level `delegates`, validated with the grant rules against `defaultRunners`; errors name the config path, the grant and the key, and exit `2`;
  - resolve each grant's `context` against the config's directory;
  - refuse `delegateModel` and `delegateContext` with `moved: grant a delegate under "delegates" instead`;
  - update `__tests__/task/config.test.ts` for the new field set.
- [x] 3.5 `packages/agent/src/bin/agentscript-task.ts` + `__tests__/task/cli-helpers.ts`:
  - build the harness with `createAgentHarness` (`host/agent-config`, "The task CLI builds its harness from a config");
  - pass `delegates` to task and group loops (worktree runs rebase grant context paths as they did `delegateContext`);
  - `--no-delegates`, listed in the options usage.

  Then `agentscript.config.json`: drop `delegateModel` and `delegateContext`, and add `delegates.claude_code` (`runner` `claude-code`, `model` `opus`, `allow` `["pnpm", "node"]`, `context` `["CLAUDE.md"]`). `__tests__/repo/config.test.ts` pins the modified scenario.
- [x] 3.6 Retire the old delegate and free `./durable` of Node:
  - move `src/durable/builtins.ts` to `src/node/builtins.ts`, where `builtinActions({ workspace: dir, … })` = `workspaceActions(localWorkspace(dir), …)`, with no `delegate_claude_code` and no `delegateModel`, `delegateContext` or `claudeBinary`;
  - move `confine`, `runArgv` and `splitCommand` into `src/node/`;
  - `src/durable/index.ts` re-exports nothing Node, and `src/durable/` imports no `node:` module and not `src/claude-code/`;
  - update the layer test in `__tests__/package/` with `Scenario: The durable layer is free of Node`;
  - delete the tests pinning the removed `actions/registry` requirements (`__tests__/durable/actions/delegate.test.ts`), add `Scenario: No delegate is built in` to `__tests__/durable/actions/registry.test.ts`;
  - migrate every other test still naming `delegate_claude_code`, `delegateModel`, `delegateContext` or `builtinActions` from `./durable` (`worktree.test.ts`, `bundled-judges.test.ts`, `actions-run-task.test.ts`, `agent-options.test.ts`, `action-retry.test.ts`, `config.test.ts`, `cli-helpers.ts`), so the group check passes.

## 4. Tests for the loop, config and CLI

- [x] 4.1 `packages/agent/__tests__/task/delegation-loop.test.ts` (faux provider and fake `claude` only): `task/agent` "The delegate configuration is stored with the loop" (moved from `__tests__/task/agent-options.test.ts`), "A delegating script without a grant is refused at start", "Only the delegate script delegates", "The judge sees an idle delegate" and "Orient asks for a different approach"; `actions/delegation` "The delegate runs in the loop's worktree"; `actions/workspace` "The gate's checks go through the workspace" (7). Also check that "A delegate timeout costs one iteration" in `__tests__/task/action-retry.test.ts` names `delegate/claude_code` and 900000 ms.
- [x] 4.2 `packages/agent/__tests__/task/config-delegates.test.ts`:
  - `task/headless` "No config grants nothing", "A grant's context is anchored at the config", "A misspelled grant key is refused", "Grants reach the loop" and "An old config is refused with directions";
  - `task/cli` "A delegating script is refused without grants" and "A delegate-free script still runs";
  - `host/agent-config` "A granted delegate reaches the CLI's registry" (8).

## 5. Docs

- [x] 5.1 `docs/ontology/loops/action.md`: actors (self or delegate), the loop's one workspace, and a `delegate` action as a user-granted `mcpTool://delegate/<name>` recorded with `DiffEvidence` and `CheckEvidence`; `pnpm docs:check` passes
- [x] 5.2 `CLAUDE.md`: the layout gains `src/node/` and the `./node` entry (`./durable` is runtime-neutral). "Running a task" explains grants (`delegates` in the config, `--no-delegates`, nothing granted by default) and drops `delegateModel`/`delegateContext`. The hard lines are stated for `claudeCodeRunner`.

## 6. Verify

- [ ] 6.1 `pnpm -r check`, `pnpm -r test` (twice, stable), `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass
- [ ] 6.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive add-actors-and-workspaces`
