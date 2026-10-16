## Why

When the principal answers a task-level escalation inside a group, the task loop reruns as a new run with `carried` set to the answer and no earlier iterations, so the rerun starts at iteration 1. Both bundled task scripts show `carried` only when `iteration > 1`, so the agent never sees the answer and asks the same question again. Answering with `agentscript-change build <change> "<answer>"` cannot unblock a task-level question. The specs already say the new run's first iteration is seeded with `carried`; the scripts just don't show it.

## What Changes

- `task.agent`'s and `task-delegate.agent`'s orient steps show the carried text whenever `carried` is non-empty, on any iteration, including the first iteration of a run resumed by an answer.
- The carried line is reworded so it reads right on iteration 1 too: it is either what an earlier iteration left unmet or the principal's answer.
- The `This is iteration <n>.` line stays, still only from iteration 2, and no longer gates the carried text.
- `task-delegate.agent`'s "If the carried feedback names a check…" line moves with the carried text.

## Out of scope

- The spec-stage scripts (`spec-proposal`, `spec-design`, `spec-specify`, `spec-plan`), which also gate on `iteration > 1` but render the current files alongside. Parked in `openspec/parked.md`.
- How `carried` is computed or seeded by the task, group or change loops.

## Capabilities

**Modified:**
- `task/agent`: the bundled task scripts show carried feedback whenever it is non-empty.

## Impact

- `packages/agent/src/task/scripts/task.agent` and `task-delegate.agent`: the orient step's condition and wording.
- Tests that pin the old wording (`Still unmet from before`) change to the new one.
- An answered task-level escalation now reaches the agent on the rerun's first iteration.
