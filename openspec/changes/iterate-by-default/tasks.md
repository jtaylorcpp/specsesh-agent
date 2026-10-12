## 1. Choices in the step machine

- [x] 1.1 `packages/agent/src/interpreter/run.ts` + `src/interpreter/index.ts`: `InvalidChoicesError` (extends `Error`, `name` set), exported with the other step-machine errors
- [x] 1.2 `packages/agent/src/interpreter/run.ts`: `StartOptions.choices?: Record<string, readonly string[]>`; `start` refuses after the undeclared check (undeclared, not `string`, empty, or excludes the opening value), naming the variable and the reason; `RunState` carries `choices` only when given; `run()` passes `choices` to `start`
- [x] 1.3 `packages/agent/src/interpreter/compose.ts`: `outputSchemaFor` adds `enum` (choices in order) to a field writing a chosen variable (a field feeding two variables takes the later one's, as for `type`)
- [x] 1.4 `packages/agent/src/interpreter/run.ts` (where structured results are applied): a value outside a chosen variable's choices fails the step, category `unknown`, naming the field, `@variables.<x>` and every choice, containing `No variable was set`; nothing set
- [x] 1.5 `packages/agent/__tests__/core/choices-start.test.ts`, `choices-schema.test.ts` and `choices-apply.test.ts` (written by 1.2–1.4): one test per new or modified `core/composition` and `core/step-machine` scenario about choices (9), named `Scenario: <exact scenario name>`, each asserting what its scenario says; plus the three `Run Drives The Step Machine Through A Port` scenarios that had no named test (`packages/agent/__tests__/core/run.test.ts`)

## 2. Choices through the durable run

- [x] 2.1 `packages/agent/src/durable/result.ts`: `checkResult` adds `"<field>" must be one of "a", "b", got "x"` for a property with `enum`, joined into the one refusal message
- [x] 2.2 `packages/agent/src/durable/extension.ts` (the run task) and `src/durable/host.ts` (`startScript`): `RunInput.options` and `StartScriptOptions` carry `choices` through to `start`, so a resumed run keeps them
- [x] 2.3 `packages/agent/__tests__/durable/choices.test.ts`: one test per new or modified `durable/run-task` and `durable/host` scenario about choices (4), faux provider only

## 3. The task loop: gate and contract choices

- [x] 3.1 `packages/agent/src/task/options.ts`: `DEFAULT_MAX_ITERATIONS` `8`
- [x] 3.2 `packages/agent/src/task/contract.ts`: the contract check also refuses a `next_action` default outside `NEXT_ACTIONS`, naming it; the task loop passes `choices: { next_action: [...NEXT_ACTIONS] }` on every child run (`src/task/loop.ts` `iterate`)
- [x] 3.3 `packages/agent/src/task/loop-input.ts` + `src/task/loop.ts` + `src/task/judge.ts`: the `gate` phase (checkpoint `{ phase: "gate", iterations, carried, child, read }`, version stays `1`); `judge` sends a met verdict there when `checks` is non-empty; `gate` runs every check argv-split with no shell (share the group check's runner from `src/task/group.ts`), converges and ticks when all exit `0`, else records the unmet iteration (reason, `code-defect` finding, one `CheckEvidence` per check, `retry` feedback) and iterates with the carried output (last 4000 characters per failing check) or exhausts
- [x] 3.4 `packages/agent/src/task/group-judge.ts` + `src/task/group.ts`: the judge contract also refuses a `next_action` default outside `rework`, `ask`, `amend-spec`; every judge run carries those as `choices`
- [x] 3.5 `packages/agent/__tests__/task/gate.test.ts`: one test per new or modified `task/agent` scenario about the gate and the phases (7: crash during gate, met with checks goes to the gate, met converges, failing checks retry, passing checks converge, gate failure exhausts, the carried output), faux provider only
- [x] 3.6 `packages/agent/__tests__/task/contract-choices.test.ts`: one test per new `task/agent` and `task/group` scenario about `next_action` choices (4), plus `Scenario: Budget defaults to eight iterations` in `__tests__/task/loop.test.ts`, replacing the three-iteration test (and `sources.test.ts`'s default expectation)
- [x] 3.7 `packages/agent/src/task/iteration.ts` + `src/task/judge.ts`: a run ended failed by a failed host action (last report an action result with `ok` false) is an unmet iteration (`environment` finding, `retry`, `carried` = the action's message) that iterates or exhausts by budget; a failed step still fails the loop; `packages/agent/__tests__/task/action-retry.test.ts`, one test per scenario of `A run ended by a failed action is retried within budget` (3)

## 4. Iterate-first bundled scripts

- [x] 4.1 `packages/agent/src/task/scripts/task.agent` and `task-delegate.agent`: the judge's closing instructions become the four iterate-first lines in `design.md`
- [x] 4.2 `packages/agent/src/task/scripts/group.agent`: the rework-first stance in `design.md`, dropping "Prefer asking over repeating a rework that did not help"
- [x] 4.3 `packages/agent/__tests__/task/bundled-judges.test.ts`: `Scenario: The judge prompt says retry is the default` (both task scripts) and `Scenario: The bundled judge reworks first`; the existing lint-clean scenarios still pass

## 5. Defaults, config and docs

- [ ] 5.1 `packages/agent/src/task/config.ts`: the CLI's `maxIterations` default comes from `DEFAULT_MAX_ITERATIONS` (`8`); `Scenario: The iteration budget defaults to eight` in `__tests__/task/config.test.ts`, updating the tests that pinned `3` as the default
- [ ] 5.2 `agentscript.config.json`: `model` `opus`, `delegateModel` `opus`, `maxIterations` `8`; `packages/agent/__tests__/repo/config.test.ts` pins the modified scenario
- [ ] 5.3 `docs/ontology/loops/task-loop.md`: four phases with the gate, `next_action` choices, the renamed requirement reference; `pnpm docs:check` passes
- [ ] 5.4 `CLAUDE.md`: "Running a task" says the loop converges only when the checks pass, the budget defaults to 8, and `next_action` is constrained; the spec workflow gains "a task names at most about 8 scenarios; split a capability's tests across tasks"

## 6. Verify

- [ ] 6.1 `pnpm -r check`, `pnpm -r test` (twice, stable), `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass
- [ ] 6.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive iterate-by-default`
