# Design: show-carried-on-first-iteration

## Context

`taskLoopInputFor` (`src/task/group.ts`) starts a task's rerun with `carried` set to the principal's answer and `earlier: []`, so the rerun's first iteration is numbered 1. The bundled task scripts render `carried` inside `if @variables.iteration > 1:`, so that answer is never shown. A task-level answer from `answerEscalation` keeps earlier iterations and is unaffected.

## Decision

In both scripts, the orient step gates the carried text on `if @variables.carried != "":` (the same comparison `task-delegate.agent` already uses for `retire_path`). The line reads:

```
Carried in (still unmet from an earlier iteration, or the principal's answer): <carried>
```

The `This is iteration <n>.` line keeps its own `iteration > 1` gate. In `task-delegate.agent`, the "If the carried feedback names a check that already failed before…" line stays in the carried block.

A fresh run seeds `carried` `""`, so its first orient prompt is unchanged apart from nothing being shown.

## Risks

- Tests and any reader that match `Still unmet from before` break; the tests are updated in this change.
- The spec-stage scripts keep the old gate; whether a re-draft's feedback can reach iteration 1 there is parked.
