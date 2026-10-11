## Context

The task loop from the ontology (`docs/ontology/loops/task-loop.md`), made runnable. The decisions taken with the principal on 2026-10-11:
- **The agent acts through Agent Script actions** (`add-agentscript-actions`).
- **The host runs the script once per iteration.** The loop lives in the host, not in the language.
- **Spec it now, build after packaging.**

## Inputs

```
startTaskLoop(harness, options, context): Promise<TaskId<LoopOutcome<TaskOutcome>>>

TaskLoopOptions {
  change:    { dir: string }                                         // proposal.md, design.md?, specs/**/spec.md, tasks.md
           | { proposal: Source, design?: Source, deltas: Source[], tasks: Source }
  task:      TaskId                                                  // "2.4"
  script?:   Source                                                  // default: the bundled task.agent
  workspace: string                                                  // actions are confined here
  budget?:   { maxIterations: number }                               // default 3
  checks?:   string[]                                                // run_checks commands, e.g. ["pnpm test"]
  allow?:    string[]                                                // run_command allowlist, by first word
  escalateTo?: "principal" | "agent"                                 // default "principal"
  model?:    ModelRef
}
Source = { text: string } | { path: string }
```

- **Sources are read once, at start, into the durable task's input.** A resumed loop needs no files and sees the exact texts it started on, the same rule as `agentscript.run`. A path that can't be read refuses the start, naming it.
- **The task is found in `tasks.md` by its id at start.** An unknown id refuses with the ids that exist. Today's `- [ ] 2.4 …` line format is the one parsed.
- **`deltas` reach the script as one string,** each delta prefixed with its capability path.

## The script contract

The loop seeds these variables before each iteration. A script must declare every one, with this type:

| Variable | Type | Seeded with |
|---|---|---|
| `task_id` | string | the task id |
| `task_text` | string | the task's text, without the checkbox |
| `proposal` | string | proposal.md |
| `design` | string | design.md, or `""` |
| `deltas` | string | every delta, concatenated |
| `iteration` | number | 1, 2, … |
| `carried` | string | the previous `unmet`, or an escalation answer's decision, or `""` |

It reads these back after the run:

| Variable | Type | Meaning |
|---|---|---|
| `met` | boolean | the judge's verdict |
| `unmet` | string | what is still unmet |
| `next_action` | string | `retry`, `amend-spec` or `ask` |
| `question` | string | the escalation's question, when `next_action` is `amend-spec` or `ask` |

The contract is checked when the loop starts, with the actions binding check from `add-agentscript-actions`. A violation refuses before anything runs.

## The loop

`agentscript.task-loop`, version 1, with phases `iterate → await → judge`:

```
iterate:  start an agentscript.run child with the script, the variables seeded, entry = the script's subagents in order
await:    wait for the child (idempotent by child id)
judge:    child failed                        → LoopOutcome "failed", Finding "environment"
          met = True                          → "converged"; tick if tasks.md came from a file
          next_action = "retry", budget left  → iterate again with carried = unmet
          next_action = "retry", budget spent → "exhausted"
          next_action = "ask"                 → "blocked", Escalation { level: "task", to: escalateTo, reason: unmet, question }
          next_action = "amend-spec"          → "blocked", Finding "spec-defect", Escalation as above
          anything else                       → "failed": the script broke the contract
```

- **Each iteration becomes an ontology `Iteration`:**
  - `plan`: the script's `plan` variable if declared, else `""`;
  - `actions`: the `Action`s the run's host actions recorded;
  - `evidence`: their `Evidence`;
  - `verdict`, from `met` and `unmet`;
  - `feedback`, from `next_action`.
- **An answered escalation resumes the loop.** `answerEscalation(harness, loopId, answer)` checks that `answer.by` equals `escalation.to`, then starts a new run of the same loop with `carried` set to the answer's `decision`. The earlier iterations stay recorded.

## Ticking

Converged with `tasks.md` from a path: the task's line, matched by id, changes from `- [ ]` to `- [x]`, and nothing else in the file changes. If the line is already ticked, or can't be found (the file changed meanwhile), nothing is written and the outcome's `ticked` is `false`, with a note. A loop never ticks from text input, and never unticks.

## The default script

`task.agent` sits beside this design. It lints with zero diagnostics against the pinned dialect. Today the runtime refuses only its `actions` and `run`, which is exactly what `add-agentscript-actions` adds.

- **Fine-tuning is editing a copy:** change prompts, add subagents (a `review` step), swap `run_command` for `delegate_claude_code`, or add actions. The contract is the only fixed surface.
- **A subscription variant ships too:** `task-delegate.agent` acts through `delegate_claude_code`, because the claude-code provider can't serve model-callable tools.

## Risks

- **The judge's verdict is the model's word.** The deterministic `check` subagent runs the checks first and the judge sees their output. Per-scenario evidence targets, the ontology's stricter rule, wait for the parser.
- **Large changes make large prompts.** All deltas go to every orient and judge step. Context selection, the ontology's `ContextRef`, is the follow-up.
