## Context

This builds on `add-actors-and-workspaces`, which must be archived first. That change gives us:
- `Workspace`, `localWorkspace`, `workspaceActions`;
- `delegationActions(grants, { workspace, runners })`, with grant keys declared per runner and `maxCalls` counted from the run's reports;
- `createAgentHarness` in `./durable`, with named model closures.

The only runner kind it ships is `"process"`: one blocking call through `workspace.exec`. Today a host action's `execute` is one call within the `act` phase, with intent committed first and its replay policy applied after a crash (`durable/run-task`).

## The agent runner

```
grant:   { runner: "agent", model: "opus", script: READ_AGENT, tools?: [...], maxSteps?: 20, maxCalls?: 5 }

call:    run @actions.review  with instructions = "…"        (target: mcpTool://delegate/reviewer)

act phase (durable host action):
  intent null      → commit intent { replay: "safe" }
  no child yet     → before = workspace.snapshot()
                     child = createTask(agentscript.run, {
                       source: grant.script,
                       options: { entry: <every subagent>, variables: { instructions } },
                       model: models[grant.model],
                       scope: grant.tools, maxSteps: grant.maxSteps })
                     commit { phase: "act", state, intent, child, before }        ← one commit
  child stored     → result = waitForTask(child)             ← idempotent by id
                     after = workspace.snapshot()
                     finish → { ok, summary, files_changed } + record
                     commit { phase: "next", state: applyAction(...) }
```

- **Durable host actions, generically.** `HostAction` gains an optional `durable: { start, finish }` instead of `execute`. The agent runner is the first user of it. `start` returns the child's `RunInput`, or a failed `ActionResult` (for example `maxCalls` reached). `finish` maps the child's `RunResult` to an `ActionResult`.
- **Replay is `"safe"`.** Re-entering `act` with a stored `child` waits for it. Re-entering before the commit that stores it creates the child then, and the commit is atomic, so there is never a second child.
- **`run` only.** A reasoning-action tool call executes inside a step conversation as a pi tool. A child task there would need tool-level durability that pi doesn't give us today. The binding check refuses an agent delegate under `reasoning.actions` with `call it with run`.
- **Scope.** `RunInput.scope` restricts the binding check, so a child can only bind actions in its grant's `tools`. A `delegate/` tool can't be granted, so delegates don't nest.
- **Step limit.** `RunInput.maxSteps` stops the run before dispatching step `maxSteps + 1`. The run ends `failed`, category `unknown`, with `reached its limit of <n> steps`.
- **Records.** `Action { kind: "delegate", summary: <first line>, refs: ["delegate/<name>", "run:<childId>"] }`, plus `DiffEvidence` from `before` and the after-snapshot. The child's own actions keep their own records in the child's result.

## Validation at harness build

An agent runner can't validate its grant from the grant alone. It needs the harness's models and registry. `createAgentHarness` builds the registry in two passes:
1. The built-ins, search actions, host actions and process delegates.
2. Agent delegates, checked against pass 1 and `models`.

A failure rejects with `DelegateGrantError`, naming the grant.

The delegate contract is the task contract's little sibling:
- **seeded:** `instructions: string`;
- **read back:** `ok: boolean`, `summary: string`.

It's checked with the same declaration reader the task contract uses.

## Bundled delegate scripts (source text, no file system)

```
READ_AGENT:  subagent work   — reasoning.actions: read_file, list_files, search_files; instructions from @variables.instructions
             subagent report — set @variables.ok, @variables.summary from a structured result
EDIT_AGENT:  READ_AGENT + edit_file and run_command in work's reasoning.actions
```

They're exported as strings from `./durable`, so a Worker can use them too. The CLI maps `"read"` and `"edit"` to them.

## Workspaces list and search

- **`localWorkspace.list(glob)`:**
  - in git: `git ls-files -co --exclude-standard -z`, filtered by `glob`;
  - outside git: a directory walk without `.git/`.
- **`localWorkspace.search`** reads listed files in JavaScript, skipping files with a NUL byte (`rg` and `grep` skip those silently, per the repo's gotchas), and stops at `limit`.
- **Glob matching** is a small built-in matcher for `*`, `**`, `?` and `{a,b}`. No new dependency.

## CLI

- **Named models:** `agentscript.config.json` gains top-level `models: { reviewer: { provider: "anthropic", model: "claude-haiku-4-5" } }`. Each becomes a `ModelFactory` through the CLI's existing provider resolution (`anthropic`, `claude-code`, faux in tests).
- **Agent grant scripts:** a JSON agent grant's `script` is `"read"`, `"edit"`, or a path relative to the config file.
- **Runners:** `defaultRunners` gains `agent`.

## Risks

- **A delegate on a weaker model may do weaker work.** The grant's `tools` and `maxSteps` bound what it can do, and its result is just one action result that the caller's judge still weighs.
- **Deep durability adds rows.** Each delegation is one more child task. That's the same cost as a task loop's iterations, already proven.
