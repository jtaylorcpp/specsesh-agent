## Why

An agent's work has three parts that the code fuses today:
- **Reasoning:** a script's steps on a model.
- **Acting:** changing things. The agent does it itself through tools, or hands it to a delegate.
- **The workspace:** where the work happens.

Locally the workspace is a checkout or a worktree, and every actor (the agent's own tools, a Claude Code delegate, the checks, the gate) is pointed at that one directory. But nothing names that invariant. The built-in actions reach for `node:fs` and `node:child_process` directly. Delegation is a fixed built-in, `delegate_claude_code`, that no one granted. And `./cloudflare` imports `./durable`, which re-exports those Node-only built-ins.

The principal's model:
- **An agent acts by itself or through a delegate, and every actor works in the loop's one workspace.** Locally that's a worktree; on Cloudflare, later, a Sandbox cloned from an Artifacts fork.
- **By default the harness controls everything with the model provided.** Delegation is a capability an agent author opts into and the user grants, on the user's terms.
- **A host is built from one typed config.** Models are closures over the runtime's environment (an AI binding, a key, a subscription), plus a workspace factory, actions and grants. So Node and Cloudflare differ only in the closures they pass.

Running `add-group-loop` and `iterate-by-default` on our own agent also showed three gaps in today's delegate:
- **An idle delegate is invisible.** It changed nothing and the loop couldn't tell.
- **It doesn't know its terms.** A compound shell command was denied and it never learned why.
- **It repeats a failing approach.** `iterate-by-default` 2.2 spent 8 iterations on the same diagnosis.

## What Changes

- **Workspaces.** A runtime-neutral `Workspace` interface in `./durable`: confined `read` and `write`, optional `exec` (argv, no shell, a time limit) and optional `snapshot` (for diffs).
  - `localWorkspace(dir)` in a new **`./node`** entry implements it over the filesystem, `child_process` and git.
  - `workspaceActions(workspace, { allow, checks, timeoutMs })` in `./durable` defines the four built-ins (`read_file`, `edit_file`, `run_command`, `run_checks`) over any workspace. A workspace with no `exec` answers the command actions `{ ok: false }`.
  - `builtinActions({ workspace: dir, … })` moves to `./node`, as `workspaceActions(localWorkspace(dir), …)`.
- **The task loop's gate and the group check** run through the workspace too, so every check, actor and diff in a loop goes through one place.
- **Actors.** "Self" is the agent's own model calling workspace actions, as `task.agent` does. "Delegate" is an action targeting `mcpTool://delegate/<name>`, bound only to a grant. A delegate runs through the loop's own workspace (`exec` and `snapshot`), so it can never act somewhere else.
- **Grants and runners.** Each grant names a `runner`, resolved through a runner registry. This change ships the process runner kind and `claudeCodeRunner()` in `./node`, which runs Claude Code on your subscription through the workspace's `exec`. Grant fields: `model`, `tools`, `allow`, `permissionMode` (`dontAsk` only), `context`, `timeoutMs`, `maxCalls`. An ungranted delegate is refused at start, listing the grants. Terms come only from the grant, are told to the delegate in its instructions, and are bounded per run.
- **Recording.** Every delegation records an `Action` (`kind: "delegate"`), a `DiffEvidence` of what it changed, and a `CheckEvidence` for the process. It returns `files_changed`, which is `-1` when the workspace can't snapshot.
- **The built-in `delegate_claude_code` is retired.** Its hard lines become `claudeCodeRunner`'s rules:
  - `--safe-mode`, never `--bare`;
  - `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped;
  - the OAuth token never read or forwarded;
  - `dontAsk`;
  - subscription auth only.

  `delegateModel` and `delegateContext` move into a grant.
- **One typed host config.** `AgentConfig<Env>` in `./durable` holds:
  - `models`: named `ModelFactory<Env>` closures, with `default` required;
  - `workspace`: a factory;
  - `actions`, `delegates` and `runners`.

  `createAgentHarness(config, { storage, env, extensions })` in `./node` calls every model closure once, registers each provider, and installs the run and step extensions over the workspace's actions plus the granted delegates. `agentscript-task` builds its harness this way.
- **The module split.** `./durable` imports no `node:` module and not `src/claude-code/`, so `./cloudflare` no longer drags Node-only code into a Worker. `./node` is the ninth entry.
- **The bundled scripts:**
  - `task.agent` stays self-acting and delegate-free.
  - `task-delegate.agent` targets `mcpTool://delegate/claude_code`, shows its judge `files_changed`, and its orient step changes approach when a check fails again.
  - This repo's config grants `claude_code` on Opus.

## Out of scope

- **The `agent` runner** (a durable child run on another named model): `add-agent-runner`.
- **Cloudflare:** `defineAgentHost<Env>`, Workers AI and AI Gateway model factories, `sandboxWorkspace` over an Artifacts fork, an API-key auth mode for Claude Code in a Sandbox. All of that is `add-cloudflare-workspace`.
- **New workspace operations** (`list`, `search`) and the actions over them. They arrive with `add-agent-runner`, which needs them.
- **Delegates that delegate further,** and CLI flags that grant or reconfigure a delegate. Grants live in config, reviewed with the repository.

## Capabilities

- **New:**
  - `actions/workspace`: the interface, `localWorkspace`, the built-ins over a workspace, the loop's checks through it;
  - `actions/delegation`: the namespace, grants, runners, binding, terms, `claudeCodeRunner`, recording;
  - `host/agent-config`: `AgentConfig`, `ModelFactory`, `createAgentHarness`.
- **Modified:**
  - `actions/registry`: the built-ins come from a workspace; the delegate requirements move;
  - `package/distribution`: the `./node` entry, `./durable` free of Node, the readme;
  - `task/agent`: options carry grants; the scripts' delegation stance;
  - `task/headless`: the `delegates` config, the retired fields, this repo's grant;
  - `task/cli`: the options `run` passes, `--no-delegates`.

## Impact

- **Moves:** `src/durable/builtins.ts` moves to `src/node/`; the snapshot helpers move out of `src/task/git.ts`.
- **New:** `src/durable/workspace.ts`, `src/durable/delegation.ts`, `src/durable/agent-config.ts`, `src/node/`.
- **Updated:** the task loop, the group loop, the CLI, `agentscript.config.json`, `package.json` exports, the README, `CLAUDE.md`, docs, and tests (fake `claude` and the faux provider only).
- **Breaking:**
  - `builtinActions` moves from `./durable` to `./node`;
  - `delegate_claude_code`, `delegateModel` and `delegateContext` are retired.

  This repo's config, scripts and tests are migrated in the change.
- **Depends on nothing open.** `add-agent-runner` and then `add-cloudflare-workspace` follow it.
