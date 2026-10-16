## Why

An answered task-level escalation reruns the task with `carried` set to the principal's answer. Since `show-carried-on-first-iteration`, orient sees that answer and act follows it. The `judge` step never sees `carried`, though. When the answer departs from the task text (for example "keep X out of the component; treat 2.1 as satisfied"), the judge reads the task text, finds X missing and chooses `ask` again, so the same question is escalated on every rerun and the change never moves. A real run's loop database showed exactly this: the rerun's `carried` held the answer and the judge escalated the same question.

## What Changes

- The `judge` steps of `task.agent` and `task-delegate.agent` show the carried text whenever `carried` is non-empty, on any iteration, after `The principal's answer or earlier feedback: `.
- The same block tells the judge that an answer to a question about the task is a decision: follow it, it overrides the task text where they differ, and do not ask that question again. Checks still decide whether the task is done.
- The requirement "The bundled task scripts show carried feedback whenever it is non-empty" is restated to cover the judge prompts too.

## Out of scope

- The group judge (`group.agent`) and the spec-stage scripts.
- How `carried` is computed or seeded by the task, group or change loops.
- Whether `ask` is offered at all on a rerun: the judge may still ask a new question the answer does not settle.

## Capabilities

**Modified:**
- `task/agent`: the bundled task scripts' judge prompts show carried feedback and treat a principal's answer as settling the question it answers.

## Impact

- `packages/agent/src/task/scripts/task.agent` and `task-delegate.agent`: the judge step's instructions.
- New tests in `packages/agent/__tests__/task/carried-scripts.test.ts`.
- An answered task-level escalation no longer loops back to the same question.
