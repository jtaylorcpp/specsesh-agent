# Design: add-delete-file-grant

## Context

add-delete-file-action adds a `delete_file` host action and a `deleteActions(workspace)` registry to bind it. It does not grant the action to anything. Today the task CLI (`agentscript-task`, run as `pnpm task`) builds its harness from `taskLoopExtensions({ workspace, checks, allow, delegates, runners })`. That covers `workspaceActions` and the delegation actions, nothing more. Our own loops run `task-delegate`. In that script all file work happens inside a Claude Code child whose allowlist is `["pnpm", "node"]`, so the child cannot delete files. Task 3.6 of add-actors-and-workspaces blocked for this reason (gaps.md #7).

This change has four parts:

1. A config field that grants `delete_file`.
2. CLI wiring that adds `deleteActions(workspace)` when the field is set.
3. Bundled scripts that use the action when it is granted and still start when it is not.
4. This repo's config turning the grant on.

The Claude Code child does not change. It still cannot delete anything.

Assumption: `delete_file` takes one workspace-relative `path`, removes one file, and answers `ok: false` with a message when the path is missing or is a directory. That is add-delete-file-action's contract. This design calls the action and does not define it.

## How it is used

### 1. Granting it in the repo config

The grant is a new optional boolean under `task`: **`deleteFiles`**. It is off unless set, and only `true` grants the action. See `design/examples/agentscript.config.json` for this repo's full config. The only new line is:

```json
{ "task": { "deleteFiles": true } }
```

The field follows the rules every `task` field already follows:

- A wrong type is refused with exit `2`, naming the key and the config path. For example, `"deleteFiles": "yes"` is refused.
- The value resolves as flag, then config, then default. The default is `false`. No CLI flag and no environment variable are added: the grant is a repo decision, not a per-run one.
- A config without the field behaves exactly as it does today.

### 2. What the CLI does with it

`design/examples/harness.ts` shows the harness construction. `taskLoopExtensions` gains one option, `deleteFiles?: boolean`, with default `false`. When it is `true`, `deleteActions(workspace)` is added to the registry next to `workspaceActions` and the delegation actions. When it is `false`, the registry is exactly today's. The resolved value is also stored in the loop's durable input next to `delegates`, so `resume` and `answer` rebuild the same harness.

```ts
const extensions = taskLoopExtensions({
  workspace, checks, allow, delegates, runners,
  deleteFiles: config.task.deleteFiles ?? false,   // new
});
```

### 3. Bundled scripts that mention `delete_file` but don't require it

The task loop's start-up check treats `delete_file` as an **optional target**:

- **Bound:** the script is checked and run as today.
- **Unbound, model-callable** (`task.agent`'s act step): the script is not refused. The tool is left out of the tools offered to that step, so the model never sees it.
- **Unbound, deterministic** (`task-delegate.agent`'s retire step): the script is not refused. If the call is reached, it answers `ok: false` with `delete_file is not granted: set "deleteFiles": true under "task" in agentscript.config.json`. The existing rule "a run ended by a failed action is retried within budget" handles that result, and the message reaches the next iteration through `carried`.

The loop also seeds one new **optional** variable, `delete_granted` (boolean). It is seeded only when the script declares it, so existing custom scripts stay valid. Both bundled scripts declare it and use it to decide whether to plan or attempt a delete. A script that names `delete_file` without a grant therefore runs normally, and never fails because of a delete it does not attempt.

No other action becomes optional. An unbound `delegate/claude_code` is still refused with `no delegates are granted`.

### 4. `task.agent`

The act step's tools become `read_file`, `edit_file`, `run_command` and `delete_file`. The orient prompt gains one line, present only when `delete_granted` is true: "If the task retires a file, delete it with delete_file; do not empty it."

### 5. `task-delegate.agent`: the outer step deletes

The child still cannot delete. The flow is shown in `design/examples/task-delegate.agent`:

1. **delegate** (unchanged child, allowlist `pnpm`, `node`). The prompt gains: "You cannot delete files. If the task retires a file, leave it in place and end your reply with one line `RETIRE: <path>` per file."
2. **retire** (new model step, runs only when `delete_granted` is true). It reads the delegate's reply and `files_changed` and sets `retire_path` to the first `RETIRE:` path, or `""` when there is none.
3. **delete_file** (deterministic, runs only when `retire_path` is not `""`). It calls `delete_file { path: retire_path }`. Its action and its evidence are recorded in the iteration, as `edit` and `command` actions already are.
4. **check / judge** (unchanged, except that the judge prompt also shows `Files deleted: <retire_path or none>`).

One file is retired per iteration. If the delegate names more than one, the judge sees the rest still on disk and retries, and the next iteration deletes the next one.

`design/mock.html` shows a run of task 3.6 under this flow, the session that previously blocked, rendered as the CLI's stderr and stdout. It also shows the same script under a config without the grant.

## Decisions

- **A boolean `task.deleteFiles`, not a list of granted actions.** The proposal grants exactly one action. A generic `grants: [...]` list would add scope and invite granting other actions.
- **No flag and no environment variable.** The grant belongs with the repo's checks and allowlist in the config. Out of scope: granting it by default.
- **The grant is stored with the loop.** `resume` must not gain or lose the action halfway through a loop just because the config was edited in between.
- **Unset means today's harness.** Bundled scripts are kept valid by making `delete_file` an optional target in the start-up check, not by registering a stub action. A stub would change the harness for configs that never asked for it.
- **Optional seeded variable `delete_granted`.** The scripts can then avoid offering or attempting a delete they would be refused. Making it optional keeps the existing task-script contract intact for user scripts.
- **The child reports and the outer step deletes.** The child's allowlist is untouched: no `rm`, no `git rm` (out of scope). The `RETIRE:` line is plain text because the delegation result has no structured field for it, and adding one belongs to the delegation capability.
- **One delete per iteration.** This keeps the script free of loops. Multi-file retirement costs extra iterations and stays within the budget.
- **Files only.** If the delegate names a directory, `delete_file` refuses it per add-delete-file-action, and the refusal is retried like any other failed action.

## Risks

- **`delete_file`'s exact shape is owned by add-delete-file-action.** The shape covers the target name, the single `path` argument, and refusing directories. If it lands differently, step 3 of the delegate script and the example change with it. That adjusts the call; it does not redesign this change.
- **The child may forget the `RETIRE:` line.** The judge then sees the file still present and the checks failing, and retries. The orient prompt's "change approach" rule applies.
- **The retire step's model could pick a path that was not meant.** The delete is confined to the workspace by `delete_file`, the runner never commits, and `loop-ended.changed` lists the deleted path for review.
- **An optional action target is a new idea in the start-up check.** It is limited to the single name `delete_file`, so other unbound targets are still refused up front.
- **Retiring several files uses more iterations.** With `maxIterations` `8` this is acceptable for the known case (task 3.6). If it becomes a problem, a list-taking variant is a later change.
