## 1. The result tool carries the step's schema

- [ ] 1.1 `packages/agent/src/durable/extension.ts`: at dispatch, offer a `submit_result` whose `parameters` are the request's `outputSchema` (same name, description, `replay: "safe"`, executor); text-only steps offer none
- [ ] 1.2 Tests: `Scenario: The provider sees the step's types`, `Scenario: A wrongly typed field still reaches the tool's own check`; the claude-code provider receives the real schema as `--json-schema` (fake `claude` records its argv)

## 2. Bounded refusals

- [ ] 2.1 `agentscript.step` doc: `refusals` (initial `0`); `submit_result` increments it on a refusal, in the same commit; the third refusal returns the error with `control: { terminate: true }`
- [ ] 2.2 The await phase: a step with `refusals >= 3` and no `result` settles `{ kind: "failed", category: "unknown", message: "the step's result was refused 3 times; last: <problem>" }`
- [ ] 2.3 Tests: `Scenario: A model that never fixes its result stops after three tries` (the live run's exact answer, repeated forever by a scripted provider; assert exactly 3 provider calls), and the two modified-requirement scenarios still pass

## 3. Close

- [ ] 3.1 `pnpm -r check`, `pnpm -r test`, `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check`; `openspec/parked.md`: remove the "no bound on submit_result retries" entry
- [ ] 3.2 `pnpm spec:archive bound-step-results`
