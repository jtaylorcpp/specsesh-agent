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
  iterates: its group loops, in order, then a change check
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
- Its change check reworks nothing yet. `changeChecks` (default: the `checks`) run once after the last group, and any non-zero exit ends the change `"failed"` with the evidence. No change judge yet reopens a group or adds tasks for unclaimed scenarios: the `"rework-task"` and `"add-task"` invariant above is not yet implemented.

## Example

On 2026-10-11, tests written for `baseline-agentscript-durable` showed its spec said `run` throws `UndeclaredVariableError` and allowed nested `if`s, while the dialect's lint refuses both first. That `"spec-defect"` finding ended the loop with `"amend-spec"`, and the remedy was amended requirements, not changed code.

## Spec

- `openspec/loops: The change loop makes the spec real`
- `openspec/loops: The change loop reports its groups and what was unclaimed`
- `openspec/loops: A spec defect leaves the loops as an amendment`
