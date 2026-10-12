## 1. The stage

- [ ] 1.1 `packages/agent/src/task/stages/proposal-md.ts` (new): `proposalSections(markdown)` and `readProposalCapabilities(markdown)`
- [ ] 1.2 `packages/agent/src/task/stages/capabilities.ts` (new): `existingCapabilities(workspace)` and `capabilityLines(workspace)` from `openspec/specs/`
- [ ] 1.3 `packages/agent/src/task/scripts/spec-proposal.agent` (new): the script from the design's example
- [ ] 1.4 `packages/agent/src/task/options.ts`: `BUNDLED_SCRIPTS.specProposal`
- [ ] 1.5 `packages/agent/src/task/stages/proposal.ts` (new): `proposalStage` with its seed and gate
- [ ] 1.6 `packages/agent/src/task/index.ts`: export `proposalStage`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/stages/proposal-md.test.ts`: "A missing Out of scope section", "Capabilities in nested bullets", "A modified path that does not exist" and "A new path that already exists" (4)
- [ ] 2.2 `packages/agent/__tests__/task/stages/proposal-stage.test.ts`: "The proposal stage is seeded with every capability", "A proposal touching three capabilities is sent back" and "The bundled proposal script fits the contract" (3)

## 3. Docs

- [ ] 3.1 `CLAUDE.md`: the spec loop paragraph names `proposalStage` and the proposal format

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-spec-proposal-stage`
