## Context

The loops nest as the ontology says (`docs/ontology/loops/change-loop.md`):

```
change loop   every group, in order, then a change check         ← this change
  group loop  every task, in order, then the group check; a judge reworks a task
    task loop one task, iterate → await → judge → gate, until its checks pass
```

The group loop is `agentscript.group-loop` (`src/task/group.ts`). It enters ticked tasks as converged without running them, blocks when a task blocks, and is answered by `answerGroupEscalation`, which starts a new run. The ontology already has `ChangeOutcome`, `{ groups: { group, outcome, runs }[], unclaimed }`, and `coversEveryGroup`. `unclaimedScenarios` lists the scenarios no task names. `add-spec-review` writes `approvals.json`.

The example is [`design/examples/build.ts`](design/examples/build.ts).

## The loop

```
start(change, options)
  guard    openspec validate <change> --strict --json   → first ERROR/WARNING refuses
           scenarios no task quotes by exact name        → kept as unclaimed, never refused
           approvals.json present?                       → every SPEC_STAGES entry, every sha256 matches
  queue    every group number in tasks.md, ascending

  next     queue empty → check;  else → group (shift)
  group    start agentscript.group-loop child (once; id in the checkpoint) → await
           converged          → entries += { group, outcome, runs } → next
           blocked            → blocked, escalation copied at level "change"
           exhausted | failed → failed, "group 2 ended exhausted"
  check    changeChecks in order, argv, no shell → one Iteration { check: "change" }
           all 0 → converged { groups, unclaimed };  else → failed

answerChangeEscalation(id, answer)
  only blocked, only by the escalation's `to`
  new run, entries carried, phase group with the answered group's new child:
  answerGroupEscalation(child, answer) → await → as group
```

## Why every group runs

`ChangeOutcome` lists every group, and `coversEveryGroup` checks that a converged outcome covers them all. So a group that is already fully ticked still runs as a group loop. It starts no task loop, because ticked tasks are entered as converged, but its group check still runs. That check is what proves the earlier groups still pass after later work, and it costs one run of the checks.

## changeChecks

The group check runs the task `checks`, typically the fast suite. `changeChecks` defaults to those same commands. A repo can make it the slower, broader set that should pass once at the end: `pnpm spec:check`, `pnpm docs:check`, `pnpm pack:check`. A failure there ends the change `failed` with the evidence. No judge sees it yet (see Out of scope in the proposal).

## The guard

The guard runs before anything is created, so a refused build leaves no loop in the database.
- **Strict validation** is one of the ontology's targets for the change loop: the deltas must validate.
- **Unclaimed scenarios are reported, not refused.** A MODIFIED requirement copies its unchanged scenarios, which already have tests, and today's task lists don't quote them. Refusing would refuse most changes. `ChangeOutcome.unclaimed` exists to record them. A claim is the scenario's exact name in double quotes in a task's text, the same rule as the plan stage's `withClaims`.
- **The approvals check** only applies to a change the spec agent drafted. A change written by hand has no `approvals.json` and builds as it is. A drafted change that was edited after approval has to be reviewed again (`pnpm task spec <change> <stage>`) before it builds. The thing being built is then exactly the thing the principal approved.

## Decisions

- **Escalations become level `change`.** The ontology's `Escalation.level` already has `change`, and `status` and the CLI show it, so the principal can see the whole build is waiting on them.
- **No budget of its own.** Each group has `maxReworks`, and each task `maxIterations`.

## Risks

- **A task that archives the change.** Today's task lists end with `pnpm spec:archive <change>` as a task. A build runs it like any other task, and the change check that follows would then validate an archived change. `pnpm change build` prints `pnpm change close` at the end instead, and `parked.md` records that the plan stage should stop writing archive tasks.
