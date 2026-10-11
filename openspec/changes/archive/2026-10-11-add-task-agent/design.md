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

`task.agent` (moved by task 6.1 to `packages/agent/src/task/scripts/`) lints with zero diagnostics against the pinned dialect. Today the runtime refuses only its `actions` and `run`, which is exactly what `add-agentscript-actions` adds.

- **Fine-tuning is editing a copy:** change prompts, add subagents (a `review` step), swap `run_command` for `delegate_claude_code`, or add actions. The contract is the only fixed surface.
- **A subscription variant ships too:** `task-delegate.agent` acts through `delegate_claude_code`, because the claude-code provider can't serve model-callable tools.

## Risks

- **The judge's verdict is the model's word.** The deterministic `check` subagent runs the checks first and the judge sees their output. Per-scenario evidence targets, the ontology's stricter rule, wait for the parser.
- **Large changes make large prompts.** All deltas go to every orient and judge step. Context selection, the ontology's `ContextRef`, is the follow-up.

## Reconciled with what landed (2026-10-11)

Specced before packaging, the ontology and actions archived. What changed on contact:

- **Actions bind per harness.** `agentScriptExtensions({ actions, workspace })` closes over one registry and one workspace, and `agentscript.run` resolves by name in the harness. So a harness runs loops for one workspace, check list and allowlist: `taskLoopExtensions({ workspace, checks, allow })` returns `TaskLoop` plus the run and step extensions over `builtinActions(...)`. `startTaskLoop` checks bindings against the built-ins for the options' values; the child run checks again against what is installed. The CLI's `resume` and `answer` read those values from the stored loop and install the extensions before resuming.
- **The ontology's outcome is closed.** `LoopOutcome`, `TaskOutcome` and `Iteration` are strict, so a tick note or a failure message has no field there. The loop task's durable result is `{ outcome, notes }`; `waitForTaskLoop` returns the outcome, `waitForTaskLoopResult` both.
- **A verdict needs a target, an unmet target needs feedback, a finding needs evidence.** Each iteration judges one target, `{ check: "task <id>" }`. An unmet verdict carries one `Feedback` whose finding kind follows the ontology's own `feedbackFor`: `code-defect`/`retry`, `needs-decision`/`ask`, `spec-defect`/`amend-spec`, and `environment`/`retry` for a failed run or a broken contract. Its evidence is the run's evidence plus the judge's `ReviewEvidence { reviewer: "agent" }`, or, for a failed run, a `CheckEvidence` for `agentscript.run` with exit code 1 and the failure as output.
- **`Escalation.question` is non-empty.** An empty `question` falls back to `unmet`, then to a stock question naming the task.
- **The status rule is the ontology's.** `outcomeStatus` decides converged, blocked, exhausted or going on, over this run's iterations only: an answered escalation's new run gets a fresh budget, and its iterations are numbered on from the earlier ones.
- **Text deltas.** A `{ dir }` delta's capability path is its directory under `specs/`; a `{ path }` delta's is the part between `specs/` and `/spec.md` when it has one, else the path; a `{ text }` delta is `delta <n>`.
- **The bundled scripts ship in `dist/`.** `pnpm build` copies `src/task/scripts/*.agent` to `dist/task/scripts/`, so `files` stays `["dist", "README.md", "LICENSE"]` and the default script resolves next to the compiled module.
- **The contract is checked before the lint.** A script missing a contract variable but still setting it fails the dialect's lint as an undeclared reference; the contract check runs on the parsed declarations first, so the refusal names the variable and its type.
