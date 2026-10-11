## Context

The task loop (`agentscript.task-loop`) is durable, checkpointed, and installed with `taskLoopExtensions({ workspace, checks, allow, delegateModel, delegateContext })`. The ontology defines the group loop and `GroupOutcome { group, tasks: { task, outcome: LoopOutcome<TaskOutcome>, runs }[] }`. The headless runner gives the CLI its config, events, worktrees and lock. This change composes those; it changes none of them.

## The loop

`agentscript.group-loop`, version 1. A durable task whose children are task loops:

```
input:      { change sources (read once, as for the task loop), group: integer, task-loop options, budget: { maxReworks } }
checkpoint: { phase, queue: TaskId[], entries: { task, outcome, runs }[], reworks, carried? }

phases:
  next      → pop the next TaskId from queue, or go to check when it is empty
  task      → start a task-loop child for it (carried feedback if this is a rework), await it (idempotent by child id)
              converged             → record the entry, back to next
              blocked               → group blocked; escalation carried up with level "group"
              exhausted | failed    → group failed, naming the task
  check     → run the configured checks in the workspace; all exit 0 → converged
              otherwise → judge
  judge     → run group.agent once (an agentscript.run child) with the group, task list and check output
              next_action "rework" + a task id in the group, reworks < maxReworks → queue that task, carried = check output + feedback, reworks += 1, back to next
              next_action "rework", budget spent → exhausted
              "ask" | "amend-spec"   → blocked with an escalation (level "group"; amend-spec carries a spec-defect finding)
              anything else, or a task id outside the group → failed: the script broke the contract
```

- **The queue starts as the group's unticked tasks, in file order.** Ticked tasks are entered as converged with `runs: 0` and no new loop. They were converged by an earlier run, and re-running them would cost money for nothing.
- **Every child is a task loop with the same options** and the same harness, so it inherits the workspace binding, the lock and the database.
- **`entries` keeps one row per task.** A rework replaces that task's `outcome` and increments `runs`, matching the ontology's `GroupOutcome` exactly.

## The group judge contract

`group.agent` is seeded with:

| Variable | Type | Seeded with |
|---|---|---|
| `group_number` | number | the group's number |
| `group_title` | string | the group's heading text |
| `tasks` | string | each task's id, text and last status, one per line |
| `proposal` | string | proposal.md |
| `deltas` | string | every delta, as for the task loop |
| `check_output` | string | the failing checks' commands, exit codes and output |
| `rework_count` | number | reworks so far |

It reads back:

| Variable | Type | Meaning |
|---|---|---|
| `next_action` | string | `rework`, `ask` or `amend-spec` |
| `rework_task` | string | the task id to reopen, when `rework` |
| `feedback` | string | what the reopened task must fix, carried into its loop |
| `question` | string | the escalation's question, when `ask` or `amend-spec` |

The contract is checked when the loop starts, as for task scripts. The bundled `group.agent` is one reasoning step with a structured result. It acts on nothing: the group judge decides, and only task loops act.

## CLI

- **`run <change> <group>`:** a positional that is a bare integer is a group, and `n.m` is a task. `--next-group` replaces it with the first group holding an unticked task. The group judge's script defaults to the bundled `group.agent` and can be overridden with `--group-script`, or `groupScript` in config.
- **Worktree mode:** one worktree, `<worktreeDir>/<change-id>-<group>`, on branch `task/<change-id>/<group>`.
- **Exit codes:** `0` converged; `1` blocked, exhausted or failed; `2` usage or a refused start.
- **New events:** `group-started`, `group-check` (`commands: { command, exitCode }[]`, `passed`), `rework` (`task`, `reason`) and `group-ended` (`status`, `tasks: { task, status, runs }[]`, `changed`). The task events inside a group carry a `group` field.

## Risks

- **A group can take a while.** Each task loop has its own budget, and the group adds at most `maxReworks` reruns. Every phase is checkpointed, so a killed process resumes where it was.
- **The judge picking the wrong task to rework** costs one task-loop run; the budget bounds it, and the outcome shows exactly what ran.
