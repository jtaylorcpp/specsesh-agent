# Design: judge-weighs-the-principals-answer

## Context

`taskLoopInputFor` reruns an escalated task with `carried` set to the principal's answer. Orient shows it (`show-carried-on-first-iteration`), but the `judge` subagent's instructions in both bundled task scripts render only the task, the plan, the act summary (delegate) and the check output. The judge therefore weighs the work against the task text alone, and when the answer overrides that text it sees a gap and chooses `ask` again.

## Decision

Both scripts' judge instructions gain, just before "Is the task done against the spec deltas?":

```
if @variables.carried != "":
    | The principal's answer or earlier feedback: <carried>
    | If it answers a question about this task, follow it: it overrides the task text where they differ, and do not choose ask for that question again. The checks still decide whether the task is done.
```

`carried` also holds the previous iteration's unmet text on ordinary retries; the wording covers both, and the "if it answers a question" clause only binds when it is an answer. "Checks still decide done" keeps the existing contract (done only when the checks pass) unchanged.

## Risks

- A judge may now lean on an answer to excuse a gap the answer did not cover; the wording limits the override to the question it answers, and checks still gate done.
