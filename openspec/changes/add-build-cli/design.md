## Context

After `add-draft-cli`, `agentscript-task` has six commands: `run`, `spec`, `draft`, `resume`, `answer` and `status`. `run <change> <group>` already maps the group flags onto `GroupLoopOptions` and refuses a dirty tree unless `--allow-dirty`. `add-build-loop` gives `startChangeLoop`, `answerChangeEscalation`, and a guard that refuses before anything exists.

The whole flow, from intent to an archived change, is clickable in [`design/mock.html`](design/mock.html). The commands are in [`design/examples/session.sh`](design/examples/session.sh).

## From an idea to working code

```console
$ pnpm task draft add-plan-export --intent "Export a plan as JSON so CI can read it"
  … four reviews, each answered with `pnpm task answer <id> --by principal --decision approve` …
Every stage of add-plan-export is approved. Build it: pnpm task build add-plan-export

$ pnpm task build add-plan-export --change-check "pnpm spec:check"
# build 21 — blocked
## group 1: converged (4 tasks, 0 reworks)
## group 2: blocked at 2.3

group 2 asks principal: The export can call the v1 or the v2 plan API. Which?
Answer: pnpm task answer 21 --by principal --decision "<your answer>"

$ pnpm task answer 21 --by principal --decision "Use the v2 API"
# build 22 — converged
## group 1: converged (4 tasks, 0 reworks)
## group 2: converged (3 tasks, 1 rework)
## group 3: converged (2 tasks, 0 reworks)
## change check: passed

Changed: packages/plan/src/export.ts, packages/plan/src/cli.ts, packages/plan/__tests__/export.test.ts, …
Archive it: pnpm spec:archive add-plan-export
```

- **Tasks** are the group's entries. **Reworks** are the sum, over its tasks, of `runs - 1`: each extra run is the judge reopening a task.
- **Changed** lists the files changed since the build started, as `run` does today. Nothing is committed.
- **The archive command is printed, not run.** Archiving folds the deltas into the specs. The principal does that after reading the diff.

## Flags

`build` reuses the group run's flag parser and `resolveRunSettings`, so config, environment and defaults resolve the same way. One flag is new:

| Flag | Becomes | Default |
|---|---|---|
| `--change-check <command>` (repeatable) | `changeChecks` | the resolved `checks` |

`--worktree` is refused for now (`build has no --worktree yet; run it in a clean checkout`). One worktree for a whole change is a natural next step, and it's parked.

## status

```
loop 22  add-plan-export  build 3      converged  1 iteration
loop 21  add-plan-export  build 2      blocked    0 iterations
loop 17  add-plan-export  draft tasks  converged  4 iterations
```

## Decisions

- **`build`, not `execute`.** The ontology's step is `execute`, but the user-facing verb pairs with `draft`. The loop keeps the ontology's name, `agentscript.change-loop`.
- **The same answer command.** Whichever agent asked, a task loop or a group judge, the principal answers the build loop's id. `answerChangeEscalation` passes the answer down.

## Risks

- **Long runs.** A build runs every group's task loops and checks in one process. The loop is durable, so a killed process continues with `pnpm task resume <id>`, which the start line already prints.
