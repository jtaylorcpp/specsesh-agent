## Why

`judge-sees-loop-changes` told the delegate judge that "0 alone does not mean the task is unfinished", so a finished task isn't judged unmet once a later iteration finds nothing left to do. The same line now shows when nothing changed at all. An A/B test of a delegate that changed nothing but reported the work "already in place" (checks passing, generic test output, `changed` empty) shows the regression. qwen3.5 9B accepted the false claim in 4/10 runs with the merged wording, against 0/10 before. With a plain statement that the loop has not done the work, it accepted it 0/10 times. Haiku 4.5, Sonnet and Opus rejected it 10/10 with every wording tried.

## What Changes

- In `task-delegate.agent`'s judge, when the delegate changed 0 files and `changed` is empty, the files line says the delegate changed nothing and that nothing has changed since the loop started. A report that the work already exists is then wrong unless the check output shows the task's scenario passing.
- Otherwise the line renders as before, word for word.

## Out of scope

- `task.agent`'s judge, which has no per-iteration file count.
- The orient step and the carried label.
- Any change to how `changed` is measured or seeded.

## Capabilities

- **Modified:** `task/agent`.

## Impact

- `packages/agent/src/task/scripts/task-delegate.agent` (the judge's files line) and the tests that pin it (`delegation-loop.test.ts`, `changed-scripts.test.ts`).
- Loops whose delegate changed nothing in a loop that has changed nothing are told so plainly. Every other judge prompt is unchanged.
