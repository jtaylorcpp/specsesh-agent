## 1. The rules

- [ ] 1.1 `packages/agent/src/openspec/size.ts` (new): `SizeBudget`, `DEFAULT_SIZE_BUDGET`, `ChangeSize` and `changeSize(change)`
- [ ] 1.2 `packages/agent/src/openspec/size.ts`: `sizeIssues(change, budget?)` and `proposalSizeIssues(proposal, budget?)`, with the split suggestions
- [ ] 1.3 `packages/agent/src/openspec/size.ts`: `taskIssues(task, budget?)`
- [ ] 1.4 `packages/agent/src/openspec/index.ts`: `export * from "./size.js"`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/openspec/size.test.ts`: "The default budget", "An oversized change fails strict validation", "Counting a change" and "A change within budget has no issues" (4)
- [ ] 2.2 `packages/agent/__tests__/openspec/size.test.ts`: "Each exceeded limit is its own issue", "Split by capability", "Split by group" and "A proposal touching three capabilities" (4)
- [ ] 2.3 `packages/agent/__tests__/openspec/size.test.ts`: "A task naming two files", "A task with sub-steps", "A test task claiming five scenarios" and "A command task passes" (4)

## 3. Docs

- [ ] 3.1 `docs/ontology/process/size-budget.md` (new): the `SizeBudget` concept page, with its defaults and where they come from
- [ ] 3.2 `docs/ontology/process/change-size.md` (new): the `ChangeSize` concept page and the three rules over it
- [ ] 3.3 `docs/README.md`: both pages in the process table

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-change-size-rules`
