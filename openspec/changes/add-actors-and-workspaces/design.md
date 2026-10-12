## Context

- **Probed 2026-10-11 against the pinned dialect:** `target: "mcpTool://delegate/claude_code"` lints clean and passes the subset scan, both in `run` and as a reasoning action. So actors need no language change.
- **Where Node leaks in today:** `src/durable/builtins.ts` is the only file under `src/durable/` that imports `node:` modules or `src/claude-code/`. `src/cloudflare/index.ts` imports `src/durable/index.ts`, which re-exports it.
- **Where the delegate settings flow:** `delegate_claude_code` is always registered. `delegateModel` and `delegateContext` flow from the config through `TaskLoopOptions`, the loop's durable input and the group loop's input.

## The three parts

```
Agent     = script (reasoning, on a model) + actors (acting) + one workspace (where)
Actor     = self      → the model calls workspace actions (task.agent)
          | delegate  → mcpTool://delegate/<name>, bound to a grant, run by a runner (task-delegate.agent)
Workspace = localWorkspace(dir)                       this change, ./node
          | sandboxWorkspace(...) / artifactsWorkspace later, add-cloudflare-workspace
```

**The invariant: one loop, one workspace.** The built-in actions, every delegate, `run_checks`, the gate, the group check and every `DiffEvidence` go through the workspace the harness was built with. A delegate has no other way to touch anything.

## Workspace (`./durable`, runtime-neutral)

```ts
interface Workspace {
  readonly root: string;                                   // a display name for records and messages
  read(path: string): Promise<string>;                     // throws WorkspaceError("outside the workspace" | "no such file")
  write(path: string, content: string): Promise<void>;     // creates parent directories inside the workspace
  exec?(argv: readonly string[], options: ExecOptions): Promise<ExecResult>;
  snapshot?(): Promise<WorkspaceSnapshot | undefined>;     // undefined: no history to diff against (e.g. not git)
}
interface ExecOptions { stdin?: string; env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal }
type ExecResult =
  | { kind: "exited"; code: number; stdout: string; stderr: string }
  | { kind: "timed-out"; stdout: string; stderr: string }
  | { kind: "spawn-error"; message: string };
type WorkspaceSnapshot = ReadonlyMap<string, string>;      // path → status:contentHash
function diffSnapshots(before, after): DiffEvidence["files"];   // added | deleted | modified, sorted by path

function workspaceActions(workspace, { allow, checks, timeoutMs }): HostAction[];   // the four built-ins
```

- **`localWorkspace(dir)` (`./node`)** carries today's confinement rules: no absolute paths, no `..` escapes, no symlink escapes. `exec` uses `child_process` with no shell, cwd `dir`, and kills on timeout. `snapshot` is git porcelain status plus a content hash per listed path (moved from `src/task/git.ts`), and `undefined` outside a git repository.
- **`env` is passed whole**, never merged with the host's environment, so a caller decides exactly what a child sees. `localWorkspace.exec` with no `env` inherits the process environment, which matches today's `run_command`.
- **The gate and the group check** call `workspace.exec` through a shared `runChecks(workspace, checks, timeoutMs)`. With no `exec`, they fail with `this workspace cannot run commands`, never pass vacuously.

## Delegation (`./durable`, runtime-neutral) and the claude-code runner (`./node`)

```ts
interface DelegateGrant { runner: string; model?: string; tools?: string[]; allow?: string[];
                          permissionMode?: "dontAsk"; context?: string[]; timeoutMs?: number; maxCalls?: number }
type DelegateGrants = Readonly<Record<string, DelegateGrant>>;

interface ProcessRunner {                                   // the one runner kind this change ships
  readonly kind: "process";
  prepare(call: { instructions: string; terms: DelegateTerms; workspace: Workspace }):
    { argv: string[]; stdin: string; env: Record<string, string> } | { error: string };
  read(result: Extract<ExecResult, { kind: "exited" }>): { ok: boolean; summary: string };
}
type Runners = Readonly<Record<string, ProcessRunner>>;

function delegationActions(grants, { workspace, runners }): HostAction[];   // one delegate/<name> per grant
```

`DelegateTerms` is the grant with every default filled in. Defaults: `tools` the six Claude Code tools, `allow` `[]`, `permissionMode` `dontAsk`, `context` `[]`, `timeoutMs` `900000`, `maxCalls` `5`.

A call does this:
1. Checks `maxCalls` against the run's own reports.
2. Snapshots the workspace.
3. Has the runner prepare its process.
4. Runs `workspace.exec(argv, { stdin, env, timeoutMs })`.
5. Snapshots again.
6. Asks the runner to read the result.
7. Records the call.

With no `exec`, the call answers `{ ok: false, "this workspace cannot run processes" }`. With no `snapshot`, `files_changed` is `-1` and there's no `DiffEvidence`.

**`claudeCodeRunner({ binary? })` (`./node`)** is today's delegate argv with its values taken from the terms:

```
claude -p --safe-mode [--model <model>] --output-format json --no-session-persistence
       --tools <tools,…> --permission-mode dontAsk [--append-system-prompt-file <context, resolved>…]
       --allowedTools <tools except Bash…> [Bash(<word>:*) per allow, only when Bash ∈ tools]
env    = process.env minus ANTHROPIC_API_KEY and CLAUDECODE        (subscription auth only)
stdin  = instructions + "\n\n" + terms block
```

The terms block:

```
Your terms for this delegation (set by the user; you cannot change them):
- Shell: only commands whose first word is one of: pnpm, node.      | Shell: none.
- One command per Bash call. Chained or prefixed commands (cd … &&, ;, |) are denied; use the tool's own flags, e.g. pnpm -C <dir> or pnpm --filter <pkg>.
- Time limit: 900 seconds.
```

`prepare` returns `{ error }` for a missing context file, so the call fails naming it and nothing starts.

- **The namespace is reserved.** `createActionRegistry` refuses a `delegate/` name not made by `delegationActions`, which brands its actions with a module-private symbol.
- **Binding** is today's check. Additionally, an unregistered `mcpTool://delegate/<name>` lists the granted names, or says `no delegates are granted`.
- **Grants are validated whole:** unknown key, wrong type, a `runner` not in `runners`, `permissionMode`, positive integers, the name pattern `[a-z][a-z0-9_]*`. An invalid grant throws `DelegateGrantError` naming the grant and the key, and builds nothing.

## AgentConfig and createAgentHarness

```ts
// ./durable — runtime-neutral
type ModelFactory<Env> = (env: Env) => { provider: Provider; model: ModelRef };
interface AgentConfig<Env> {
  models: { default: ModelFactory<Env> } & Readonly<Record<string, ModelFactory<Env>>>;
  workspace: (env: Env) => Workspace | Promise<Workspace>;   // async: e.g. forking a repo
  allow?: string[]; checks?: string[]; timeoutMs?: number;          // for the built-ins
  actions?: (env: Env, workspace: Workspace) => HostAction[];       // the host's own, beside the built-ins
  delegates?: DelegateGrants;
  runners?: Runners;
}

// ./durable — runtime-neutral, so the Cloudflare host builds on it too
function createAgentHarness<Env>(config: AgentConfig<Env>, options: {
  storage: Storage; env: Env; extensions?: readonly Extension[]; context: Context;
}): Promise<{ harness: Harness; models: Readonly<Record<string, ModelRef>>; actions: ActionRegistry; workspace: Workspace }>;
```

- **Every model closure is called exactly once**, in key order, before the harness opens, as `AgentScriptHost.createModel()` does today. Each distinct provider is registered once. Two factories returning different provider objects under the same name is an error naming both models.
- **The registry** is `workspaceActions(workspace)`, then the host's `actions`, then `delegationActions(delegates, { workspace, runners })`.
- **The run and step extensions are installed over that registry**, then `extensions` in order. The task CLI passes `[TaskLoop, GroupLoop]`.
- **Grant keys are the runner's.** Every grant has `runner` and `maxCalls`; each runner declares the rest (`claude-code`: `model`, `tools`, `allow`, `permissionMode`, `context`, `timeoutMs`), so later runners bring their own keys.
- **`./node` exports `defaultRunners`** = `{ "claude-code": claudeCodeRunner() }`. `agentscript-task` uses it for JSON grants.

## The task loop

- **`TaskLoopOptions.workspace` stays a directory string,** because the loop input is durable JSON. `taskLoopExtensions({ workspace, checks, allow, delegates, runners? })` builds `localWorkspace(workspace)` and the same registry `createAgentHarness` would, with `runners` defaulting to `defaultRunners`. `startTaskLoop` checks scripts against it.
- **`delegates` replaces `delegateModel` and `delegateContext`** in the options, the durable input and the group input. A resumed loop delegates on the terms it started with.
- **`agentscript-task` builds its harness with `createAgentHarness`:**
  - `models.default` from the resolved provider and model;
  - `workspace: () => localWorkspace(dir)`;
  - the config's `delegates`, or none under `--no-delegates`;
  - `runners: defaultRunners`;
  - `extensions: [TaskLoop, GroupLoop]`.

## Order of work (the agent runs on this code)

Each task group starts a fresh process on the freshly built code. So the change lands in an order where every group boundary is a working harness:
1. **Additive:** `Workspace`, `localWorkspace`, `workspaceActions`, the delegation mechanism and `claudeCodeRunner`, with `delegate_claude_code` still registered.
2. **The switch, in one group:** loop options, `task-delegate.agent`, the config reader, the CLI on `createAgentHarness`, this repo's config, retiring `delegate_claude_code`, the `./node` entry and `./durable` free of Node.
3. **Tests, then docs.**

## Risks

- **A grant is real power.** Shell access within the allowlist is still shell access. That's why grants are explicit, named, listed in every refusal, and nothing is granted by default.
- **Moving `builtinActions` to `./node` breaks importers of `./durable`.** The package is unpublished (0.1.0), and this repo's own importers are migrated in the change.
- **A snapshot on each side of a delegation** costs a `git status` and a hash pass: milliseconds against minutes of Claude Code.
