## 1. The stage

- [ ] 1.1 `packages/agent/src/task/stages/openspec-cli.ts` (new): `openspecValidate(run, id)` and `openspecDeltas(run, id)`, each failure one `ERROR`
- [ ] 1.2 `packages/agent/src/task/stages/specs-gate.ts` (new): `coverageIssues` and the size filter
- [ ] 1.3 `packages/agent/src/task/scripts/spec-specify.agent` (new): the script from the design's example
- [ ] 1.4 `packages/agent/src/task/options.ts`: `BUNDLED_SCRIPTS.specSpecify`
- [ ] 1.5 `packages/agent/src/task/stages/specs.ts` (new): `specsStage` with its seed and gate
- [ ] 1.6 `packages/agent/src/task/spec-stages.ts`: `SPEC_STAGES` gains `specsStage`
- [ ] 1.7 `packages/agent/src/task/index.ts`: export `specsStage`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/stages/specs-gate.test.ts`: "An OpenSpec error reaches the next draft", "openspec is missing", "A delta for an unnamed capability" and "A new capability without a Purpose" (4), with a fake `openspec` on `PATH`
- [ ] 2.2 `packages/agent/__tests__/task/stages/specs-stage.test.ts`: "The specs stage sees the mock and examples", "Seventeen scenarios are sent back", "The design follows the proposal" and "The bundled specify script fits the contract" (4)

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 3.2 `pnpm spec:archive add-spec-specify-stage`
