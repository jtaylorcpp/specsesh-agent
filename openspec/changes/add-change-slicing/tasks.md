## 1. Slicing

- [x] 1.1 `packages/agent/src/task/stages/slices-md.ts` (new): `readSlices(markdown)` and `sliceIssues(slices, changeId, existing)`
- [x] 1.2 `packages/agent/src/task/stages/capabilities.ts`: `existingChanges(workspace)`, the ids in `openspec/changes/` and its archive
- [x] 1.3 `packages/agent/src/task/stages/proposal.ts`: own `slices.md`, and gate on it as the design shows
- [x] 1.4 `packages/agent/src/task/scripts/spec-proposal.agent`: instructions to slice by capability, then by visible value, in dependency order, this change first
- [x] 1.5 `packages/agent/src/task/spec-cli.ts`: after an approved proposal with `slices.md`, list each later slice's `spec` command

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/task/stages/slices.test.ts`: "A sliced proposal passes", "A slice whose id is taken" and "The first slice must be this change" (3)
- [x] 2.2 `packages/agent/__tests__/task/stages/proposal-stage.test.ts`: update "The proposal stage is seeded with every capability" and "A proposal touching three capabilities is sent back" (2)
- [x] 2.3 `packages/agent/__tests__/task/cli-spec-review.test.ts`: "Approving a sliced proposal lists the other slices" (1)

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 3.2 `pnpm spec:archive add-change-slicing`
