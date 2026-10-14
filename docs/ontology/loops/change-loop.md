---
id: change-loop
name: Change loop
kind: loop
area: loops
spec:
  - "openspec/loops: The change loop makes the spec real"
  - "openspec/loops: The change loop reports its groups and what was unclaimed"
  - "openspec/loops: A spec defect leaves the loops as an amendment"
related: [loop, task-list, group-loop, change-outcome, unclaimed-scenario, validation-report, execute-step]
status: implemented
---

# Change loop

The loop that drives the whole task list until the spec is real.

## Definition

```
Loop<TaskList, ChangeOutcome>
  goal:    the change's TaskList
  targets: every scenario in every delta (unclaimed included)
           + a ValidationReport with valid true
           + the full suite passing
           + the change's trial fold validating
  iterates: its group loops, in order, then a change check, then the trial fold
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| Goal | `TaskList` | The change's tasks.md. |
| Targets | every delta scenario, strict validation, the full suite | Unclaimed scenarios included. |
| Out | `ChangeOutcome` | `{ groups: { group: integer, outcome: LoopOutcome<GroupOutcome>, runs: integer }[], unclaimed: ScenarioRef[] }`: one entry per group, latest run. |

## Invariants

- Every delta scenario SHALL be a target, including scenarios no task claims.
- The change check SHALL close unclaimed scenarios by adding tasks, and MAY issue `"rework-task"` or `"add-task"`.
- A `"spec-defect"` finding SHALL become `"amend-spec"`, ending the change loop `"blocked"` with an escalation and moving the change to `amended`. The fix is a delta change, not code.

## Relations

- An instance of [Loop](loop.md) over the [TaskList](../../taxonomy/task-list.md); run by the [execute](../process/steps/execute-step.md) step.
- Runs [Group loop](group-loop.md)s; targets [unclaimed scenarios](../../taxonomy/unclaimed-scenario.md) and a valid [ValidationReport](../process/validation-report.md).
- Returns a [ChangeOutcome](change-outcome.md) as the `result` of its `LoopOutcome<ChangeOutcome>`, which [execute](../process/steps/execute-step.md) hands back whole.
- Implemented as the pi-durable task `agentscript.change-loop` (version 1) in `@specsesh/agent/task` (`packages/agent/src/task/change-loop.ts`, with `change-input.ts`, `change-guard.ts` and `change-api.ts`), exported as `startChangeLoop`, `waitForChangeLoop`, `answerChangeEscalation`, `changeLoopExtensions` and `ChangeLoopOptions`. Its phases are `next`, `group` and `check`: every group in tasks.md runs in order as an `agentscript.group-loop` child, fully ticked groups included, so `coversEveryGroup` holds, and it returns `LoopOutcome<ChangeOutcome>` with `unclaimed` reported, not refused. A blocked group blocks the change, its escalation raised to level `change`; `answerChangeEscalation` resumes it as a new run.
- Its change check reworks nothing yet. `changeChecks` (default: the `checks`) run once after the last group, in order, each as an argv with no shell, and any non-zero exit ends the change `"failed"` with the evidence, before any trial fold. No change judge yet reopens a group or adds tasks for unclaimed scenarios: the `"rework-task"` and `"add-task"` invariant above is not yet implemented.
- When every change check exits `0`, `check` runs the trial fold: `trialFold(workspace, change)` from `src/task/cmd-close.ts`, the routine `close` uses. It folds the change into a temporary copy of `openspec/`, runs `openspec validate --specs --strict --json` there, and always removes the copy. This is needed because openspec 1.14.1's `validate <change> --strict` does not check the length of MODIFIED requirements, and only the folded specs show that (gaps.md #17). The fold adds one `CheckEvidence` to the same `{ check: "change" }` iteration, after the change checks' evidence: command `openspec validate --specs --strict --json`, its exit code (127, `SPAWN_FAILED_EXIT_CODE`, when openspec cannot be spawned), and as output the `formatTrialFold` text `close` prints (the `failure` text when the fold never ran). A passing fold ends the change `"converged"`, with every group entered and `unclaimed` reported.
- A fold that is not `ok` ends the change `"blocked"`, not `"failed"`. This includes warnings, since `--strict` exits non-zero on them, and a fold that cannot run (`failure` set). The escalation is at level `"change"` to `principal`, as a `"spec-defect"`, and its question is `trial fold failed: openspec validate --specs --strict`, a newline, then the `formatTrialFold` text. It blocks because the code is done and only the deltas need editing, which is the principal's decision.
- The fold adds no phase, so the checkpoint version stays `1`. A process killed during the fold reruns `check` (the change checks, then the fold) and starts no group loop. Both steps are safe to repeat.
- `answerChangeEscalation` accepts an answer to a fold block under the same conditions as a group block. No group is blocked, so it calls no `answerGroupEscalation`. Instead it starts a new change run that carries the entries and goes straight to `check`, which runs the change checks and then the fold, and starts no group loop. If the deltas were fixed, the new run ends `"converged"` with every group entered. If they were not, it blocks again with the same question.

## Example

On 2026-10-11, tests written for `baseline-agentscript-durable` showed its spec said `run` throws `UndeclaredVariableError` and allowed nested `if`s, while the dialect's lint refuses both first. That `"spec-defect"` finding ended the loop with `"amend-spec"`, and the remedy was amended requirements, not changed code.

A trial fold block, answered once the delta is fixed:

```sh
pnpm change build add-spec-amendments-judge
# … groups converge, change checks pass …
# blocked: trial fold failed: openspec validate --specs --strict
#   ✗ [ERROR] spec/judge: Requirement "…" text exceeds 500 characters (612)
$EDITOR openspec/changes/add-spec-amendments-judge/specs/spec/judge/spec.md
pnpm change answer add-spec-amendments-judge "deltas shortened"   # re-runs the check phase only
```

## Spec

- `openspec/loops: The change loop makes the spec real`
- `openspec/loops: The change loop reports its groups and what was unclaimed`
- `openspec/loops: A spec defect leaves the loops as an amendment`
