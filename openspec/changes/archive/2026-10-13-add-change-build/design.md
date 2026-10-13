## Context

`add-build-loop` gives `startChangeLoop` and `answerChangeEscalation`. The change loop runs every task group in order as a child group loop, each with its own task loops and judge, then a change check, behind a guard. `pnpm task run <change> <group>` already maps the group flags onto `GroupLoopOptions` and refuses a dirty tree unless `--allow-dirty`. `changeState` (`add-change-draft`) finds a change's newest draft loop.

The flow is in [`../add-change-draft/design/mock.html`](../add-change-draft/design/mock.html), steps 6 and 7. The commands are in [`design/examples/build.sh`](design/examples/build.sh).

## A change's build state

`changeState` also finds the change's newest change loop:

| Newest change loop | State | `build` | `build "<text>"` |
|---|---|---|---|
| none, or ended exhausted or failed | ready to build | starts one | refused, nothing waits |
| `blocked` | waiting for an answer | shows the question again, exit 1 | answers it as the escalation's `to` |
| `converged` | built | says so, exit 0 | refused, nothing waits |

## A session

```console
$ pnpm change build add-plan-export --change-check "pnpm spec:check"
# add-plan-export — waiting for an answer
## group 1: converged (4 tasks, 0 reworks)
## group 2: blocked at 2.3

group 2 asks: The export can call the v1 or the v2 plan API. Which?
  answer:  pnpm change build add-plan-export "<your answer>"

$ pnpm change build add-plan-export "Use the v2 API"
# add-plan-export — built
## group 1: converged (4 tasks, 0 reworks)
## group 2: converged (3 tasks, 1 rework)
## group 3: converged (2 tasks, 0 reworks)
## change check: passed

Changed: packages/plan/src/export.ts, packages/plan/src/cli.ts, …
Archive it: pnpm spec:archive add-plan-export
```

- **Tasks** are a group's entries. **Reworks** are the sum, over its tasks, of `runs - 1`: each extra run is the judge reopening a task.
- **Changed** lists the files changed since the build started, as `pnpm task` does. Nothing is committed.
- `add-change-close` replaces the last line with `pnpm change close add-plan-export`.

## Flags

`build` reuses the group run's flag parser and `resolveRunSettings`, so config, environment and defaults resolve the same way. `--change-check <command>` (repeatable) becomes `changeChecks`, and defaults to the resolved `checks`. `--worktree` is refused for now (`build has no --worktree yet; run it in a clean checkout`).

## Decisions

- **The answer is positional**, as `draft`'s feedback is. `build <change> "<answer>"` reads as "build it, and here's your answer".
- **Answered as the escalation's `to`.** A build waits for whoever the escalation names. With the default `escalateTo: principal` that's you. An escalation to `agent` is answered as `agent`, the same rule `answerGroupEscalation` keeps.

## Risks

- **Long runs.** A build runs every group's task loops and checks in one process. The loop is durable: if the process dies, `pnpm task resume <id>` continues it, and the start line prints that command.
