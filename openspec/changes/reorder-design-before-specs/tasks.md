## 1. The order in code

- [ ] 1.1 `packages/agent/src/openspec/process.ts`: `DesignInput` = `{ proposal }`, `SpecifyInput` gains `design`, `STEPS` lists `design` before `specify`, and `FORWARD` maps `design` drafting→designed, `specify` designed→specified, `plan` specified→planned
- [ ] 1.2 `packages/agent/__tests__/openspec/process.test.ts`: tests for "Design sees only the proposal", "The steps in lifecycle order", "Plan sees the design" and "Specify sees the design" (4), each named `Scenario: <exact scenario name>`
- [ ] 1.3 `packages/agent/__tests__/openspec/process.test.ts`: update "The forward path", "Skipping planning is refused" and its allowed-transition set, and add "Specifying before designing is refused" (3)

## 2. Docs

- [ ] 2.1 `docs/ontology/process/steps/design-step.md`: input `{ proposal }`, moves `drafting → designed`, follows propose and feeds specify, spec refs "Design follows the proposal"
- [ ] 2.2 `docs/ontology/process/steps/specify-step.md`: input gains `design`, moves `designed → specified`, follows design and feeds plan
- [ ] 2.3 `docs/ontology/process/steps/plan-step.md`: moves `specified → planned`, follows specify, spec ref "Plan follows the deltas and the design"
- [ ] 2.4 `docs/ontology/process/change-state.md`: the forward path diagram and the first three rows of the transition table in the new order
- [ ] 2.5 `docs/overview.md`: the step table's order and the state diagram
- [ ] 2.6 `guides/06-openspec.md`: the state list in the new order

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 3.2 `pnpm spec:archive reorder-design-before-specs`
