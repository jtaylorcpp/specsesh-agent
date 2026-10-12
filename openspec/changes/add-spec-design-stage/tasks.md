## 1. The stage

- [ ] 1.1 `packages/agent/src/task/stages/design-gate.ts` (new): the section, mock, example and reference rules
- [ ] 1.2 `packages/agent/src/task/scripts/spec-design.agent` (new): the script from the design's example
- [ ] 1.3 `packages/agent/src/task/options.ts`: `BUNDLED_SCRIPTS.specDesign`
- [ ] 1.4 `packages/agent/src/task/stages/design.ts` (new): `designStage` with its seed and gate
- [ ] 1.5 `packages/agent/src/task/spec-stages.ts`: `SPEC_STAGES` = `[proposalStage, designStage]`
- [ ] 1.6 `packages/agent/src/task/index.ts`: export `designStage`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/stages/design-gate.test.ts`: "A design without a mock", "A design without an example", "A mock that loads a script from the network" and "A fragment is not a mock" (4)
- [ ] 2.2 `packages/agent/__tests__/task/stages/design-stage.test.ts`: "The design stage is seeded with the modified specs", "design.md names a missing example", "The design follows the proposal" and "The bundled design script fits the contract" (4)

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 3.2 `pnpm spec:archive add-spec-design-stage`
