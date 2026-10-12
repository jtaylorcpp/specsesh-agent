---
id: action
name: Action
kind: type
area: loops
spec:
  - "openspec/loops: An action records what an iteration did"
  - "openspec/loops: An iteration plans, acts, gathers evidence and judges"
  - "actions/registry: An action registry maps names to host actions"
  - "actions/workspace: The built-ins are defined over a workspace"
  - "actions/workspace: The loop's checks run through the workspace"
  - "actions/delegation: An ungranted delegate is refused at start, listing the grants"
  - "actions/delegation: A grant has typed fields and defaults"
  - "actions/delegation: A delegate acts only through its run's workspace"
  - "actions/delegation: Every delegation records what it changed"
  - "actions/agent-runner: The durable entry exports the agent runner"
  - "actions/agent-runner: An agent grant names a model, a script, tools and a step limit"
  - "actions/agent-runner: An agent grant is checked against the harness when it is built"
  - "actions/agent-runner: A delegate script keeps the delegate contract"
  - "actions/agent-runner: A call runs the script as a durable child in the caller's workspace"
  - "actions/agent-runner: A failed child is a failed call"
  - "actions/agent-runner: A crash while the child runs never starts a second child"
  - "actions/agent-runner: An agent delegate is called with run only"
  - "actions/agent-runner: The bundled delegate scripts fit the contract"
  - "actions/workspace: list_files and search_files are built-ins over list and search"
  - "durable/run-task: A run's scope limits the actions it may bind and call"
  - "durable/run-task: A run stops at its step limit"
  - "durable/run-task: A durable host action runs as a child task"
  - "task/headless: The repo config may name more models"
  - "task/headless: An agent grant's script is a bundled name or a path"
related: [iteration, diff-evidence, check-evidence, evidence]
status: implemented
---

# Action

Something an iteration did: an edit, a command, or a delegation to another agent.

## Definition

```
Action { kind: "edit" | "command" | "delegate", summary: string, refs: string[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"edit"` \| `"command"` \| `"delegate"` | What sort of thing was done. |
| summary | `string` | One line saying what and why. For `"delegate"`, the first line of the instructions. |
| refs | `string[]` | For `"edit"`, the files edited; for `"command"`, the command line run; for `"delegate"`, the granted delegate, `delegate/<name>`. |

## Invariants

- `kind` is one of the three values; any other (e.g. `"think"`) fails the check.
- An action records *what was done*, never its result. Diffs and command results are [evidence](../evidence/evidence.md): [DiffEvidence](../evidence/diff-evidence.md) and [CheckEvidence](../evidence/check-evidence.md).
- **Two actors.** An agent acts either *itself*, calling the workspace built-ins `read_file`, `edit_file`, `run_command` and `run_checks` (`task.agent`), or through a *delegate*, a script action targeting `mcpTool://delegate/<name>` (`task-delegate.agent`, which still runs `run_checks` itself). `read_file` changes nothing and records no action.
- **One loop, one workspace.** The built-ins, every delegate, the task loop's gate and the group loop's check all go through the one `Workspace` the loop was built with (`root`, `read`, `write`, optional `exec`, optional `snapshot`). Locally that is `localWorkspace(dir)` from `@specsesh/agent/node`, over a checkout or a worktree. Without `exec`, built-ins and checks answer `this workspace cannot run commands` and delegates `this workspace cannot run processes`; checks never pass without it.
- **Delegation is granted by the user.** Nothing is built in or granted by default (`delegate_claude_code`, `delegateModel` and `delegateContext` are retired), and only `delegationActions` may register a `delegate/` name. A grant names a `runner`, `claude-code` or `agent` (see [Delegation](#delegation)), and fixes the delegate's terms. The `claude-code` runner's terms are `model`, `tools`, `allow` (default `[]`), `permissionMode` (`"dontAsk"` only), `context` (default `[]`), `timeoutMs` (default `900000`) and `maxCalls` (default `5`). The task CLI reads grants from `delegates` in `agentscript.config.json`; `--no-delegates` withdraws them for one run.
- **An ungranted delegate never starts.** A script targeting `mcpTool://delegate/<name>` with no such grant is refused at start with `ActionBindingError`, which lists the granted names or says `no delegates are granted`.
- **A delegate's interface is fixed.** Inputs `{ instructions }`, outputs `{ ok, summary, files_changed }`, whatever the runner. Its terms come only from the grant; a `claude-code` delegate has them restated on stdin, after the instructions.
- **Every delegation records what it changed.** The action, a `DiffEvidence` between workspace snapshots taken before and after (each path `added`, `deleted` or `modified`), and, for a `claude-code` delegate, a `CheckEvidence` for the process. `files_changed` is `0` for a delegate that changed nothing, and `-1`, with no `DiffEvidence`, when the workspace cannot snapshot.

## Delegation

### Runner kinds

| Runner | Kind | From | What a call is |
|---|---|---|---|
| `claude-code` | `"process"` | `claudeCodeRunner()`, `@specsesh/agent/node` | One blocking call through `workspace.exec`. Node only, on your subscription. |
| `agent` | `"agent"` | `agentRunner()`, `@specsesh/agent/durable` | Another Agent Script, run as a durable child `agentscript.run`. Runtime-neutral: no `node:` import, so it runs on Cloudflare too. |

`defaultRunners` in `@specsesh/agent/node` holds both: `claude-code` and `agent`, the latter equal to `agentRunner()`.

### The agent grant

| Key | Default | Meaning |
|---|---|---|
| `model` | required | A key of the harness's models. |
| `script` | required | Agent Script source in code. In `agentscript.config.json`: `"read"` (`READ_AGENT`), `"edit"` (`EDIT_AGENT`), or a path relative to the config file, read once; a missing path exits `2`. |
| `tools` | `["read_file", "list_files", "search_files"]` | The only actions the child may bind. |
| `maxSteps` | `20` | Model steps per call. |
| `maxCalls` | `5` | Calls per run, counted as for the process runner. |

In `agentscript.config.json`, `model` names an entry of the top-level `models` map. Each entry is `{ provider, model }`, resolved like the run's own and given to the harness beside `default` (the run's resolved provider and model). Naming one `default`, an unknown provider or an unknown key exits `2`.

```json
{
  "models": { "reviewer": { "provider": "anthropic", "model": "claude-haiku-4-5" } },
  "delegates": { "reviewer": { "runner": "agent", "model": "reviewer", "script": "read" } }
}
```

In code, the grant carries the script source:

```ts
import { READ_AGENT, agentRunner } from "@specsesh/agent/durable";

const config = {
  models: { default: haiku, opus },
  workspace: () => workspace,
  runners: { agent: agentRunner() },
  delegates: { reviewer: { runner: "agent", model: "opus", script: READ_AGENT } },
};
```

**The delegate contract.** A delegate script declares:
- seeded: `instructions: string`, from the call's `instructions`;
- read back when the child completes: `ok: boolean` and `summary: string`.

**The bundled scripts.** `READ_AGENT` gives one working subagent `read_file`, `list_files` and `search_files` as reasoning actions, then sets `ok` and `summary` from a structured result. `EDIT_AGENT` adds `edit_file` and `run_command`. Both are exported as source strings from `@specsesh/agent/durable`, so a Worker can use them too. Granting `EDIT_AGENT` with the default `tools` is refused: widen `tools` to match.

**Checked when the harness is built.** `createAgentHarness` rejects with `DelegateGrantError`, naming the grant, when:
- `model` is not one of the harness's models (the error lists them);
- a tool is not registered on the host, or starts with `delegate/`;
- the script has a lint diagnostic or an unsupported construct;
- the script uses an action outside the grant's `tools`;
- the script breaks the delegate contract (the error names the variable and its type).

### The durable delegate call

A call is a `run`, such as `run @actions.review with instructions = "…"` targeting `mcpTool://delegate/reviewer`. The `act` phase goes:

```
1. intent null    → commit intent { replay: "safe" }
2. no child yet   → before = workspace.snapshot()
                    child  = agentscript.run { source: script, entry: every subagent,
                             variables: { instructions }, model, scope: tools, maxSteps }
                    commit { child, before }                       ← one commit
3. child stored   → result = waitForTask(child)                    ← by id
4.                  after = workspace.snapshot(); finish; commit next
```

- **One child, ever.** `child` and `before` are stored in the commit that creates the child, so a crash resumes by waiting for the same child and never starts a second.
- **The answer.** `{ ok, summary, files_changed }`. A child that does not end `completed`, or completes with `ok` false, makes the call answer `{ ok: false }`, with the child's failure message or its `summary`.
- **The record.** An `Action` of kind `"delegate"` with refs `delegate/<name>` and `run:<childId>`, plus a `DiffEvidence` from `before` and the after-snapshot. The child's own actions stay in the child's result.
- **`run` only.** An agent delegate offered under `reasoning.actions` is refused at start with `ActionBindingError`, naming `delegate/<name>` and saying `call it with run`.
- **The mechanism.** This is `HostAction.durable { start, finish }`, available to any host action: `start` returns the child's run input (or a failed result, e.g. `maxCalls` reached), `finish` maps the child's result to the action's. Its replay is `"safe"`. See `durable/run-task`.

### Scope and step limits

Two `RunInput` fields of `agentscript.run` bound what a run may do:
- **`scope`.** An action the script defines whose tool is not in `scope` is refused at start with `ActionBindingError`, naming it and `outside this run's scope`. Without `scope`, every registered action is in scope.
- **`maxSteps`.** The run stops before dispatching step `maxSteps + 1` and ends `failed`, its last step `{ kind: "failed", category: "unknown" }`, with `reached its limit of <n> steps`.

An agent delegate's child runs with `scope` set to its grant's `tools`, so it can bind only those. A `delegate/` tool can't be granted, so a delegate never calls another.

`list_files` and `search_files`, the default agent tools beside `read_file`, come from `searchActions(workspace)`; the harness registers them only when its workspace has both `list` and `search` (`actions/workspace`).

## Relations

- Element of [Iteration](iteration.md)`.actions`.
- Its effects are recorded as [Evidence](../evidence/evidence.md) in the same iteration: an `"edit"` with [DiffEvidence](../evidence/diff-evidence.md), a `"command"` with one [CheckEvidence](../evidence/check-evidence.md) per command, a `"delegate"` with [DiffEvidence](../evidence/diff-evidence.md), plus a [CheckEvidence](../evidence/check-evidence.md) when its runner is a process.

## Example

An iteration of task `2.4` that runs the durable suite records `{ kind: "command", summary: "run the durable tests", refs: ["pnpm --filter agentscript-durable test"] }`. The suite's exit code goes in a `CheckEvidence`, and each `Scenario:` test's result in a `TestEvidence`, not on the action.

An iteration of `task-delegate.agent` that hands the same task to the granted `claude_code` records `{ kind: "delegate", summary: "Fix the failing durable test", refs: ["delegate/claude_code"] }`, then a `DiffEvidence` such as `[{ path: "src/a.ts", change: "modified" }, { path: "src/new.ts", change: "added" }]` and a `CheckEvidence` for the `claude` process. The delegate answers `files_changed: 2`.

## Spec

- `openspec/loops: An action records what an iteration did`
- `openspec/loops: An iteration plans, acts, gathers evidence and judges`
- `actions/registry: An action registry maps names to host actions`
- `actions/workspace: The built-ins are defined over a workspace`
- `actions/workspace: The loop's checks run through the workspace`
- `actions/delegation: An ungranted delegate is refused at start, listing the grants`
- `actions/delegation: A grant has typed fields and defaults`
- `actions/delegation: A delegate acts only through its run's workspace`
- `actions/delegation: Every delegation records what it changed`
- `actions/agent-runner: The durable entry exports the agent runner`
- `actions/agent-runner: An agent grant names a model, a script, tools and a step limit`
- `actions/agent-runner: An agent grant is checked against the harness when it is built`
- `actions/agent-runner: A delegate script keeps the delegate contract`
- `actions/agent-runner: A call runs the script as a durable child in the caller's workspace`
- `actions/agent-runner: A failed child is a failed call`
- `actions/agent-runner: A crash while the child runs never starts a second child`
- `actions/agent-runner: An agent delegate is called with run only`
- `actions/agent-runner: The bundled delegate scripts fit the contract`
- `actions/workspace: list_files and search_files are built-ins over list and search`
- `durable/run-task: A run's scope limits the actions it may bind and call`
- `durable/run-task: A run stops at its step limit`
- `durable/run-task: A durable host action runs as a child task`
- `task/headless: The repo config may name more models`
- `task/headless: An agent grant's script is a bundled name or a path`
