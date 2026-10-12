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
- **Delegation is granted by the user.** Nothing is built in or granted by default (`delegate_claude_code`, `delegateModel` and `delegateContext` are retired), and only `delegationActions` may register a `delegate/` name. A grant names a `runner` (`claude-code` today) and fixes the delegate's terms. The `claude-code` runner's terms are `model`, `tools`, `allow` (default `[]`), `permissionMode` (`"dontAsk"` only), `context` (default `[]`), `timeoutMs` (default `900000`) and `maxCalls` (default `5`). The task CLI reads grants from `delegates` in `agentscript.config.json`; `--no-delegates` withdraws them for one run.
- **An ungranted delegate never starts.** A script targeting `mcpTool://delegate/<name>` with no such grant is refused at start with `ActionBindingError`, which lists the granted names or says `no delegates are granted`.
- **A delegate's interface is fixed.** Inputs `{ instructions }`, outputs `{ ok, summary, files_changed }`. Its terms come only from the grant and are restated to it on stdin, after the instructions.
- **Every delegation records what it changed.** The action, a `DiffEvidence` between workspace snapshots taken before and after (each path `added`, `deleted` or `modified`), and a `CheckEvidence` for the process. `files_changed` is `0` for a delegate that changed nothing, and `-1`, with no `DiffEvidence`, when the workspace cannot snapshot.

## Relations

- Element of [Iteration](iteration.md)`.actions`.
- Its effects are recorded as [Evidence](../evidence/evidence.md) in the same iteration: an `"edit"` with [DiffEvidence](../evidence/diff-evidence.md), a `"command"` with one [CheckEvidence](../evidence/check-evidence.md) per command, a `"delegate"` with both.

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
